package handlers

import (
	"bufio"
	"errors"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/matinz03/deco/internal/config"
	appmiddleware "github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/storage"
	"go.uber.org/zap"
)

type UploadHandler struct {
	pool    *pgxpool.Pool
	cfg     *config.Config
	logger  *zap.Logger
	storage storage.Backend
}

const (
	encryptedAttachmentOverhead int64 = 24 + 16
	maxUploadBodyBytes                = (100 << 20) + (1 << 20)
	multipartMemoryBytes              = 8 << 20
)

var errUploadRequestTooLarge = errors.New("upload request is too large")

func (h *UploadHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := appmiddleware.GetUserID(r)
	if userID == "" {
		respondError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	if err := parseUploadMultipartForm(w, r, maxUploadBodyBytes, multipartMemoryBytes); err != nil {
		if errors.Is(err, errUploadRequestTooLarge) {
			respondError(w, http.StatusRequestEntityTooLarge, "upload request is too large")
			return
		}
		respondError(w, http.StatusBadRequest, "failed to parse upload")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
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
	reader := bufio.NewReader(file)
	encrypted := strings.EqualFold(strings.TrimSpace(r.FormValue("encrypted")), "true")
	mimeType := ""
	responseMimeType := ""
	responseSize := header.Size
	if encrypted {
		originalSize, parseErr := strconv.ParseInt(strings.TrimSpace(r.FormValue("original_size")), 10, 64)
		originalMimeType := normalizeMimeType(r.FormValue("original_mime_type"))
		if parseErr != nil {
			respondError(w, http.StatusBadRequest, "invalid original file size")
			return
		}
		if validationErr := validateEncryptedUpload(kind, header.Filename, originalMimeType, originalSize, header.Size); validationErr != nil {
			respondError(w, http.StatusBadRequest, validationErr.Error())
			return
		}

		mimeType = "application/octet-stream"
		responseMimeType = originalMimeType
		responseSize = originalSize
	} else {
		if header.Size > maxBytesForKind(kind) {
			respondError(w, http.StatusBadRequest, "file is too large")
			return
		}
		headerBytes, _ := reader.Peek(512)
		mimeType = storage.DetectMimeType(headerBytes, header.Header.Get("Content-Type"))
		if !isAllowedUpload(kind, mimeType, header.Filename) {
			respondError(w, http.StatusBadRequest, "file type is not allowed")
			return
		}
		responseMimeType = mimeType
	}

	saved, err := storage.Save(r.Context(), h.storage, kind, header.Filename, mimeType, reader, header.Size)
	if err != nil {
		h.logger.Error("failed to save upload", zap.Error(err), zap.String("user_id", userID), zap.String("kind", string(kind)))
		respondError(w, http.StatusInternalServerError, "failed to save upload")
		return
	}
	if saved.Bucket == storage.BucketPrivate {
		storagePath := saved.Key
		if _, err := h.pool.Exec(r.Context(), `
			INSERT INTO media_objects (storage_path, owner_id, kind, encrypted, original_name, mime_type, size)
			VALUES ($1, $2, $3, $4, $5, $6, $7)
		`, storagePath, userID, string(kind), encrypted, saved.Name, responseMimeType, responseSize); err != nil {
			var databaseError *pgconn.PgError
			if errors.As(err, &databaseError) {
				if cleanupErr := h.storage.Delete(r.Context(), storage.ObjectRef{Bucket: saved.Bucket, Key: saved.Key}); cleanupErr != nil {
					h.logger.Error("failed to remove unregistered upload", zap.Error(cleanupErr), zap.String("path", storagePath))
				}
			} else {
				// Connection failures may be ambiguous: PostgreSQL could have
				// committed before the client observed the error. Leave the file
				// for reconciliation rather than creating a registered object that
				// points to missing media.
				h.logger.Warn("upload registration outcome is unknown; retaining file for reconciliation", zap.Error(err), zap.String("path", storagePath))
			}
			h.logger.Error("failed to register upload", zap.Error(err), zap.String("user_id", userID), zap.String("path", storagePath))
			respondError(w, http.StatusInternalServerError, "failed to register upload")
			return
		}
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"url":       saved.URL,
		"mime_type": responseMimeType,
		"size":      responseSize,
		"name":      saved.Name,
		"kind":      kind,
		"encrypted": encrypted,
	})
}

func parseUploadMultipartForm(w http.ResponseWriter, r *http.Request, maxBodyBytes, maxMemoryBytes int64) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := r.ParseMultipartForm(maxMemoryBytes); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			return errUploadRequestTooLarge
		}
		return err
	}
	return nil
}

