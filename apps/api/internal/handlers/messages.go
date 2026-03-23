package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/models"
	"github.com/matinz03/deco/internal/websocket"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type MessageHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
	hub    *websocket.Hub
}

// List returns messages for a conversation, cursor-paginated (before= query param).
func (h *MessageHandler) List(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	// Verify membership
	var count int
	h.pool.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&count)
	if count == 0 {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	before := r.URL.Query().Get("before")
	const limit = 50

	var (
		rows pgx.Rows
		err  error
	)

	if before != "" {
		rows, err = h.pool.Query(r.Context(), `
			SELECT
				m.id, m.conversation_id, m.sender_id, m.type, m.encrypted_content,
				m.media_url, m.media_name, m.media_mime_type, m.media_size,
				m.reply_to_id, m.status, m.is_edited, m.is_deleted, m.sent_at, m.edited_at,
				u.id, u.username, u.display_name, u.avatar_url, u.public_key
			FROM messages m
			JOIN users u ON u.id = m.sender_id
			WHERE m.conversation_id = $1
			  AND m.is_deleted = false
			  AND m.sent_at < $2::timestamptz
			ORDER BY m.sent_at DESC
			LIMIT $3
		`, convID, before, limit)
	} else {
		rows, err = h.pool.Query(r.Context(), `
			SELECT
				m.id, m.conversation_id, m.sender_id, m.type, m.encrypted_content,
				m.media_url, m.media_name, m.media_mime_type, m.media_size,
				m.reply_to_id, m.status, m.is_edited, m.is_deleted, m.sent_at, m.edited_at,
				u.id, u.username, u.display_name, u.avatar_url, u.public_key
			FROM messages m
			JOIN users u ON u.id = m.sender_id
			WHERE m.conversation_id = $1
			  AND m.is_deleted = false
			ORDER BY m.sent_at DESC
			LIMIT $2
		`, convID, limit)
	}
	if err != nil {
		h.logger.Error("failed to list messages", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to fetch messages")
		return
	}
	defer rows.Close()

	messages := []models.Message{}
	for rows.Next() {
		var msg models.Message
		var sender models.User
		if err := rows.Scan(
			&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Type, &msg.EncryptedContent,
			&msg.MediaURL, &msg.MediaName, &msg.MediaMimeType, &msg.MediaSize,
			&msg.ReplyToID, &msg.Status, &msg.IsEdited, &msg.IsDeleted, &msg.SentAt, &msg.EditedAt,
			&sender.ID, &sender.Username, &sender.DisplayName, &sender.AvatarURL, &sender.PublicKey,
		); err != nil {
			h.logger.Error("scan error", zap.Error(err))
			continue
		}
		msg.Sender = &sender
		messages = append(messages, msg)
	}

	if len(messages) > 0 {
		ids := make([]string, len(messages))
		for i, m := range messages {
			ids[i] = m.ID
		}
		h.attachReactions(r, messages, ids)
		h.attachPolls(r, messages, ids, userID)
	}

	respondJSON(w, http.StatusOK, messages)
}

// attachReactions fetches reactions for a batch of messages and mutates the slice in-place.
func (h *MessageHandler) attachReactions(r *http.Request, messages []models.Message, ids []string) {
	rrows, err := h.pool.Query(r.Context(), `
		SELECT message_id, user_id, emoji, created_at
		FROM reactions
		WHERE message_id = ANY($1)
		ORDER BY created_at
	`, ids)
	if err != nil {
		return
	}
	defer rrows.Close()

	index := make(map[string]int, len(messages))
	for i, m := range messages {
		index[m.ID] = i
	}

	for rrows.Next() {
		var rx models.Reaction
		if err := rrows.Scan(&rx.MessageID, &rx.UserID, &rx.Emoji, &rx.CreatedAt); err == nil {
			if i, ok := index[rx.MessageID]; ok {
				messages[i].Reactions = append(messages[i].Reactions, rx)
			}
		}
	}
}

// Send persists and broadcasts a new message.
func (h *MessageHandler) Send(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	var count int
	h.pool.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&count)
	if count == 0 {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	var req struct {
		Type             string  `json:"type"`
		EncryptedContent string  `json:"encrypted_content"`
		MediaURL         string  `json:"media_url"`
		MediaName        string  `json:"media_name"`
		MediaMimeType    string  `json:"media_mime_type"`
		MediaSize        *int64  `json:"media_size"`
		ReplyToID        *string `json:"reply_to_id,omitempty"`
		Poll             *struct {
			Question       string   `json:"question"`
			Options        []string `json:"options"`
			AllowsMultiple bool     `json:"allows_multiple"`
		} `json:"poll,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Type == "" {
		req.Type = "text"
	}
	isMediaMessage := req.Type == "image" || req.Type == "video" || req.Type == "audio" || req.Type == "file"
	isPollMessage := req.Type == "poll"
	if !isMediaMessage && req.EncryptedContent == "" {
		if !isPollMessage {
			respondError(w, http.StatusBadRequest, "encrypted_content is required")
			return
		}
	}
	if isPollMessage {
		if req.Poll == nil {
			respondError(w, http.StatusBadRequest, "poll is required")
			return
		}
		normalizedOptions := normalizePollOptions(req.Poll.Options)
		if strings.TrimSpace(req.Poll.Question) == "" || len(normalizedOptions) < 2 {
			respondError(w, http.StatusBadRequest, "poll requires a question and at least two options")
			return
		}
		req.Poll.Question = strings.TrimSpace(req.Poll.Question)
		req.Poll.Options = normalizedOptions
	}
	if isMediaMessage && req.MediaURL == "" {
		respondError(w, http.StatusBadRequest, "media_url is required for media messages")
		return
	}

	var msg models.Message
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to start message transaction")
		return
	}
	defer tx.Rollback(r.Context())

	err = tx.QueryRow(r.Context(), `
		INSERT INTO messages (
			conversation_id, sender_id, type, encrypted_content,
			media_url, media_name, media_mime_type, media_size, reply_to_id
		)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, conversation_id, sender_id, type, encrypted_content,
		          media_url, media_name, media_mime_type, media_size,
		          reply_to_id, status, is_edited, is_deleted, sent_at, edited_at
	`, convID, userID, req.Type, req.EncryptedContent, nullableString(req.MediaURL), nullableString(req.MediaName), nullableString(req.MediaMimeType), req.MediaSize, req.ReplyToID).Scan(
		&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Type, &msg.EncryptedContent,
		&msg.MediaURL, &msg.MediaName, &msg.MediaMimeType, &msg.MediaSize,
		&msg.ReplyToID, &msg.Status, &msg.IsEdited, &msg.IsDeleted, &msg.SentAt, &msg.EditedAt,
	)
	if err != nil {
		h.logger.Error("failed to insert message", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to send message")
		return
	}

	if isPollMessage {
		if err := h.insertPoll(r, tx, msg.ID, req.Poll.Question, req.Poll.Options, req.Poll.AllowsMultiple); err != nil {
			h.logger.Error("failed to create poll", zap.Error(err))
			respondError(w, http.StatusInternalServerError, "failed to create poll")
			return
		}
	}

	var sender models.User
	tx.QueryRow(r.Context(), `
		SELECT id, username, display_name, avatar_url, public_key FROM users WHERE id = $1
	`, userID).Scan(&sender.ID, &sender.Username, &sender.DisplayName, &sender.AvatarURL, &sender.PublicKey)
	msg.Sender = &sender
	if isPollMessage {
		msg.Poll = h.loadPoll(r, tx, msg.ID, userID)
	}

	if err := tx.Commit(r.Context()); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to finalize message")
		return
	}

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventMessage,
			Payload: mustMarshal(msg),
		})
	}

	h.pool.Exec(r.Context(), `UPDATE conversations SET updated_at = NOW() WHERE id = $1`, convID)

	respondJSON(w, http.StatusCreated, msg)
}

func (h *MessageHandler) VotePoll(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	msgID := chi.URLParam(r, "messageID")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	var req struct {
		OptionID string `json:"option_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.OptionID) == "" {
		respondError(w, http.StatusBadRequest, "option_id is required")
		return
	}
	req.OptionID = strings.TrimSpace(req.OptionID)

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to start vote transaction")
		return
	}
	defer tx.Rollback(r.Context())

	var messageType string
	err = tx.QueryRow(r.Context(), `
		SELECT type FROM messages WHERE id = $1 AND conversation_id = $2 AND is_deleted = false
	`, msgID, convID).Scan(&messageType)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respondError(w, http.StatusNotFound, "poll message not found")
			return
		}
		respondError(w, http.StatusInternalServerError, "failed to load poll")
		return
	}
	if messageType != string(models.MessageTypePoll) {
		respondError(w, http.StatusBadRequest, "message is not a poll")
		return
	}

	var optionExists bool
	if err := tx.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM poll_options WHERE id = $1 AND message_id = $2
		)
	`, req.OptionID, msgID).Scan(&optionExists); err != nil || !optionExists {
		respondError(w, http.StatusBadRequest, "invalid poll option")
		return
	}

	if _, err := tx.Exec(r.Context(), `
		INSERT INTO poll_votes (message_id, option_id, user_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (message_id, user_id) DO UPDATE
		SET option_id = EXCLUDED.option_id, created_at = NOW()
	`, msgID, req.OptionID, userID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to save vote")
		return
	}

	var msg models.Message
	var sender models.User
	err = tx.QueryRow(r.Context(), `
		SELECT
			m.id, m.conversation_id, m.sender_id, m.type, m.encrypted_content,
			m.media_url, m.media_name, m.media_mime_type, m.media_size,
			m.reply_to_id, m.status, m.is_edited, m.is_deleted, m.sent_at, m.edited_at,
			u.id, u.username, u.display_name, u.avatar_url, u.public_key
		FROM messages m
		JOIN users u ON u.id = m.sender_id
		WHERE m.id = $1
	`, msgID).Scan(
		&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Type, &msg.EncryptedContent,
		&msg.MediaURL, &msg.MediaName, &msg.MediaMimeType, &msg.MediaSize,
		&msg.ReplyToID, &msg.Status, &msg.IsEdited, &msg.IsDeleted, &msg.SentAt, &msg.EditedAt,
		&sender.ID, &sender.Username, &sender.DisplayName, &sender.AvatarURL, &sender.PublicKey,
	)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to reload poll message")
		return
	}
	msg.Sender = &sender
	msg.Poll = h.loadPoll(r, tx, msg.ID, userID)
	if err := tx.Commit(r.Context()); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to finalize vote")
		return
	}

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventMessageEdited,
			Payload: mustMarshal(msg),
		})
	}

	respondJSON(w, http.StatusOK, msg)
}

// Edit updates the encrypted content of a message the caller owns.
func (h *MessageHandler) Edit(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	msgID := chi.URLParam(r, "messageID")
	userID := middleware.GetUserID(r)

	var req struct {
		EncryptedContent string `json:"encrypted_content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.EncryptedContent == "" {
		respondError(w, http.StatusBadRequest, "encrypted_content is required")
		return
	}

	var msg models.Message
	err := h.pool.QueryRow(r.Context(), `
		UPDATE messages
		SET encrypted_content = $1, is_edited = true, edited_at = NOW()
		WHERE id = $2 AND conversation_id = $3 AND sender_id = $4 AND is_deleted = false
		RETURNING id, conversation_id, sender_id, type, encrypted_content,
		          media_url, media_name, media_mime_type, media_size,
		          reply_to_id, status, is_edited, is_deleted, sent_at, edited_at
	`, req.EncryptedContent, msgID, convID, userID).Scan(
		&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Type, &msg.EncryptedContent,
		&msg.MediaURL, &msg.MediaName, &msg.MediaMimeType, &msg.MediaSize,
		&msg.ReplyToID, &msg.Status, &msg.IsEdited, &msg.IsDeleted, &msg.SentAt, &msg.EditedAt,
	)
	if err != nil {
		respondError(w, http.StatusNotFound, "message not found or not yours")
		return
	}

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventMessageEdited,
			Payload: mustMarshal(msg),
		})
	}

	respondJSON(w, http.StatusOK, msg)
}

