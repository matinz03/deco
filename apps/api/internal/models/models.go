package models

import "time"

// ─── User ─────────────────────────────────────────────────────────────────────

type User struct {
	ID          string    `json:"id" db:"id"`
	Username    string    `json:"username" db:"username"`
	DisplayName string    `json:"display_name" db:"display_name"`
	Email       string    `json:"email,omitempty" db:"email"`
	PhoneNumber string    `json:"phone_number,omitempty" db:"phone_number"`
	AvatarURL   string    `json:"avatar_url" db:"avatar_url"`
	PublicKey   string    `json:"public_key" db:"public_key"` // E2E: user's public key
	Bio         string    `json:"bio" db:"bio"`
	LastSeenAt  time.Time `json:"last_seen_at" db:"last_seen_at"`
	CreatedAt   time.Time `json:"created_at" db:"created_at"`
}

// ─── Conversation ─────────────────────────────────────────────────────────────

type ConversationType string

const (
	ConversationTypeDirect  ConversationType = "direct"
	ConversationTypeGroup   ConversationType = "group"
	ConversationTypeChannel ConversationType = "channel"
)

type Conversation struct {
	ID           string           `json:"id" db:"id"`
	Type         ConversationType `json:"type" db:"type"`
	Name         string           `json:"name" db:"name"`         // For groups/channels
	AvatarURL    string           `json:"avatar_url" db:"avatar_url"`
	Description  string           `json:"description" db:"description"`
	CreatedByID  string           `json:"created_by_id" db:"created_by_id"`
	LastMessage  *Message         `json:"last_message,omitempty"`
	UnreadCount  int              `json:"unread_count"`
	MemberCount  int              `json:"member_count"`
	Members      []Member         `json:"members,omitempty"`
	CreatedAt    time.Time        `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time        `json:"updated_at" db:"updated_at"`
}

// ─── Message ──────────────────────────────────────────────────────────────────

type MessageType string

const (
	MessageTypeText     MessageType = "text"
	MessageTypeImage    MessageType = "image"
	MessageTypeVideo    MessageType = "video"
	MessageTypeAudio    MessageType = "audio"
	MessageTypeFile     MessageType = "file"
	MessageTypePoll     MessageType = "poll"
	MessageTypeSystem   MessageType = "system"
)

type MessageStatus string

const (
	MessageStatusSent      MessageStatus = "sent"
	MessageStatusDelivered MessageStatus = "delivered"
	MessageStatusRead      MessageStatus = "read"
)

type Message struct {
	ID             string        `json:"id" db:"id"`
	ConversationID string        `json:"conversation_id" db:"conversation_id"`
	SenderID       string        `json:"sender_id" db:"sender_id"`
	Sender         *User         `json:"sender,omitempty"`
	Type           MessageType   `json:"type" db:"type"`
	// Content is the E2E-encrypted ciphertext — server never sees plaintext
	EncryptedContent string      `json:"encrypted_content" db:"encrypted_content"`
	// For media messages: reference to R2 object (nullable)
	MediaURL       *string       `json:"media_url,omitempty" db:"media_url"`
	MediaName      *string       `json:"media_name,omitempty" db:"media_name"`
	MediaMimeType  *string       `json:"media_mime_type,omitempty" db:"media_mime_type"`
	MediaSize      *int64        `json:"media_size,omitempty" db:"media_size"`
	Poll           *Poll         `json:"poll,omitempty"`
	ReplyToID      *string       `json:"reply_to_id,omitempty" db:"reply_to_id"`
	Reactions      []Reaction    `json:"reactions,omitempty"`
	Status         MessageStatus `json:"status" db:"status"`
	IsEdited       bool          `json:"is_edited" db:"is_edited"`
	IsDeleted      bool          `json:"is_deleted" db:"is_deleted"`
	SentAt         time.Time     `json:"sent_at" db:"sent_at"`
	EditedAt       *time.Time    `json:"edited_at,omitempty" db:"edited_at"`
}

// ─── Reaction ─────────────────────────────────────────────────────────────────

type Reaction struct {
	MessageID string    `json:"message_id" db:"message_id"`
	UserID    string    `json:"user_id" db:"user_id"`
	Emoji     string    `json:"emoji" db:"emoji"`
	CreatedAt time.Time `json:"created_at" db:"created_at"`
}

type Poll struct {
	MessageID      string       `json:"message_id" db:"message_id"`
	Question       string       `json:"question" db:"question"`
	AllowsMultiple bool         `json:"allows_multiple" db:"allows_multiple"`
	TotalVotes     int          `json:"total_votes"`
	Options        []PollOption `json:"options,omitempty"`
}

type PollOption struct {
	ID        string `json:"id" db:"id"`
	MessageID string `json:"message_id" db:"message_id"`
	Text      string `json:"text" db:"text"`
	Position  int    `json:"position" db:"position"`
	VoteCount int    `json:"vote_count"`
	VotedByMe bool   `json:"voted_by_me"`
}

// ─── Member ───────────────────────────────────────────────────────────────────

type MemberRole string

const (
	MemberRoleOwner  MemberRole = "owner"
	MemberRoleAdmin  MemberRole = "admin"
	MemberRoleMember MemberRole = "member"
)

type Member struct {
	ConversationID string     `json:"conversation_id" db:"conversation_id"`
	UserID         string     `json:"user_id" db:"user_id"`
	User           *User      `json:"user,omitempty"`
	Role           MemberRole `json:"role" db:"role"`
	JoinedAt       time.Time  `json:"joined_at" db:"joined_at"`
	LastReadAt     time.Time  `json:"last_read_at" db:"last_read_at"`
}

type KeyBackup struct {
	UserID     string    `json:"user_id" db:"user_id"`
	Version    int       `json:"version" db:"version"`
	KDF        string    `json:"kdf" db:"kdf"`
	Iterations int       `json:"iterations" db:"iterations"`
	Salt       string    `json:"salt" db:"salt"`
	Cipher     string    `json:"cipher" db:"cipher"`
	IV         string    `json:"iv" db:"iv"`
	Ciphertext string    `json:"ciphertext" db:"ciphertext"`
	CreatedAt  time.Time `json:"created_at" db:"created_at"`
	UpdatedAt  time.Time `json:"updated_at" db:"updated_at"`
}

type GroupKey struct {
	ConversationID string    `json:"conversation_id" db:"conversation_id"`
	UserID         string    `json:"user_id" db:"user_id"`
	EncryptedBy    string    `json:"encrypted_by" db:"encrypted_by"`
	EncryptedKey   string    `json:"encrypted_key" db:"encrypted_key"`
	CreatedAt      time.Time `json:"created_at" db:"created_at"`
}