func validateEncryptedUpload(kind storage.Kind, filename, originalMimeType string, originalSize, encryptedSize int64) error {
	if kind == storage.KindAvatar || kind == storage.KindSticker {
		return errors.New("public uploads cannot be encrypted")
	}
	if originalSize <= 0 || originalSize > maxEncryptedBytesForKind(kind) {
		return errors.New("invalid original file size")
	}
	if encryptedSize != originalSize+encryptedAttachmentOverhead {
		return errors.New("invalid encrypted attachment size")
	}
	if !isAllowedUpload(kind, originalMimeType, filename) {
		return errors.New("original file type is not allowed")
	}
	return nil
}

func maxEncryptedBytesForKind(kind storage.Kind) int64 {
	if kind == storage.KindImage {
		return 10 << 20
	}
	return 20 << 20
}

func isAllowedUploadKind(kind storage.Kind) bool {
	switch kind {
	case storage.KindAvatar, storage.KindImage, storage.KindVideo, storage.KindAudio, storage.KindFile, storage.KindSticker:
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
	case storage.KindSticker:
		return 12 << 20
	case storage.KindFile:
		return 50 << 20
	default:
		return 10 << 20
	}
}

func isAllowedUpload(kind storage.Kind, mimeType, filename string) bool {
	if !isAllowedExtension(kind, filename) {
		return false
	}
	if kind == storage.KindFile {
		return isAllowedFileMime(mimeType, filename)
	}
	if kind == storage.KindSticker && strings.EqualFold(filepath.Ext(strings.TrimSpace(filename)), ".tgs") {
		mimeType = normalizeMimeType(mimeType)
		return mimeType == "application/x-tgsticker" || mimeType == "application/gzip" || mimeType == "application/x-gzip"
	}
	return isAllowedMime(kind, mimeType)
}

func isAllowedMime(kind storage.Kind, mimeType string) bool {
	mimeType = normalizeMimeType(mimeType)
	if strings.Contains(mimeType, "html") || strings.Contains(mimeType, "javascript") || strings.Contains(mimeType, "svg") {
		return false
	}

	switch kind {
	case storage.KindAvatar, storage.KindImage:
		return strings.HasPrefix(mimeType, "image/") && mimeType != "image/svg+xml"
	case storage.KindVideo:
		return strings.HasPrefix(mimeType, "video/") || mimeType == "application/mp4"
	case storage.KindAudio:
		return strings.HasPrefix(mimeType, "audio/") || mimeType == "video/webm" || mimeType == "application/mp4"
	case storage.KindFile:
		return false
	case storage.KindSticker:
		return strings.HasPrefix(mimeType, "image/") || strings.HasPrefix(mimeType, "video/") || mimeType == "application/x-tgsticker"
	default:
		return false
	}
}

func isAllowedFileMime(mimeType, filename string) bool {
	mimeType = normalizeMimeType(mimeType)
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))

	switch ext {
	case ".pdf":
		return mimeType == "application/pdf"
	case ".txt":
		return mimeType == "text/plain"
	case ".csv":
		return mimeType == "text/csv" || mimeType == "text/plain"
	case ".doc":
		return mimeType == "application/msword"
	case ".docx":
		return mimeType == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || mimeType == "application/zip"
	case ".xls":
		return mimeType == "application/vnd.ms-excel"
	case ".xlsx":
		return mimeType == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || mimeType == "application/zip"
	case ".zip":
		return mimeType == "application/zip"
	case ".tar":
		return mimeType == "application/x-tar"
	case ".gz":
		return mimeType == "application/gzip" || mimeType == "application/x-gzip"
	case ".7z":
		return mimeType == "application/x-7z-compressed"
	case ".png":
		return mimeType == "image/png"
	case ".jpg", ".jpeg":
		return mimeType == "image/jpeg"
	case ".mp4":
		return mimeType == "video/mp4"
	case ".mp3":
		return mimeType == "audio/mpeg"
	default:
		return false
	}
}

func normalizeMimeType(mimeType string) string {
	return strings.ToLower(strings.TrimSpace(strings.Split(mimeType, ";")[0]))
}

func isAllowedExtension(kind storage.Kind, filename string) bool {
	ext := strings.ToLower(filepath.Ext(strings.TrimSpace(filename)))
	if ext == "" || matchesExtension(ext, ".html", ".htm", ".svg", ".js", ".exe", ".cmd", ".bat", ".sh", ".php") {
		return false
	}

	switch kind {
	case storage.KindAvatar, storage.KindImage:
		return matchesExtension(ext, ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp")
	case storage.KindVideo:
		return matchesExtension(ext, ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv")
	case storage.KindAudio:
		return matchesExtension(ext, ".mp3", ".m4a", ".aac", ".wav", ".ogg", ".oga", ".flac", ".webm", ".mp4")
	case storage.KindFile:
		return matchesExtension(ext, ".pdf", ".txt", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".zip", ".tar", ".gz", ".7z", ".png", ".jpg", ".jpeg", ".mp4", ".mp3")
	case storage.KindSticker:
		return matchesExtension(ext, ".png", ".jpg", ".jpeg", ".gif", ".webp", ".webm", ".tgs")
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
