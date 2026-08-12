package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/models"
	"go.uber.org/zap"
)

const (
	leadershipObjectionCooldown = 30 * 24 * time.Hour
	leadershipElectionWindow    = 24 * time.Hour
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

	if _, err := h.ensureSavedConversation(r.Context(), userID); err != nil {
		h.logger.Error("failed to ensure saved conversation", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to fetch conversations")
		return
	}

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
	h.decorateConversations(conversations, userID)

	respondJSON(w, http.StatusOK, conversations)
}

// Create starts a new conversation (direct or group).
func (h *ConversationHandler) Create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	if err := requireAllowedAction(r.Context(), h.pool, userID, "create_conversations"); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respondError(w, http.StatusForbidden, "your account cannot create conversations")
			return
		}
		respondError(w, http.StatusInternalServerError, "failed to verify account permissions")
		return
	}

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
	if req.Type == string(models.ConversationTypeSaved) {
		respondError(w, http.StatusBadRequest, "saved conversations are created automatically")
		return
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
			h.decorateConversations(convSlice, userID)
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
	h.decorateConversations(convSlice, userID)
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
	h.decorateConversations(convSlice, userID)
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

func (h *ConversationHandler) Delete(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	var conversationType string
	var role string
	err := h.pool.QueryRow(r.Context(), `
		SELECT c.type, mb.role
		FROM conversations c
		JOIN members mb ON mb.conversation_id = c.id
		WHERE c.id = $1 AND mb.user_id = $2
	`, convID, userID).Scan(&conversationType, &role)
	if err != nil {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	if conversationType != string(models.ConversationTypeGroup) {
		respondError(w, http.StatusBadRequest, "only groups can be deleted")
		return
	}

	if role != "owner" {
		respondError(w, http.StatusForbidden, "only the group owner can delete this group")
		return
	}

	if _, err := h.pool.Exec(r.Context(), `
		DELETE FROM conversations WHERE id = $1
	`, convID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to delete group")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "group deleted"})
}

func (h *ConversationHandler) ListMembers(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}

	rows, err := h.pool.Query(r.Context(), `
		SELECT
			mb.conversation_id, mb.user_id, mb.role, mb.joined_at, mb.last_read_at,
			u.id, u.username, u.display_name, u.avatar_url, u.public_key, u.bio, u.last_seen_at, u.created_at
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

	members := []models.Member{}
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
		members = append(members, member)
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

func (h *ConversationHandler) UpdateMemberRole(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	targetUserID := chi.URLParam(r, "userID")
	userID := middleware.GetUserID(r)

	if !h.canManageRoles(r, convID, userID) {
		respondError(w, http.StatusForbidden, "only the group owner can manage admin roles")
		return
	}

	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.Role = strings.TrimSpace(req.Role)
	if req.Role != "admin" && req.Role != "member" {
		respondError(w, http.StatusBadRequest, "role must be admin or member")
		return
	}

	if targetUserID == userID {
		respondError(w, http.StatusBadRequest, "owner role cannot be changed")
		return
	}

	commandTag, err := h.pool.Exec(r.Context(), `
		UPDATE members
		SET role = $1
		WHERE conversation_id = $2 AND user_id = $3 AND role <> 'owner'
	`, req.Role, convID, targetUserID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to update member role")
		return
	}
	if commandTag.RowsAffected() == 0 {
		respondError(w, http.StatusNotFound, "member not found")
		return
	}

	respondJSON(w, http.StatusOK, map[string]string{"message": "member role updated"})
}

func (h *ConversationHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	targetUserID := chi.URLParam(r, "userID")
	userID := middleware.GetUserID(r)

	if !h.canManageMembers(r, convID, userID) {
		respondError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	var actorRole string
	if err := h.pool.QueryRow(r.Context(), `
		SELECT role FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&actorRole); err != nil {
		respondError(w, http.StatusForbidden, "insufficient permissions")
		return
	}

	var targetRole string
	err := h.pool.QueryRow(r.Context(), `
		SELECT role FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, targetUserID).Scan(&targetRole)
	if err != nil {
		respondError(w, http.StatusNotFound, "member not found")
		return
	}

	if targetRole == "owner" {
		respondError(w, http.StatusBadRequest, "owner cannot be removed")
		return
	}

	if actorRole != "owner" && targetRole != "member" {
		respondError(w, http.StatusForbidden, "admins can only remove regular members")
		return
	}

	if _, err := h.pool.Exec(r.Context(), `
		DELETE FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, targetUserID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to remove member")
		return
	}

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

func (h *ConversationHandler) decorateConversations(conversations []models.Conversation, currentUserID string) {
	for i := range conversations {
		conv := &conversations[i]
		switch conv.Type {
		case models.ConversationTypeDirect:
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
		case models.ConversationTypeSaved:
			conv.Name = "Saved Messages"
			if strings.TrimSpace(conv.Description) == "" {
				conv.Description = "Private notes to yourself"
			}
			for _, member := range conv.Members {
				if member.UserID != currentUserID || member.User == nil {
					continue
				}
				if conv.AvatarURL == "" {
					conv.AvatarURL = member.User.AvatarURL
				}
				break
			}
		}
	}
}

func (h *ConversationHandler) ensureSavedConversation(ctx context.Context, userID string) (string, error) {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	var conversationID string
	err = tx.QueryRow(ctx, `
		INSERT INTO conversations (type, name, description, created_by_id, saved_for_user_id)
		VALUES ('saved', 'Saved Messages', 'Private notes to yourself', $1, $1)
		ON CONFLICT (saved_for_user_id) DO NOTHING
		RETURNING id
	`, userID).Scan(&conversationID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}

	if errors.Is(err, pgx.ErrNoRows) {
		if err := tx.QueryRow(ctx, `
			SELECT id
			FROM conversations
			WHERE saved_for_user_id = $1
		`, userID).Scan(&conversationID); err != nil {
			return "", err
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO members (conversation_id, user_id, role)
		VALUES ($1, $2, 'owner')
		ON CONFLICT DO NOTHING
	`, conversationID, userID); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", err
	}

	return conversationID, nil
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

func (h *ConversationHandler) canManageRoles(r *http.Request, convID, userID string) bool {
	var role string
	if err := h.pool.QueryRow(r.Context(), `
		SELECT role FROM members WHERE conversation_id = $1 AND user_id = $2
	`, convID, userID).Scan(&role); err != nil {
		return false
	}
	return role == "owner"
}

// PutGroupKeys stores encrypted group key copies for one or more members.
// Each entry contains the group key encrypted for a specific member.
// Body: [{ "user_id": "...", "encrypted_key": "...", "encrypted_by": "..." }]
func (h *ConversationHandler) PutGroupKeys(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	callerID := r.Context().Value(middleware.UserIDKey).(string)

	if !h.isConversationMember(r, convID, callerID) {
		respondError(w, http.StatusForbidden, "not a member")
		return
	}
	// A group key is the authority for all future group ciphertext.  Only the
	// current group administrators may establish the first copy or rotate an
	// existing copy; tying an update to the previous encrypted_by value lets a
	// former regular member retain authority indefinitely.
	if !h.canManageMembers(r, convID, callerID) {
		respondError(w, http.StatusForbidden, "only group administrators can distribute keys")
		return
	}

	var entries []struct {
		UserID       string `json:"user_id"`
		EncryptedKey string `json:"encrypted_key"`
		EncryptedBy  string `json:"encrypted_by"`
	}
	if err := json.NewDecoder(r.Body).Decode(&entries); err != nil || len(entries) == 0 {
		respondError(w, http.StatusBadRequest, "invalid body")
		return
	}

	for _, entry := range entries {
		if entry.UserID == "" || entry.EncryptedKey == "" || entry.EncryptedBy == "" {
			respondError(w, http.StatusBadRequest, "missing fields")
			return
		}
		if entry.EncryptedBy != callerID {
			respondError(w, http.StatusForbidden, "cannot forge key author")
			return
		}
		if !h.isConversationMember(r, convID, entry.UserID) {
			respondError(w, http.StatusForbidden, "recipient is not a member of conversation")
			return
		}
		res, err := h.pool.Exec(r.Context(), `
			INSERT INTO group_keys (conversation_id, user_id, encrypted_by, encrypted_key)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (conversation_id, user_id) DO UPDATE
			  SET encrypted_key = EXCLUDED.encrypted_key,
			      encrypted_by  = EXCLUDED.encrypted_by,
			      created_at    = NOW()
		`, convID, entry.UserID, entry.EncryptedBy, entry.EncryptedKey)
		if err != nil {
			respondError(w, http.StatusInternalServerError, "failed to store key")
			return
		}
		if res.RowsAffected() != 1 {
			respondError(w, http.StatusInternalServerError, "failed to store key")
			return
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

// GetGroupKey returns the caller's encrypted copy of the group key.
func (h *ConversationHandler) GetGroupKey(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	callerID := r.Context().Value(middleware.UserIDKey).(string)

	if !h.isConversationMember(r, convID, callerID) {
		respondError(w, http.StatusForbidden, "not a member")
		return
	}

	var gk models.GroupKey
	err := h.pool.QueryRow(r.Context(), `
		SELECT conversation_id, user_id, encrypted_by, encrypted_key, created_at
		FROM group_keys
		WHERE conversation_id = $1 AND user_id = $2
	`, convID, callerID).Scan(&gk.ConversationID, &gk.UserID, &gk.EncryptedBy, &gk.EncryptedKey, &gk.CreatedAt)
	if err != nil {
		respondError(w, http.StatusNotFound, "group key not found")
		return
	}

	respondJSON(w, http.StatusOK, gk)
}

func (h *ConversationHandler) GetLeadershipStatus(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}
	if ok, err := h.ensureGroupConversation(r.Context(), convID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to load leadership status")
		return
	} else if !ok {
		respondError(w, http.StatusBadRequest, "leadership elections are only available in groups")
		return
	}

	if err := h.finalizeLeadershipElection(r.Context(), convID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to finalize leadership election")
		return
	}

	status, err := h.buildLeadershipStatus(r.Context(), convID, userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to build leadership status")
		return
	}

	respondJSON(w, http.StatusOK, status)
}

func (h *ConversationHandler) ObjectToLeadership(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}
	if ok, err := h.ensureGroupConversation(r.Context(), convID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to update objections")
		return
	} else if !ok {
		respondError(w, http.StatusBadRequest, "leadership objections are only available in groups")
		return
	}

	if err := h.finalizeLeadershipElection(r.Context(), convID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to finalize leadership election")
		return
	}

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to start objection transaction")
		return
	}
	defer tx.Rollback(r.Context())

	now := time.Now().UTC()
	var cooldownUntil *time.Time
	var electionEndsAt *time.Time
	if err := tx.QueryRow(r.Context(), `
		SELECT objection_cooldown_until, election_ends_at
		FROM group_leadership_cycles
		WHERE conversation_id = $1
	`, convID).Scan(&cooldownUntil, &electionEndsAt); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		respondError(w, http.StatusInternalServerError, "failed to load objection cycle")
		return
	}

	if electionEndsAt != nil && electionEndsAt.After(now) {
		respondError(w, http.StatusBadRequest, "an owner election is already active")
		return
	}
	if cooldownUntil != nil && cooldownUntil.After(now) {
		respondError(w, http.StatusBadRequest, "leadership objections are on cooldown")
		return
	}

	if _, err := tx.Exec(r.Context(), `
		INSERT INTO group_leadership_objections (conversation_id, user_id)
		VALUES ($1, $2)
		ON CONFLICT DO NOTHING
	`, convID, userID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to record objection")
		return
	}

	memberCount, err := h.groupMemberCountTx(r.Context(), tx, convID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to count members")
		return
	}

	var objectionCount int
	if err := tx.QueryRow(r.Context(), `
		SELECT COUNT(*) FROM group_leadership_objections WHERE conversation_id = $1
	`, convID).Scan(&objectionCount); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to count objections")
		return
	}

	threshold := leadershipThreshold(memberCount)
	if objectionCount >= threshold {
		cooldown := now.Add(leadershipObjectionCooldown)
		electionEnds := now.Add(leadershipElectionWindow)
		if _, err := tx.Exec(r.Context(), `
			INSERT INTO group_leadership_cycles (conversation_id, objection_cooldown_until, election_started_at, election_ends_at)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT (conversation_id) DO UPDATE
			SET objection_cooldown_until = EXCLUDED.objection_cooldown_until,
			    election_started_at = EXCLUDED.election_started_at,
			    election_ends_at = EXCLUDED.election_ends_at,
			    updated_at = NOW()
		`, convID, cooldown, now, electionEnds); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to start leadership election")
			return
		}
		if _, err := tx.Exec(r.Context(), `DELETE FROM group_leadership_objections WHERE conversation_id = $1`, convID); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to reset objections")
			return
		}
		if _, err := tx.Exec(r.Context(), `DELETE FROM group_leadership_votes WHERE conversation_id = $1`, convID); err != nil {
			respondError(w, http.StatusInternalServerError, "failed to reset leadership votes")
			return
		}
	}

	if err := tx.Commit(r.Context()); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to finalize objection")
		return
	}

	status, err := h.buildLeadershipStatus(r.Context(), convID, userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to build leadership status")
		return
	}

	respondJSON(w, http.StatusOK, status)
}

func (h *ConversationHandler) VoteLeadership(w http.ResponseWriter, r *http.Request) {
	convID := chi.URLParam(r, "conversationID")
	userID := middleware.GetUserID(r)

	if !h.isConversationMember(r, convID, userID) {
		respondError(w, http.StatusForbidden, "not a member of this conversation")
		return
	}
	if ok, err := h.ensureGroupConversation(r.Context(), convID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to save vote")
		return
	} else if !ok {
		respondError(w, http.StatusBadRequest, "leadership voting is only available in groups")
		return
	}

	if err := h.finalizeLeadershipElection(r.Context(), convID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to finalize leadership election")
		return
	}

	var req struct {
		CandidateUserID string `json:"candidate_user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.CandidateUserID) == "" {
		respondError(w, http.StatusBadRequest, "candidate_user_id is required")
		return
	}
	req.CandidateUserID = strings.TrimSpace(req.CandidateUserID)

	tx, err := h.pool.Begin(r.Context())
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to start election vote transaction")
		return
	}
	defer tx.Rollback(r.Context())

	var electionEndsAt *time.Time
	if err := tx.QueryRow(r.Context(), `
		SELECT election_ends_at
		FROM group_leadership_cycles
		WHERE conversation_id = $1
	`, convID).Scan(&electionEndsAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			respondError(w, http.StatusBadRequest, "there is no active leadership election")
			return
		}
		respondError(w, http.StatusInternalServerError, "failed to load election state")
		return
	}
	if electionEndsAt == nil || !electionEndsAt.After(time.Now().UTC()) {
		respondError(w, http.StatusBadRequest, "there is no active leadership election")
		return
	}

	var candidateExists bool
	if err := tx.QueryRow(r.Context(), `
		SELECT EXISTS(
			SELECT 1 FROM members
			WHERE conversation_id = $1 AND user_id = $2
		)
	`, convID, req.CandidateUserID).Scan(&candidateExists); err != nil || !candidateExists {
		respondError(w, http.StatusBadRequest, "candidate must be a group member")
		return
	}

	if _, err := tx.Exec(r.Context(), `
		INSERT INTO group_leadership_votes (conversation_id, voter_user_id, candidate_user_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (conversation_id, voter_user_id) DO UPDATE
		SET candidate_user_id = EXCLUDED.candidate_user_id,
		    created_at = NOW()
	`, convID, userID, req.CandidateUserID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to save leadership vote")
		return
	}

	if err := tx.Commit(r.Context()); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to finalize leadership vote")
		return
	}

	if err := h.finalizeLeadershipElection(r.Context(), convID); err != nil {
		respondError(w, http.StatusInternalServerError, "failed to finalize leadership election")
		return
	}

	status, err := h.buildLeadershipStatus(r.Context(), convID, userID)
	if err != nil {
		respondError(w, http.StatusInternalServerError, "failed to build leadership status")
		return
	}

	respondJSON(w, http.StatusOK, status)
}

func (h *ConversationHandler) ensureGroupConversation(ctx context.Context, convID string) (bool, error) {
	var conversationType string
	if err := h.pool.QueryRow(ctx, `
		SELECT type FROM conversations WHERE id = $1
	`, convID).Scan(&conversationType); err != nil {
		return false, err
	}
	return conversationType == string(models.ConversationTypeGroup), nil
}

func (h *ConversationHandler) groupMemberCountTx(ctx context.Context, tx pgx.Tx, convID string) (int, error) {
	var count int
	err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM members WHERE conversation_id = $1
	`, convID).Scan(&count)
	return count, err
}

func (h *ConversationHandler) currentOwnerIDTx(ctx context.Context, tx pgx.Tx, convID string) (string, error) {
	var ownerID string
	err := tx.QueryRow(ctx, `
		SELECT user_id FROM members
		WHERE conversation_id = $1 AND role = 'owner'
		LIMIT 1
	`, convID).Scan(&ownerID)
	return ownerID, err
}

func (h *ConversationHandler) finalizeLeadershipElection(ctx context.Context, convID string) error {
	tx, err := h.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var electionEndsAt *time.Time
	if err := tx.QueryRow(ctx, `
		SELECT election_ends_at
		FROM group_leadership_cycles
		WHERE conversation_id = $1
	`, convID).Scan(&electionEndsAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return err
	}

	now := time.Now().UTC()
	if electionEndsAt == nil || electionEndsAt.After(now) {
		return nil
	}

	memberCount, err := h.groupMemberCountTx(ctx, tx, convID)
	if err != nil {
		return err
	}
	turnoutThreshold := leadershipThreshold(memberCount)
	currentOwnerID, err := h.currentOwnerIDTx(ctx, tx, convID)
	if err != nil {
		return err
	}

	var turnoutCount int
	if err := tx.QueryRow(ctx, `
		SELECT COUNT(*) FROM group_leadership_votes WHERE conversation_id = $1
	`, convID).Scan(&turnoutCount); err != nil {
		return err
	}

	nextOwnerID := currentOwnerID
	if turnoutCount >= turnoutThreshold {
		var candidateID string
		err := tx.QueryRow(ctx, `
			SELECT
				v.candidate_user_id
			FROM group_leadership_votes v
			JOIN users u ON u.id = v.voter_user_id
			WHERE v.conversation_id = $1
			GROUP BY v.candidate_user_id
			ORDER BY COUNT(*) DESC, MIN(u.created_at) ASC, v.candidate_user_id ASC
			LIMIT 1
		`, convID).Scan(&candidateID)
		if err == nil && candidateID != "" {
			nextOwnerID = candidateID
		}
	}

	if nextOwnerID != currentOwnerID {
		if _, err := tx.Exec(ctx, `
			UPDATE members
			SET role = CASE WHEN role = 'owner' THEN 'admin' ELSE role END
			WHERE conversation_id = $1
		`, convID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			UPDATE members SET role = 'owner'
			WHERE conversation_id = $1 AND user_id = $2
		`, convID, nextOwnerID); err != nil {
			return err
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM group_leadership_votes WHERE conversation_id = $1`, convID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM group_leadership_objections WHERE conversation_id = $1`, convID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		UPDATE group_leadership_cycles
		SET election_started_at = NULL,
		    election_ends_at = NULL,
		    updated_at = NOW()
		WHERE conversation_id = $1
	`, convID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (h *ConversationHandler) buildLeadershipStatus(ctx context.Context, convID, userID string) (*models.LeadershipStatus, error) {
	status := &models.LeadershipStatus{
		ConversationID: convID,
	}

	var memberCount int
	if err := h.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM members WHERE conversation_id = $1
	`, convID).Scan(&memberCount); err != nil {
		return nil, err
	}
	status.ObjectionThreshold = leadershipThreshold(memberCount)
	status.TurnoutThreshold = leadershipThreshold(memberCount)

	if err := h.pool.QueryRow(ctx, `
		SELECT user_id FROM members
		WHERE conversation_id = $1 AND role = 'owner'
		LIMIT 1
	`, convID).Scan(&status.CurrentOwnerID); err != nil {
		return nil, err
	}

	var cooldownUntil *time.Time
	var electionEndsAt *time.Time
	var electionStartedAt *time.Time
	if err := h.pool.QueryRow(ctx, `
		SELECT objection_cooldown_until, election_started_at, election_ends_at
		FROM group_leadership_cycles
		WHERE conversation_id = $1
	`, convID).Scan(&cooldownUntil, &electionStartedAt, &electionEndsAt); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	now := time.Now().UTC()
	status.ObjectionCooldownEndsAt = cooldownUntil
	status.ElectionEndsAt = electionEndsAt
	status.ElectionActive = electionEndsAt != nil && electionEndsAt.After(now) && electionStartedAt != nil
	status.CanObject = !status.ElectionActive && (cooldownUntil == nil || !cooldownUntil.After(now))

	if err := h.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM group_leadership_objections WHERE conversation_id = $1
	`, convID).Scan(&status.ObjectionCount); err != nil {
		return nil, err
	}
	if err := h.pool.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM group_leadership_objections WHERE conversation_id = $1 AND user_id = $2
		)
	`, convID, userID).Scan(&status.HasObjected); err != nil {
		return nil, err
	}

	var votedForUserID *string
	if err := h.pool.QueryRow(ctx, `
		SELECT candidate_user_id
		FROM group_leadership_votes
		WHERE conversation_id = $1 AND voter_user_id = $2
	`, convID, userID).Scan(&votedForUserID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	status.VotedForUserID = votedForUserID
	status.HasVoted = votedForUserID != nil

	if err := h.pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM group_leadership_votes WHERE conversation_id = $1
	`, convID).Scan(&status.TurnoutCount); err != nil {
		return nil, err
	}

	if status.ElectionActive {
		rows, err := h.pool.Query(ctx, `
			SELECT
				m.user_id,
				u.display_name,
				u.username,
				u.avatar_url,
				COUNT(v.voter_user_id)::int AS vote_count
			FROM members m
			JOIN users u ON u.id = m.user_id
			LEFT JOIN group_leadership_votes v
			  ON v.conversation_id = m.conversation_id AND v.candidate_user_id = m.user_id
			WHERE m.conversation_id = $1
			GROUP BY m.user_id, u.display_name, u.username, u.avatar_url
			ORDER BY vote_count DESC, u.created_at ASC
		`, convID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()

		for rows.Next() {
			var candidate models.LeadershipCandidate
			if err := rows.Scan(&candidate.UserID, &candidate.DisplayName, &candidate.Username, &candidate.AvatarURL, &candidate.VoteCount); err == nil {
				status.Candidates = append(status.Candidates, candidate)
			}
		}
	}

	return status, nil
}

func leadershipThreshold(memberCount int) int {
	if memberCount <= 0 {
		return 0
	}
	return (2*memberCount + 2) / 3
}
