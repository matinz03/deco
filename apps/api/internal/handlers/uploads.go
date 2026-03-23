package handlers

import (
	"bufio"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/matinz03/deco/internal/config"
	appmiddleware "github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/storage"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type UploadHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
}

func (h *UploadHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := appmiddleware.GetUserID(r)
	if userID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := r.ParseMultipartForm(128 << 20); err != nil {
		respondError(w, http.StatusBadRequest, "failed to parse upload")
		return
	}

	kind := storage.Kind(strings.TrimSpace(r.FormValue("kind")))
	if !isAllowedUploadKind(kind) {
		respondError(w, http.StatusBadRequest, "unsupported upload kind")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		respondError(w, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	if header.Size <= 0 {
		respondError(w, http.StatusBadRequest, "empty file")
		return
	}
	if header.Size > maxBytesForKind(kind) {
		respondError(w, http.StatusBadRequest, "file is too large")
		return
	}

	reader := bufio.NewReader(file)
	headerBytes, _ := reader.Peek(512)
	mimeType := storage.DetectMimeType(headerBytes, header.Header.Get("Content-Type"))
	if !isAllowedUpload(kind, mimeType, header.Filename) {
		respondError(w, http.StatusBadRequest, "file type is not allowed")
		return
	}

	saved, err := storage.Save(kind, h.cfg.UploadRoot, h.cfg.PublicUploadBase, header.Filename, mimeType, reader, header.Size)
	if err != nil {
		h.logger.Error("failed to save upload", zap.Error(err), zap.String("user_id", userID), zap.String("kind", string(kind)))
		respondError(w, http.StatusInternalServerError, "failed to save upload")
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"url":       saved.URL,
		"mime_type": saved.MimeType,
		"size":      saved.Size,
		"name":      saved.Name,
		"kind":      kind,
	})
}

func isAllowedUploadKind(kind storage.Kind) bool {
	switch kind {
	case storage.KindAvatar, storage.KindImage, storage.KindVideo, storage.KindAudio, storage.KindFile:
		return true
	default:
		return false
	}
}

func maxBytesForKind(kind storage.Kind) int64 {
	switch kind {
	case storage.KindAvatar, storage.KindImage:
		return 10 << 20
	case storage.KindAudio:
		return 25 << 20
	case storage.KindVideo:
		return 100 << 20
	case storage.KindFile:
		return 50 << 20
	default:
		return 10 << 20
	}
}

func isAllowedUpload(kind storage.Kind, mimeType, filename string) bool {
	if isAllowedMime(kind, mimeType) {
		return true
	}
	return isAllowedExtension(kind, filename)
}

func isAllowedMime(kind storage.Kind, mimeType string) bool {
	mimeType = strings.ToLower(strings.TrimSpace(mimeType))
	switch kind {
	case storage.KindAvatar, storage.KindImage:
		return strings.HasPrefix(mimeType, "image/")
	case storage.KindVideo:
		return strings.HasPrefix(mimeType, "video/") || mimeType == "application/mp4"
	case storage.KindAudio:
		return strings.HasPrefix(mimeType, "audio/") || mimeType == "video/webm" || mimeType == "application/mp4"
	case storage.KindFile:
		return true
	default:
		return false
	}
}

func isAllowedExtension(kind storage.Kind, filename string) bool {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))
	if ext == "" {
		return false
	}

	switch kind {
	case storage.KindAvatar, storage.KindImage:
		return matchesExtension(ext, ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg")
	case storage.KindVideo:
		return matchesExtension(ext, ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv")
	case storage.KindAudio:
		return matchesExtension(ext, ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".flac", ".webm", ".mp4")
	case storage.KindFile:
		return true
	default:
		return false
	}
}

func matchesExtension(ext string, allowed ...string) bool {
	for _, candidate := range allowed {
		if ext == candidate {
			return true
		}
	}
	return false
}