// Delete soft-deletes a message (sender can delete their own; admin/owner can delete any).
func (h *MessageHandler) Delete(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	msgID := chi.URLParam(r, "messageID")
	userID := middleware.GetUserID(r)

	var senderID, role string
	h.pool.QueryRow(r.Context(), `SELECT sender_id FROM messages WHERE id = $1`, msgID).Scan(&senderID)
	h.pool.QueryRow(r.Context(), `
		SELECT role FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&role)

	if senderID != userID && role != "owner" && role != "admin" {
		respondError(w, http.StatusForbidden, "cannot delete this message")
		return
	}

	_, err := h.pool.Exec(r.Context(), `
		UPDATE messages
		SET is_deleted = true, encrypted_content = ''
		WHERE id = $1 AND conversation_id = $2
	`, msgID, convID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to delete message")
		return
	}

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventMessageDeleted,
			Payload: mustMarshal(map[string]string{"id": msgID, "conversation_id": convID}),
		})
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}

// AddReaction adds an emoji reaction to a message.
func (h *MessageHandler) AddReaction(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	msgID := chi.URLParam(r, "messageID")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	var req struct {
		Emoji string `json:"emoji"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Emoji == "" {
		respondError(w, http.StatusBadRequest, "emoji is required")
		return
	}

	var rx models.Reaction
	err := h.pool.QueryRow(r.Context(), `
		INSERT INTO reactions (message_id, user_id, emoji)
		VALUES ($1, $2, $3)
		ON CONFLICT (message_id, user_id, emoji) DO NOTHING
		RETURNING message_id, user_id, emoji, created_at
	`, msgID, userID, req.Emoji).Scan(&rx.MessageID, &rx.UserID, &rx.Emoji, &rx.CreatedAt)
	if err != nil {
		// ON CONFLICT DO NOTHING returns no row — idempotent, not an error
		respondJSON(w, http.StatusOK, map[string]string{"message": "reaction noted"})
		return
	}

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventMessageReaction,
			Payload: mustMarshal(map[string]any{"action": "add", "reaction": rx}),
		})
	}

	respondJSON(w, http.StatusCreated, rx)
}

