package handlers

import (
	"github.com/matinz03/deco/internal/config"
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
	r.Route("/users", func(r chi.Router) {
		r.Get("/me", h.GetMe)
		r.Patch("/me", h.UpdateMe)
		r.Get("/search", h.Search)
		r.Get("/{userID}", h.GetUser)
	})
}

func RegisterConversationRoutes(r chi.Router, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger) {
	h := &ConversationHandler{pool: pool, cfg: cfg, logger: logger}
	r.Route("/conversations", func(r chi.Router) {
		r.Get("/", h.List)
		r.Post("/", h.Create)
		r.Get("/{conversationID}", h.Get)
		r.Patch("/{conversationID}", h.Update)
		r.Get("/{conversationID}/members", h.ListMembers)
		r.Post("/{conversationID}/members", h.AddMember)
		r.Delete("/{conversationID}/members/{userID}", h.RemoveMember)
	})
}

func RegisterMessageRoutes(r chi.Router, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger) {
	h := &MessageHandler{pool: pool, cfg: cfg, logger: logger}
	r.Route("/conversations/{conversationID}/messages", func(r chi.Router) {
		r.Get("/", h.List)
		r.Post("/", h.Send)
		r.Patch("/{messageID}", h.Edit)
		r.Delete("/{messageID}", h.Delete)
		r.Post("/{messageID}/reactions", h.AddReaction)
		r.Delete("/{messageID}/reactions/{emoji}", h.RemoveReaction)
	})
}
