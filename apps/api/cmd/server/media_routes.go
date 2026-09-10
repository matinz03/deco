package main

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/storage"
)

func registerMediaRoutes(r chi.Router, cfg *config.Config, now func() time.Time) {
	uploadBase := cfg.PublicUploadBase
	if uploadBase == "" {
		uploadBase = "/api/v1/media"
	}
	mediaHandler := storage.NewMediaHandler(cfg.UploadRoot, cfg.JWTSecret, now)
	r.Handle(uploadBase+"/*", http.StripPrefix(uploadBase+"/", mediaHandler))
	if uploadBase != "/uploads" {
		r.Handle("/uploads/*", http.StripPrefix("/uploads/", mediaHandler))
	}
}