// RemoveReaction deletes an emoji reaction.
func (h *MessageHandler) RemoveReaction(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	msgID := chi.URLParam(r, "messageID")
	emoji := chi.URLParam(r, "emoji")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	h.pool.Exec(r.Context(), `
		DELETE FROM reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3
	`, msgID, userID, emoji)

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventMessageReaction,
			Payload: mustMarshal(map[string]any{
				"action":     "remove",
				"message_id": msgID,
				"user_id":    userID,
				"emoji":      emoji,
			}),
		})
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "reaction removed"})
}

// MarkRead updates the caller's last_read_at for a conversation.
func (h *MessageHandler) MarkRead(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	now := time.Now().UTC()
	h.pool.Exec(r.Context(), `
		UPDATE members SET last_read_at = $3
		WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID, now)

	// Mark all messages in this conversation not sent by this user as "read"
	h.pool.Exec(r.Context(), `
		UPDATE messages SET status = 'read'
		WHERE conversation_id = $1 AND sender_id != $2 AND status != 'read'
	`, convID, userID)

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventRead,
			Payload: mustMarshal(map[string]string{
				"conversation_id": convID,
				"user_id":         userID,
				"last_read_at":    now.Format(time.RFC3339Nano),
			}),
		})
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "marked as read"})
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func (h *MessageHandler) broadcastToConversation(r *http.Request, convID string, event websocket.Event) {
	rows, err := h.pool.Query(r.Context(), `SELECT user_id FROM members WHERE conversation_id = $1`, convID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var uid string
		if rows.Scan(&uid) == nil {
			h.hub.SendToUser(uid, event) //nolint:errcheck
		}
	}
}

func mustMarshal(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func nullableString(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func normalizePollOptions(options []string) []string {
	result := make([]string, 0, len(options))
	for _, option := range options {
		trimmed := strings.TrimSpace(option)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return slices.Compact(result)
}

func (h *MessageHandler) insertPoll(r *http.Request, tx pgx.Tx, messageID, question string, options []string, allowsMultiple bool) error {
	if _, err := tx.Exec(r.Context(), `
		INSERT INTO polls (message_id, question, allows_multiple)
		VALUES ($1, $2, $3)
	`, messageID, question, allowsMultiple); err != nil {
		return err
	}

	for index, option := range options {
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO poll_options (message_id, text, position)
			VALUES ($1, $2, $3)
		`, messageID, option, index); err != nil {
			return err
		}
	}
	return nil
}

