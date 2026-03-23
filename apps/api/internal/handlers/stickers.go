package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/models"
	"github.com/matinz03/deco/internal/storage"
	"github.com/matinz03/deco/internal/telegram"
	"go.uber.org/zap"
)

type StickerHandler struct {
	pool     *pgxpool.Pool
	cfg      *config.Config
	logger   *zap.Logger
	telegram *telegram.Client
}

func (h *StickerHandler) ListPacks(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	packs, err := h.loadPacks(r.Context(), userID)
	if err != nil {
		h.logger.Error("failed to list sticker packs", zap.Error(err), zap.String("user_id", userID))
		respondError(w, http.StatusInternalServerError, "failed to load sticker packs")
		return
	}
	respondJSON(w, http.StatusOK, packs)
}

func (h *StickerHandler) GetPack(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	packID := chi.URLParam(r, "packID")
	pack, err := h.loadPackByID(r.Context(), userID, packID)
	if err != nil {
		if err == pgx.ErrNoRows {
			respondError(w, http.StatusNotFound, "sticker pack not found")
			return
		}
		h.logger.Error("failed to load sticker pack", zap.Error(err), zap.String("pack_id", packID))
		respondError(w, http.StatusInternalServerError, "failed to load sticker pack")
		return
	}
	respondJSON(w, http.StatusOK, pack)
}

func (h *StickerHandler) CreatePack(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	var req struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		respondError(w, http.StatusBadRequest, "title is required")
		return
	}

	name := stickerPackName(title)
	slug := buildPackSlug(name)
	var pack models.StickerPack
	err := h.pool.QueryRow(r.Context(), `
		INSERT INTO sticker_packs (owner_id, name, slug, title, description, source)
		VALUES ($1, $2, $3, $4, $5, 'deco')
		RETURNING id, owner_id, name, slug, title, description, source, telegram_set_name, cover_sticker_id, created_at, updated_at
	`, userID, name, slug, title, strings.TrimSpace(req.Description)).Scan(
		&pack.ID, &pack.OwnerID, &pack.Name, &pack.Slug, &pack.Title, &pack.Description, &pack.Source, &pack.TelegramSetName, &pack.CoverStickerID, &pack.CreatedAt, &pack.UpdatedAt,
	)
	if err != nil {
		h.logger.Error("failed to create sticker pack", zap.Error(err), zap.String("user_id", userID))
		respondError(w, http.StatusInternalServerError, "failed to create sticker pack")
		return
	}

	respondJSON(w, http.StatusCreated, pack)
}

