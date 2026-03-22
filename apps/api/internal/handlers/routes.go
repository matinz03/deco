package handlers

import (
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/websocket"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

func RegisterAuthRoutes(r chi.Router, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger) {
	h := &AuthHandler{pool: pool, cfg: cfg, logger: logger}
	r.Route("/auth", func(r chi.Router) {
		r.Post("/register", h.Register)
		r.Post("/login", h.Login)
		r.Post("/logout", h.Logout)
		r.Post("/refresh", h.Refresh)
	})
}

func RegisterUserRoutes(r chi.Router, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger) {
	h := &UserHandler{pool: pool, cfg: cfg, logger: logger}
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret))
		r.Route("/users", func(r chi.Router) {
			r.Get("/me", h.GetMe)
			r.Patch("/me", h.UpdateMe)
			r.Get("/me/key-backup", h.GetKeyBackup)
			r.Put("/me/key-backup", h.PutKeyBackup)
			r.Delete("/me/key-backup", h.DeleteKeyBackup)
			r.Get("/search", h.Search)
			r.Get("/{userID}", h.GetUser)
		})
	})
}

func RegisterConversationRoutes(r chi.Router, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger) {
	h := &ConversationHandler{pool: pool, cfg: cfg, logger: logger}
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret))
		r.Route("/conversations", func(r chi.Router) {
			r.Get("/", h.List)
			r.Post("/", h.Create)
			r.Get("/{conversationID}", h.Get)
			r.Patch("/{conversationID}", h.Update)
			r.Get("/{conversationID}/members", h.ListMembers)
			r.Post("/{conversationID}/members", h.AddMember)
			r.Delete("/{conversationID}/members/{userID}", h.RemoveMember)
		})
	})
}

func RegisterPushRoutes(r chi.Router, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger) {
	h := &PushHandler{pool: pool, cfg: cfg, logger: logger}
	// Public: VAPID public key (no auth needed — clients need it before subscribing)
	r.Get("/push/vapid-public-key", h.GetVAPIDPublicKey)
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret))
		r.Post("/push/subscribe", h.Subscribe)
		r.Post("/push/unsubscribe", h.Unsubscribe)
	})
}

func RegisterMessageRoutes(r chi.Router, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger, hub *websocket.Hub) {
	h := &MessageHandler{pool: pool, cfg: cfg, logger: logger, hub: hub}
	r.Group(func(r chi.Router) {
		r.Use(middleware.Auth(cfg.JWTSecret))
		r.Route("/conversations/{conversationID}/messages", func(r chi.Router) {
			r.Get("/", h.List)
			r.Post("/", h.Send)
			r.Post("/read", h.MarkRead)
			r.Patch("/{messageID}", h.Edit)
			r.Delete("/{messageID}", h.Delete)
			r.Post("/{messageID}/reactions", h.AddReaction)
			r.Delete("/{messageID}/reactions/{emoji}", h.RemoveReaction)
		})
	})
}
