package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/joho/godotenv"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/db"
	"github.com/matinz03/deco/internal/handlers"
	appmiddleware "github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/storage"
	"github.com/matinz03/deco/internal/websocket"
	"go.uber.org/zap"
)

func main() {
	// Load .env in development
	_ = godotenv.Load("../../.env")

	// Logger
	logger, _ := zap.NewProduction()
	if os.Getenv("API_ENV") == "development" {
		logger, _ = zap.NewDevelopment()
	}
	defer logger.Sync()

	// Config
	cfg := config.Load()

	// Storage — an unknown backend name, a missing bucket, an unparseable
	// presign TTL or unusable credentials must stop the process here, not on
	// the first upload.
	storageCfg, err := config.LoadStorage()
	if err != nil {
		logger.Fatal("invalid storage configuration", zap.Error(err))
	}
	media, err := storage.NewBackend(storageCfg)
	if err != nil {
		logger.Fatal("failed to initialise storage backend", zap.Error(err))
	}
	if provisioner, ok := media.(interface {
		EnsureBuckets(context.Context) error
	}); ok {
		bucketCtx, cancelBuckets := context.WithTimeout(context.Background(), 30*time.Second)
		err := provisioner.EnsureBuckets(bucketCtx)
		cancelBuckets()
		if err != nil {
			// Fail closed: a missing bucket, an unappliable public-read
			// policy, or a private bucket that is anonymously readable are
			// all reasons not to accept uploads.
			logger.Fatal("failed to provision storage buckets", zap.Error(err))
		}
	}
	logger.Info("storage backend ready", zap.String("backend", string(storageCfg.Backend)))
	if storageCfg.Backend == config.StorageBackendLocal && cfg.Env != "development" {
		logger.Warn("storage backend is local: private media uses application tickets but remains single-host and requires an off-host backup")
	}
	if storageCfg.Backend == config.StorageBackendS3 && storageCfg.PublicBaseURL == "" {
		// Avatar and sticker URLs are persisted on database rows. Derived
		// from an internal endpoint they are unreachable from a browser and
		// stay wrong for the lifetime of the row.
		logger.Warn("STORAGE_PUBLIC_BASE_URL is not set: public media URLs will be derived from the internal S3 endpoint and stored on user and sticker rows")
	}

	// Database
	pool, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		logger.Fatal("failed to connect to database", zap.Error(err))
	}
	defer pool.Close()
	if err := db.EnsureSchema(pool); err != nil {
		logger.Fatal("failed to ensure database schema", zap.Error(err))
	}

	// Redis
	rdb, err := db.ConnectRedis(cfg.RedisURL)
	if err != nil {
		logger.Fatal("failed to connect to redis", zap.Error(err))
	}
	defer rdb.Close()

	// Authenticator — one instance shared by the REST middleware and the
	// WebSocket handshake. Defaults to the existing HS256 path; the RS256/JWKS
	// path activates only when CLERK_ENABLED is set.
	authenticator := appmiddleware.NewAuthenticator(appmiddleware.AuthenticatorOptions{
		Clerk:     cfg.Clerk,
		JWTSecret: cfg.JWTSecret,
		Mapper:    appmiddleware.NewPostgresClerkUserMapper(pool),
		Cache:     appmiddleware.NewRedisCache(rdb),
	})
	if cfg.Clerk.Enabled {
		logger.Info("managed identity path enabled",
			zap.String("issuer", cfg.Clerk.Issuer),
			zap.String("jwks_url", cfg.Clerk.JWKSURL))
	}

	// WebSocket Hub
	hub := websocket.NewHub(rdb, logger)
	go hub.Run()

	// Router
	r := chi.NewRouter()

	// Global middleware
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Timeout(30 * time.Second))
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{cfg.AllowedOrigins},
		AllowedMethods:   []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// Rate limiting — 100 requests per minute per IP
	r.Use(httprate.LimitByIP(100, time.Minute))

	// Routes
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	})

	r.Route("/api/v1", func(r chi.Router) {
		handlers.RegisterAuthRoutes(r, pool, cfg, logger, authenticator)
		handlers.RegisterUserRoutes(r, pool, cfg, logger, authenticator)
		handlers.RegisterConversationRoutes(r, pool, cfg, logger, authenticator)
		handlers.RegisterUploadRoutes(r, pool, cfg, logger, media, authenticator)
		handlers.RegisterStickerRoutes(r, pool, cfg, logger, media, authenticator)
		handlers.RegisterMessageRoutes(r, pool, cfg, logger, hub, authenticator)
	})

	registerMediaRoutes(r, cfg, time.Now)

	// WebSocket endpoint — auth handled inside the handler via ?token= query param
	r.Get("/ws", websocket.Handler(hub, pool, cfg, logger, authenticator))

	// Server
	srv := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      r,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// Graceful shutdown
	go func() {
		logger.Info("API server started", zap.String("port", cfg.Port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("server error", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	hub.Shutdown()
	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("forced shutdown", zap.Error(err))
	}
	logger.Info("server stopped")
}