func (h *MessageHandler) attachPolls(r *http.Request, messages []models.Message, ids []string, userID string) {
	if len(ids) == 0 {
		return
	}

	byMessageID := make(map[string]*models.Poll)
	rows, err := h.pool.Query(r.Context(), `
		SELECT message_id, question, allows_multiple
		FROM polls
		WHERE message_id = ANY($1)
	`, ids)
	if err != nil {
		return
	}
	for rows.Next() {
		var poll models.Poll
		if err := rows.Scan(&poll.MessageID, &poll.Question, &poll.AllowsMultiple); err == nil {
			byMessageID[poll.MessageID] = &poll
		}
	}
	rows.Close()
	if len(byMessageID) == 0 {
		return
	}

	optionRows, err := h.pool.Query(r.Context(), `
		SELECT
			o.id,
			o.message_id,
			o.text,
			o.position,
			COUNT(v.user_id)::int AS vote_count,
			COALESCE(BOOL_OR(v.user_id = $2), false) AS voted_by_me
		FROM poll_options o
		LEFT JOIN poll_votes v ON v.option_id = o.id
		WHERE o.message_id = ANY($1)
		GROUP BY o.id, o.message_id, o.text, o.position
		ORDER BY o.message_id, o.position
	`, ids, userID)
	if err != nil {
		return
	}
	defer optionRows.Close()

	for optionRows.Next() {
		var option models.PollOption
		if err := optionRows.Scan(&option.ID, &option.MessageID, &option.Text, &option.Position, &option.VoteCount, &option.VotedByMe); err == nil {
			if poll := byMessageID[option.MessageID]; poll != nil {
				poll.Options = append(poll.Options, option)
				poll.TotalVotes += option.VoteCount
			}
		}
	}

	for index := range messages {
		if poll := byMessageID[messages[index].ID]; poll != nil {
			messages[index].Poll = poll
		}
	}
}

