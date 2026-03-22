package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/models"
	"github.com/jackc/pgx/v5/pgxpool"
	"go.uber.org/zap"
)

type ConversationHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
}

// List returns all conversations for the authenticated user,
// ordered by most recent message, with last message and unread count.
func (h *ConversationHandler) List(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	rows, err := h.pool.Query(r.Context(), `
		SELECT
			c.id, c.type, c.name, c.avatar_url, c.description,
			c.created_by_id, c.created_at, c.updated_at,
			COUNT(DISTINCT m2.id) FILTER (WHERE m2.sent_at > mb.last_read_at AND m2.sender_id <> $1) AS unread_count,
			COUNT(DISTINCT m3.user_id) AS member_count,
			-- Last message fields
			lm.id, lm.conversation_id, lm.sender_id, lm.type, lm.encrypted_content,
			lm.is_deleted, lm.sent_at
		FROM conversations c
		JOIN members mb ON mb.conversation_id = c.id AND mb.user_id = $1
		LEFT JOIN messages m2 ON m2.conversation_id = c.id AND m2.is_deleted = false
		LEFT JOIN members m3 ON m3.conversation_id = c.id
		LEFT JOIN LATERAL (
			SELECT id, conversation_id, sender_id, type, encrypted_content, is_deleted, sent_at
			FROM messages
			WHERE conversation_id = c.id
			ORDER BY sent_at DESC
			LIMIT 1
		) lm ON true
		GROUP BY c.id, mb.last_read_at, lm.id, lm.conversation_id, lm.sender_id, lm.type,
		         lm.encrypted_content, lm.is_deleted, lm.sent_at
		ORDER BY COALESCE(lm.sent_at, c.updated_at) DESC
	`, userID)

	if err != nil {
		h.logger.Error("failed to list conversations", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to fetch conversations")
		return
	}
	defer rows.Close()

	conversations := []models.Conversation{}
	for rows.Next() {
		var c models.Conversation
		var lastMsg models.Message
		var lastMsgID, lastMsgConversationID, lastMsgSenderID, lastMsgType, lastMsgContent *string
		var lastMsgDeleted *bool
		var lastMsgSentAt *time.Time

		err := rows.Scan(
			&c.ID, &c.Type, &c.Name, &c.AvatarURL, &c.Description,
			&c.CreatedByID, &c.CreatedAt, &c.UpdatedAt,
			&c.UnreadCount, &c.MemberCount,
			&lastMsgID, &lastMsgConversationID, &lastMsgSenderID, &lastMsgType, &lastMsgContent,
			&lastMsgDeleted, &lastMsgSentAt,
		)
		if err != nil {
			h.logger.Error("scan error", zap.Error(err))
			continue
		}

		if lastMsgID != nil {
			lastMsg.ID = *lastMsgID
			lastMsg.ConversationID = *lastMsgConversationID
			lastMsg.SenderID = *lastMsgSenderID
			lastMsg.Type = models.MessageType(*lastMsgType)
			lastMsg.EncryptedContent = *lastMsgContent
			lastMsg.IsDeleted = *lastMsgDeleted
			if lastMsgSentAt != nil {
				lastMsg.SentAt = *lastMsgSentAt
			}
			c.LastMessage = &lastMsg
		}

		conversations = append(conversations, c)
	}

	h.attachMembers(r, conversations)
	h.decorateDirectConversations(conversations, userID)

	respondJSON(w, http.StatusOK, conversations)
}

// Create starts a new conversation (direct or group).
func (h *ConversationHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Type      string   `json:"type"`
		Name      string   `json:"name"`
		MemberIDs []string `json:"member_ids"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Type == "" {
		req.Type = "direct"
	}

	// For direct messages, check if one already exists
	if req.Type == "direct" && len(req.MemberIDs) == 1 {
		otherID := req.MemberIDs[0]
		var existingID string
		err := h.pool.QueryRow(r.Context(), `
			SELECT c.id FROM conversations c
			JOIN members m1 ON m1.conversation_id = c.id AND m1.user_id = $1
			JOIN members m2 ON m2.conversation_id = c.id AND m2.user_id = $2
			WHERE c.type = 'direct'
			LIMIT 1
		`, userID, otherID).Scan(&existingID)
		if err == nil {
			// Return the existing conversation
			var conv models.Conversation
			h.pool.QueryRow(r.Context(), `
				SELECT id, type, name, avatar_url, description, created_by_id, created_at, updated_at
				FROM conversations WHERE id = $1
			`, existingID).Scan(&conv.ID, &conv.Type, &conv.Name, &conv.AvatarURL,
				&conv.Description, &conv.CreatedByID, &conv.CreatedAt, &conv.UpdatedAt)
			convSlice := []models.Conversation{conv}
			h.attachMembers(r, convSlice)
			h.decorateDirectConversations(convSlice, userID)
			conv = convSlice[0]
			respondJSON(w, http.StatusOK, conv)
			return
		}
	}

	// Create conversation in a transaction
	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "internal error")
		return
	}
	defer tx.Rollback(r.Context())

	var conv models.Conversation
	err = tx.QueryRow(r.Context(), `
		INSERT INTO conversations (type, name, created_by_id)
		VALUES ($1, $2, $3)
		RETURNING id, type, name, avatar_url, description, created_by_id, created_at, updated_at
	`, req.Type, req.Name, userID).
		Scan(&conv.ID, &conv.Type, &conv.Name, &conv.AvatarURL,
			&conv.Description, &conv.CreatedByID, &conv.CreatedAt, &conv.UpdatedAt)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to create conversation")
		return
	}

	// Add creator as owner
	tx.Exec(r.Context(), `
		INSERT INTO members (conversation_id, user_id, role) VALUES ($1, $2, 'owner')
	`, conv.ID, userID)

	// Add other members
	for _, memberID := range req.MemberIDs {
		if memberID != userID {
			tx.Exec(r.Context(), `
				INSERT INTO members (conversation_id, user_id, role) VALUES ($1, $2, 'member')
				ON CONFLICT DO NOTHING
			`, conv.ID, memberID)
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to create conversation")
		return
	}

	convSlice := []models.Conversation{conv}
	h.attachMembers(r, convSlice)
	h.decorateDirectConversations(convSlice, userID)
	conv = convSlice[0]

	respondJSON(w, http.StatusCreated, conv)
}

func (h *ConversationHandler) Get(w http.ResponseWriter, r *http.Request) {
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

	var conv models.Conversation
	err := h.pool.QueryRow(r.Context(), `
		SELECT id, type, name, avatar_url, description, created_by_id, created_at, updated_at
		FROM conversations WHERE id = $1
	`, convID).Scan(&conv.ID, &conv.Type, &conv.Name, &conv.AvatarURL,
		&conv.Description, &conv.CreatedByID, &conv.CreatedAt, &conv.UpdatedAt)
	if err != nil {
		respondError(w, http.StatusNotFound, "conversation not found")
		return
	}

	convSlice := []models.Conversation{conv}
	h.attachMembers(r, convSlice)
	h.decorateDirectConversations(convSlice, userID)
	conv = convSlice[0]

	respondJSON(w, http.StatusOK, conv)
}

func (h *ConversationHandler) Update(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	// Only admins/owners can update
	var role string
	h.pool.QueryRow(r.Context(), `
		SELECT role FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&role)
	if role != "owner" && role != "admin" {
		respondError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	var req struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		AvatarURL   string `json:"avatar_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	var conv models.Conversation
	err := h.pool.QueryRow(r.Context(), `
		UPDATE conversations
		SET name        = COALESCE(NULLIF($1,''), name),
		    description = COALESCE(NULLIF($2,''), description),
		    avatar_url  = COALESCE(NULLIF($3,''), avatar_url),
		    updated_at  = NOW()
		WHERE id = $4
		RETURNING id, type, name, avatar_url, description, created_by_id, created_at, updated_at
	`, req.Name, req.Description, req.AvatarURL, convID).
		Scan(&conv.ID, &conv.Type, &conv.Name, &conv.AvatarURL,
			&conv.Description, &conv.CreatedByID, &conv.CreatedAt, &conv.UpdatedAt)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to update conversation")
		return
	}

	respondJSON(w, http.StatusOK, conv)
}

func (h *ConversationHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT u.id, u.username, u.display_name, u.public_key, u.avatar_url,
		       u.bio, u.last_seen_at, u.created_at, mb.role, mb.joined_at
		FROM members mb
		JOIN users u ON u.id = mb.user_id
		WHERE mb.conversation_id = $1
		ORDER BY mb.joined_at
	`, convID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to fetch members")
		return
	}
	defer rows.Close()

	type MemberWithUser struct {
		models.User
		Role     string `json:"role"`
		JoinedAt string `json:"joined_at"`
	}

	members := []MemberWithUser{}
	for rows.Next() {
		var m MemberWithUser
		rows.Scan(&m.ID, &m.Username, &m.DisplayName, &m.PublicKey,
			&m.AvatarURL, &m.Bio, &m.LastSeenAt, &m.CreatedAt,
			&m.Role, &m.JoinedAt)
		members = append(members, m)
	}

	respondJSON(w, http.StatusOK, members)
}