func (h *StickerHandler) AddSticker(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	packID := chi.URLParam(r, "packID")
	var req struct {
		Name                 string `json:"name"`
		Emoji                string `json:"emoji"`
		AssetURL             string `json:"asset_url"`
		ThumbnailURL         string `json:"thumbnail_url"`
		MimeType             string `json:"mime_type"`
		Format               string `json:"format"`
		TelegramFileID       string `json:"telegram_file_id"`
		TelegramUniqueFileID string `json:"telegram_unique_file_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if !h.canEditPack(r.Context(), userID, packID) {
		respondError(w, http.StatusForbidden, "you can't edit this sticker pack")
		return
	}

	format, ok := normalizeStickerFormat(req.Format, req.MimeType, req.AssetURL)
	if !ok {
		respondError(w, http.StatusBadRequest, "unsupported sticker format")
		return
	}
	if strings.TrimSpace(req.AssetURL) == "" || strings.TrimSpace(req.Emoji) == "" {
		respondError(w, http.StatusBadRequest, "emoji and asset_url are required")
		return
	}

	sticker, err := h.insertSticker(r.Context(), packID, insertStickerInput{
		Name:                 strings.TrimSpace(req.Name),
		Emoji:                strings.TrimSpace(req.Emoji),
		AssetURL:             strings.TrimSpace(req.AssetURL),
		ThumbnailURL:         strings.TrimSpace(req.ThumbnailURL),
		MimeType:             strings.TrimSpace(req.MimeType),
		Format:               format,
		TelegramFileID:       strings.TrimSpace(req.TelegramFileID),
		TelegramUniqueFileID: strings.TrimSpace(req.TelegramUniqueFileID),
	})
	if err != nil {
		h.logger.Error("failed to add sticker", zap.Error(err), zap.String("pack_id", packID))
		respondError(w, http.StatusInternalServerError, "failed to add sticker")
		return
	}

	respondJSON(w, http.StatusCreated, sticker)
}

func (h *StickerHandler) ImportTelegramPack(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	if h.telegram == nil {
		respondError(w, http.StatusServiceUnavailable, "telegram import is not configured")
		return
	}

	var req struct {
		Input string `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	setName := telegram.ParseStickerSetInput(req.Input)
	if setName == "" {
		respondError(w, http.StatusBadRequest, "telegram sticker pack link or shortname is required")
		return
	}

	stickerSet, err := h.telegram.GetStickerSet(r.Context(), setName)
	if err != nil {
		h.logger.Error("failed to load telegram sticker set", zap.Error(err), zap.String("set_name", setName))
		respondError(w, http.StatusBadGateway, "failed to load telegram sticker pack")
		return
	}
	if stickerSet.StickerType != "regular" {
		respondError(w, http.StatusBadRequest, "only regular telegram sticker packs can be imported right now")
		return
	}

	pack, err := h.createOrReplaceImportedPack(r.Context(), userID, stickerSet)
	if err != nil {
		h.logger.Error("failed to prepare imported sticker pack", zap.Error(err), zap.String("set_name", setName))
		respondError(w, http.StatusInternalServerError, "failed to prepare sticker pack")
		return
	}

	importedCount := 0
	skipped := []string{}
	for index, sticker := range stickerSet.Stickers {
		if sticker.IsAnimated {
			skipped = append(skipped, "Animated .tgs stickers are not supported yet.")
			continue
		}

		file, err := h.telegram.GetFile(r.Context(), sticker.FileID)
		if err != nil || strings.TrimSpace(file.FilePath) == "" {
			skipped = append(skipped, fmt.Sprintf("Couldn't fetch file for %s.", sticker.FileID))
			continue
		}

		reader, err := h.telegram.DownloadFile(r.Context(), file.FilePath)
		if err != nil {
			skipped = append(skipped, fmt.Sprintf("Couldn't download %s.", sticker.FileID))
			continue
		}

		filename := filepath.Base(file.FilePath)
		mimeType := mimeTypeForTelegramSticker(filename, sticker)
		saved, saveErr := storage.Save(storage.KindSticker, h.cfg.UploadRoot, h.cfg.PublicUploadBase, filename, mimeType, reader, 0)
		reader.Close()
		if saveErr != nil {
			skipped = append(skipped, fmt.Sprintf("Couldn't save %s.", filename))
			continue
		}

		var thumbnailURL string
		if sticker.Thumbnail != nil && sticker.Thumbnail.FileID != "" {
			if thumb, thumbErr := h.importTelegramThumbnail(r.Context(), sticker.Thumbnail.FileID); thumbErr == nil {
				thumbnailURL = thumb
			}
		}

		if _, err := h.insertSticker(r.Context(), pack.ID, insertStickerInput{
			Name:                 firstNonEmpty(sticker.Emoji, fmt.Sprintf("Sticker %d", index+1)),
			Emoji:                firstNonEmpty(sticker.Emoji, "🙂"),
			AssetURL:             saved.URL,
			ThumbnailURL:         thumbnailURL,
			MimeType:             saved.MimeType,
			Format:               stickerFormatFromTelegram(sticker),
			TelegramFileID:       sticker.FileID,
			TelegramUniqueFileID: sticker.FileUniqueID,
			Width:                valueOrNil(sticker.Width),
			Height:               valueOrNil(sticker.Height),
		}); err != nil {
			skipped = append(skipped, fmt.Sprintf("Couldn't index %s.", filename))
			continue
		}

		importedCount++
	}

	pack, err = h.loadPackByID(r.Context(), userID, pack.ID)
	if err != nil {
		h.logger.Error("failed to load imported sticker pack", zap.Error(err), zap.String("pack_id", pack.ID))
		respondError(w, http.StatusInternalServerError, "failed to load imported sticker pack")
		return
	}

	respondJSON(w, http.StatusCreated, map[string]any{
		"pack":           pack,
		"imported_count": importedCount,
		"skipped":        dedupeStrings(skipped),
	})
}

type insertStickerInput struct {
	Name                 string
	Emoji                string
	AssetURL             string
	ThumbnailURL         string
	MimeType             string
	Format               models.StickerFormat
	TelegramFileID       string
	TelegramUniqueFileID string
	Width                *int
	Height               *int
}

func (h *StickerHandler) loadPacks(ctx context.Context, userID string) ([]models.StickerPack, error) {
	rows, err := h.pool.Query(ctx, `
		SELECT
			p.id, p.owner_id, p.name, p.slug, p.title, p.description, p.source,
			p.telegram_set_name, p.cover_sticker_id, p.created_at, p.updated_at,
			COUNT(s.id)::int AS sticker_count
		FROM sticker_packs p
		LEFT JOIN stickers s ON s.pack_id = p.id
		WHERE p.owner_id = $1
		GROUP BY p.id
		ORDER BY p.updated_at DESC, p.created_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	packs := []models.StickerPack{}
	for rows.Next() {
		var pack models.StickerPack
		if err := rows.Scan(
			&pack.ID, &pack.OwnerID, &pack.Name, &pack.Slug, &pack.Title, &pack.Description, &pack.Source,
			&pack.TelegramSetName, &pack.CoverStickerID, &pack.CreatedAt, &pack.UpdatedAt, &pack.StickerCount,
		); err == nil {
			packs = append(packs, pack)
		}
	}

	if err := h.attachStickers(ctx, packs); err != nil {
		return nil, err
	}
	return packs, nil
}

func (h *StickerHandler) loadPackByID(ctx context.Context, userID, packID string) (*models.StickerPack, error) {
	var pack models.StickerPack
	err := h.pool.QueryRow(ctx, `
		SELECT
			p.id, p.owner_id, p.name, p.slug, p.title, p.description, p.source,
			p.telegram_set_name, p.cover_sticker_id, p.created_at, p.updated_at,
			COUNT(s.id)::int AS sticker_count
		FROM sticker_packs p
		LEFT JOIN stickers s ON s.pack_id = p.id
		WHERE p.id = $1 AND p.owner_id = $2
		GROUP BY p.id
	`, packID, userID).Scan(
		&pack.ID, &pack.OwnerID, &pack.Name, &pack.Slug, &pack.Title, &pack.Description, &pack.Source,
		&pack.TelegramSetName, &pack.CoverStickerID, &pack.CreatedAt, &pack.UpdatedAt, &pack.StickerCount,
	)
	if err != nil {
		return nil, err
	}

	if err := h.attachStickers(ctx, []models.StickerPack{pack}); err != nil {
		return nil, err
	}
	packs, err := h.loadPacks(ctx, userID)
	if err != nil {
		return nil, err
	}
	for i := range packs {
		if packs[i].ID == packID {
			return &packs[i], nil
		}
	}
	return &pack, nil
}

func (h *StickerHandler) attachStickers(ctx context.Context, packs []models.StickerPack) error {
	if len(packs) == 0 {
		return nil
	}

	index := make(map[string]int, len(packs))
	ids := make([]string, 0, len(packs))
	for i, pack := range packs {
		index[pack.ID] = i
		ids = append(ids, pack.ID)
	}

	rows, err := h.pool.Query(ctx, `
		SELECT
			id, pack_id, name, emoji, asset_url, thumbnail_url, mime_type, format,
			width, height, telegram_file_id, telegram_unique_file_id, sort_order, created_at
		FROM stickers
		WHERE pack_id = ANY($1)
		ORDER BY sort_order ASC, created_at ASC
	`, ids)
	if err != nil {
		return err
	}
	defer rows.Close()

	for rows.Next() {
		var sticker models.Sticker
		if err := rows.Scan(
			&sticker.ID, &sticker.PackID, &sticker.Name, &sticker.Emoji, &sticker.AssetURL, &sticker.ThumbnailURL,
			&sticker.MimeType, &sticker.Format, &sticker.Width, &sticker.Height, &sticker.TelegramFileID, &sticker.TelegramUniqueFileID,
			&sticker.SortOrder, &sticker.CreatedAt,
		); err == nil {
			if i, ok := index[sticker.PackID]; ok {
				packs[i].Stickers = append(packs[i].Stickers, sticker)
				if packs[i].CoverStickerID != nil && *packs[i].CoverStickerID == sticker.ID {
					copySticker := sticker
					packs[i].CoverSticker = &copySticker
				}
			}
		}
	}

	for i := range packs {
		packs[i].StickerCount = len(packs[i].Stickers)
		if packs[i].CoverSticker == nil && len(packs[i].Stickers) > 0 {
			packs[i].CoverSticker = &packs[i].Stickers[0]
		}
	}
	return nil
}

func (h *StickerHandler) canEditPack(ctx context.Context, userID, packID string) bool {
	var source models.StickerPackSource
	err := h.pool.QueryRow(ctx, `
		SELECT source
		FROM sticker_packs
		WHERE id = $1 AND owner_id = $2
	`, packID, userID).Scan(&source)
	return err == nil && source == models.StickerPackSourceDeco
}

func (h *StickerHandler) insertSticker(ctx context.Context, packID string, input insertStickerInput) (*models.Sticker, error) {
	var sortOrder int
	if err := h.pool.QueryRow(ctx, `
		SELECT COALESCE(MAX(sort_order), -1) + 1 FROM stickers WHERE pack_id = $1
	`, packID).Scan(&sortOrder); err != nil {
		return nil, err
	}

	name := strings.TrimSpace(input.Name)
	if name == "" {
		name = "Sticker"
	}

	var sticker models.Sticker
	err := h.pool.QueryRow(ctx, `
		INSERT INTO stickers (
			pack_id, name, emoji, asset_url, thumbnail_url, mime_type, format,
			width, height, telegram_file_id, telegram_unique_file_id, sort_order
		)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7, $8, $9, NULLIF($10, ''), NULLIF($11, ''), $12)
		RETURNING id, pack_id, name, emoji, asset_url, thumbnail_url, mime_type, format,
		          width, height, telegram_file_id, telegram_unique_file_id, sort_order, created_at
	`, packID, name, firstNonEmpty(input.Emoji, "🙂"), input.AssetURL, input.ThumbnailURL, input.MimeType, input.Format,
		input.Width, input.Height, input.TelegramFileID, input.TelegramUniqueFileID, sortOrder).Scan(
		&sticker.ID, &sticker.PackID, &sticker.Name, &sticker.Emoji, &sticker.AssetURL, &sticker.ThumbnailURL, &sticker.MimeType,
		&sticker.Format, &sticker.Width, &sticker.Height, &sticker.TelegramFileID, &sticker.TelegramUniqueFileID, &sticker.SortOrder, &sticker.CreatedAt,
	)
	if err != nil {
		return nil, err
	}

	_, _ = h.pool.Exec(ctx, `
		UPDATE sticker_packs
		SET cover_sticker_id = COALESCE(cover_sticker_id, $2),
		    updated_at = NOW()
		WHERE id = $1
	`, packID, sticker.ID)

	return &sticker, nil
}

func (h *StickerHandler) createOrReplaceImportedPack(ctx context.Context, userID string, stickerSet *telegram.StickerSet) (*models.StickerPack, error) {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var existingID string
	err = tx.QueryRow(ctx, `
		SELECT id
		FROM sticker_packs
		WHERE owner_id = $1 AND telegram_set_name = $2
	`, userID, stickerSet.Name).Scan(&existingID)
	if err == nil {
		if _, err := tx.Exec(ctx, `DELETE FROM stickers WHERE pack_id = $1`, existingID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE sticker_packs
			SET title = $2,
			    name = $3,
			    description = $4,
			    cover_sticker_id = NULL,
			    updated_at = NOW()
			WHERE id = $1
		`, existingID, stickerSet.Title, stickerPackName(stickerSet.Title), "Imported from Telegram"); err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return h.loadPackByID(ctx, userID, existingID)
	}
	if err != nil && err != pgx.ErrNoRows {
		return nil, err
	}

	var pack models.StickerPack
	err = tx.QueryRow(ctx, `
		INSERT INTO sticker_packs (owner_id, name, slug, title, description, source, telegram_set_name)
		VALUES ($1, $2, $3, $4, $5, 'telegram', $6)
		RETURNING id, owner_id, name, slug, title, description, source, telegram_set_name, cover_sticker_id, created_at, updated_at
	`, userID, stickerPackName(stickerSet.Title), buildPackSlug(stickerSet.Name), stickerSet.Title, "Imported from Telegram", stickerSet.Name).Scan(
		&pack.ID, &pack.OwnerID, &pack.Name, &pack.Slug, &pack.Title, &pack.Description, &pack.Source, &pack.TelegramSetName, &pack.CoverStickerID, &pack.CreatedAt, &pack.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &pack, nil
}