func (h *MessageHandler) loadPoll(r *http.Request, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}, messageID, userID string) *models.Poll {
	var poll models.Poll
	if err := q.QueryRow(r.Context(), `
		SELECT message_id, question, allows_multiple
		FROM polls
		WHERE message_id = $1
	`, messageID).Scan(&poll.MessageID, &poll.Question, &poll.AllowsMultiple); err != nil {
		return nil
	}

	rows, err := q.Query(r.Context(), `
		SELECT
			o.id,
			o.message_id,
			o.text,
			o.position,
			COUNT(v.user_id)::int AS vote_count,
			COALESCE(BOOL_OR(v.user_id = $2), false) AS voted_by_me
		FROM poll_options o
		LEFT JOIN poll_votes v ON v.option_id = o.id
		WHERE o.message_id = $1
		GROUP BY o.id, o.message_id, o.text, o.position
		ORDER BY o.position
	`, messageID, userID)
	if err != nil {
		return &poll
	}
	defer rows.Close()

	for rows.Next() {
		var option models.PollOption
		if err := rows.Scan(&option.ID, &option.MessageID, &option.Text, &option.Position, &option.VoteCount, &option.VotedByMe); err == nil {
			poll.Options = append(poll.Options, option)
			poll.TotalVotes += option.VoteCount
		}
	}

	return &poll
}

func (h *MessageHandler) isConversationMember(r *http.Request, convID, userID string) bool {
	var count int
	if err := h.pool.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&count); err != nil {
		return false
	}
	return count > 0
}