func (h *ConversationHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	if !h.canManageMembers(r, convID, userID) {
		respondError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	var req struct {
		UserID string `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.UserID == "" {
		respondError(w, http.StatusBadRequest, "user_id is required")
		return
	}

	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO members (conversation_id, user_id, role)
		VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING
	`, convID, req.UserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to add member")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "member added"})
}

func (h *ConversationHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	targetUserID := chi.URLParam(r, "userID")
	userID := middleware.GetUserID(r)

	if !h.canManageMembers(r, convID, userID) {
		respondError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	h.pool.Exec(r.Context(), `
		DELETE FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, targetUserID)

	respondJSON(w, http.StatusOK, map[string]string{"message": "member removed"})
}

func (h *ConversationHandler) attachMembers(r *http.Request, conversations []models.Conversation) {
	if len(conversations) == 0 {
		return
	}

	index := make(map[string]int, len(conversations))
	ids := make([]string, 0, len(conversations))
	for i, conv := range conversations {
		index[conv.ID] = i
		ids = append(ids, conv.ID)
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT
			mb.conversation_id, mb.user_id, mb.role, mb.joined_at, mb.last_read_at,
			u.id, u.username, u.display_name, u.avatar_url, u.public_key, u.bio, u.last_seen_at, u.created_at
		FROM members mb
		JOIN users u ON u.id = mb.user_id
		WHERE mb.conversation_id = ANY($1)
		ORDER BY mb.joined_at
	`, ids)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var member models.Member
		var user models.User
		if err := rows.Scan(
			&member.ConversationID, &member.UserID, &member.Role, &member.JoinedAt, &member.LastReadAt,
			&user.ID, &user.Username, &user.DisplayName, &user.AvatarURL, &user.PublicKey, &user.Bio, &user.LastSeenAt, &user.CreatedAt,
		); err != nil {
			continue
		}

		member.User = &user
		if i, ok := index[member.ConversationID]; ok {
			conversations[i].Members = append(conversations[i].Members, member)
		}
	}

	for i := range conversations {
		conversations[i].MemberCount = len(conversations[i].Members)
	}
}

func (h *ConversationHandler) decorateDirectConversations(conversations []models.Conversation, currentUserID string) {
	for i := range conversations {
		conv := &conversations[i]
		if conv.Type != models.ConversationTypeDirect {
			continue
		}

		for _, member := range conv.Members {
			if member.UserID == currentUserID || member.User == nil {
				continue
			}
			if strings.TrimSpace(conv.Name) == "" {
				conv.Name = member.User.DisplayName
			}
			if conv.AvatarURL == "" {
				conv.AvatarURL = member.User.AvatarURL
			}
			break
		}
	}
}

func (h *ConversationHandler) isConversationMember(r *http.Request, convID, userID string) bool {
	var count int
	if err := h.pool.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&count); err != nil {
		return false
	}
	return count > 0
}

func (h *ConversationHandler) canManageMembers(r *http.Request, convID, userID string) bool {
	var role string
	if err := h.pool.QueryRow(r.Context(), `
		SELECT role FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&role); err != nil {
		return false
	}
	return role == "owner" || role == "admin"
}
