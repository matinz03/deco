package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/db"
	"github.com/matinz03/deco/internal/handlers"
	"github.com/matinz03/deco/internal/storage"
	"github.com/matinz03/deco/internal/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/go-chi/httprate"
	"github.com/joho/godotenv"
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
	if err := storage.EnsureDirectories(cfg.UploadRoot); err != nil {
		logger.Fatal("failed to prepare upload directories", zap.Error(err))
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
		handlers.RegisterAuthRoutes(r, pool, cfg, logger)
		handlers.RegisterUserRoutes(r, pool, cfg, logger)
		handlers.RegisterConversationRoutes(r, pool, cfg, logger)
		handlers.RegisterUploadRoutes(r, pool, cfg, logger)
		handlers.RegisterMessageRoutes(r, pool, cfg, logger, hub)
	})

	// WebSocket endpoint — auth handled inside the handler via ?token= query param
	uploadBase := cfg.PublicUploadBase
	if uploadBase == "" {
		uploadBase = "/api/v1/media"
	}
	uploadHandler := http.FileServer(http.Dir(cfg.UploadRoot))
	r.Handle(uploadBase+"/*", http.StripPrefix(uploadBase+"/", uploadHandler))
	if uploadBase != "/uploads" {
		r.Handle("/uploads/*", http.StripPrefix("/uploads/", uploadHandler))
	}
	r.Get("/ws", websocket.Handler(hub, pool, cfg, logger))

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
