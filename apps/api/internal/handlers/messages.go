package handlers

import (
	"encoding/json"
	"net/http"

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
				m.media_url, m.media_mime_type, m.media_size,
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
				m.media_url, m.media_mime_type, m.media_size,
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
			&msg.MediaURL, &msg.MediaMimeType, &msg.MediaSize,
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
		ReplyToID        *string `json:"reply_to_id,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.EncryptedContent == "" {
		respondError(w, http.StatusBadRequest, "encrypted_content is required")
		return
	}
	if req.Type == "" {
		req.Type = "text"
	}

	var msg models.Message
	err := h.pool.QueryRow(r.Context(), `
		INSERT INTO messages (conversation_id, sender_id, type, encrypted_content, reply_to_id)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, conversation_id, sender_id, type, encrypted_content,
		          media_url, media_mime_type, media_size,
		          reply_to_id, status, is_edited, is_deleted, sent_at, edited_at
	`, convID, userID, req.Type, req.EncryptedContent, req.ReplyToID).Scan(
		&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Type, &msg.EncryptedContent,
		&msg.MediaURL, &msg.MediaMimeType, &msg.MediaSize,
		&msg.ReplyToID, &msg.Status, &msg.IsEdited, &msg.IsDeleted, &msg.SentAt, &msg.EditedAt,
	)
	if err != nil {
		h.logger.Error("failed to insert message", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to send message")
		return
	}

	var sender models.User
	h.pool.QueryRow(r.Context(), `
		SELECT id, username, display_name, avatar_url, public_key FROM users WHERE id = $1
	`, userID).Scan(&sender.ID, &sender.Username, &sender.DisplayName, &sender.AvatarURL, &sender.PublicKey)
	msg.Sender = &sender

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventMessage,
			Payload: mustMarshal(msg),
		})
	}

	h.pool.Exec(r.Context(), `UPDATE conversations SET updated_at = NOW() WHERE id = $1`, convID)

	respondJSON(w, http.StatusCreated, msg)
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
		          media_url, media_mime_type, media_size,
		          reply_to_id, status, is_edited, is_deleted, sent_at, edited_at
	`, req.EncryptedContent, msgID, convID, userID).Scan(
		&msg.ID, &msg.ConversationID, &msg.SenderID, &msg.Type, &msg.EncryptedContent,
		&msg.MediaURL, &msg.MediaMimeType, &msg.MediaSize,
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

	h.pool.Exec(r.Context(), `
		UPDATE members SET last_read_at = NOW()
		WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID)

	if h.hub != nil {
		h.broadcastToConversation(r, convID, websocket.Event{
			Type:    websocket.EventRead,
			Payload: mustMarshal(map[string]string{"conversation_id": convID, "user_id": userID}),
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