func (h *StickerHandler) importTelegramThumbnail(ctx context.Context, fileID string) (string, error) {
	file, err := h.telegram.GetFile(ctx, fileID)
	if err != nil || strings.TrimSpace(file.FilePath) == "" {
		return "", err
	}
	reader, err := h.telegram.DownloadFile(ctx, file.FilePath)
	if err != nil {
		return "", err
	}
	defer reader.Close()
	filename := filepath.Base(file.FilePath)
	saved, err := storage.Save(storage.KindSticker, h.cfg.UploadRoot, h.cfg.PublicUploadBase, filename, mimeTypeFromPath(filename), reader, 0)
	if err != nil {
		return "", err
	}
	return saved.URL, nil
}

func stickerPackName(title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return "stickers"
	}
	return title
}

func buildPackSlug(input string) string {
	input = strings.ToLower(strings.TrimSpace(input))
	var b strings.Builder
	lastDash := false
	for _, r := range input {
		switch {
		case (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9'):
			b.WriteRune(r)
			lastDash = false
		case !lastDash:
			b.WriteRune('-')
			lastDash = true
		}
	}
	slug := strings.Trim(b.String(), "-")
	if slug == "" {
		slug = fmt.Sprintf("pack-%d", timeNowUnix())
	}
	return fmt.Sprintf("%s-%d", slug, timeNowUnix())
}

func normalizeStickerFormat(format, mimeType, assetURL string) (models.StickerFormat, bool) {
	format = strings.TrimSpace(format)
	switch format {
	case string(models.StickerFormatStatic):
		return models.StickerFormatStatic, true
	case string(models.StickerFormatAnimated):
		return models.StickerFormatAnimated, true
	case string(models.StickerFormatVideo):
		return models.StickerFormatVideo, true
	}

	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(mimeType)), "video/") || strings.HasSuffix(strings.ToLower(assetURL), ".webm") {
		return models.StickerFormatVideo, true
	}
	if strings.HasSuffix(strings.ToLower(assetURL), ".tgs") {
		return models.StickerFormatAnimated, true
	}
	return models.StickerFormatStatic, true
}

func stickerFormatFromTelegram(sticker telegram.Sticker) models.StickerFormat {
	if sticker.IsVideo {
		return models.StickerFormatVideo
	}
	if sticker.IsAnimated {
		return models.StickerFormatAnimated
	}
	return models.StickerFormatStatic
}

func mimeTypeForTelegramSticker(filename string, sticker telegram.Sticker) string {
	if sticker.IsVideo {
		return "video/webm"
	}
	if sticker.IsAnimated || strings.HasSuffix(strings.ToLower(filename), ".tgs") {
		return "application/x-tgsticker"
	}
	return mimeTypeFromPath(filename)
}

func mimeTypeFromPath(filename string) string {
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".webm":
		return "video/webm"
	case ".tgs":
		return "application/x-tgsticker"
	default:
		return "application/octet-stream"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func valueOrNil(value int) *int {
	if value <= 0 {
		return nil
	}
	return &value
}

func dedupeStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func timeNowUnix() int64 {
	return timeNow().Unix()
}

var timeNow = func() time.Time {
	return time.Now().UTC()
}
