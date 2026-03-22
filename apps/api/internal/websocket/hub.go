package websocket

import (
	"context"
	"encoding/json"
	"sync"

	"github.com/redis/go-redis/v9"
	"go.uber.org/zap"
)

// EventType represents the type of a WebSocket event
type EventType string

const (
	EventMessage         EventType = "message.new"
	EventMessageEdited   EventType = "message.edited"
	EventMessageDeleted  EventType = "message.deleted"
	EventMessageReaction EventType = "message.reaction"
	EventTyping          EventType = "typing"
	EventPresence        EventType = "presence"
	EventRead            EventType = "message.read"
)

// Event is the envelope for all WebSocket messages
type Event struct {
	Type    EventType       `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

// Client represents a connected WebSocket client
type Client struct {
	UserID         string
	ConversationID string
	Send           chan []byte
	hub            *Hub
}

// Hub manages all active WebSocket connections
type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*Client]struct{} // userID → set of clients
	rdb     *redis.Client
	logger  *zap.Logger

	register   chan *Client
	unregister chan *Client
	broadcast  chan broadcastMsg
	done       chan struct{}
}

type broadcastMsg struct {
	UserID  string `json:"user_id"`
	Payload []byte `json:"payload"`
}

func NewHub(rdb *redis.Client, logger *zap.Logger) *Hub {
	return &Hub{
		clients:    make(map[string]map[*Client]struct{}),
		rdb:        rdb,
		logger:     logger,
		register:   make(chan *Client, 256),
		unregister: make(chan *Client, 256),
		broadcast:  make(chan broadcastMsg, 1024),
		done:       make(chan struct{}),
	}
}

func (h *Hub) Run() {
	// Subscribe to Redis pub/sub for cross-instance messaging
	pubsub := h.rdb.Subscribe(context.Background(), "deco:events")
	defer pubsub.Close()

	go func() {
		for msg := range pubsub.Channel() {
			var bm broadcastMsg
			if err := json.Unmarshal([]byte(msg.Payload), &bm); err == nil {
				h.broadcast <- bm
			}
		}
	}()

	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if h.clients[client.UserID] == nil {
				h.clients[client.UserID] = make(map[*Client]struct{})
			}
			h.clients[client.UserID][client] = struct{}{}
			onlineUserIDs := h.onlineUserIDsLocked()
			h.mu.Unlock()
			h.setPresence(client.UserID, true)
			h.sendPresenceSnapshot(client, onlineUserIDs)
			h.broadcastPresence(client.UserID, "online")

		case client := <-h.unregister:
			h.mu.Lock()
			shouldBroadcastOffline := false
			if clients, ok := h.clients[client.UserID]; ok {
				delete(clients, client)
				if len(clients) == 0 {
					delete(h.clients, client.UserID)
					h.setPresence(client.UserID, false)
					shouldBroadcastOffline = true
				}
			}
			h.mu.Unlock()
			close(client.Send)
			if shouldBroadcastOffline {
				h.broadcastPresence(client.UserID, "offline")
			}

		case msg := <-h.broadcast:
			h.mu.RLock()
			clients := h.clients[msg.UserID]
			h.mu.RUnlock()
			for client := range clients {
				select {
				case client.Send <- msg.Payload:
				default:
					// Client send buffer full — drop and disconnect
					h.unregister <- client
				}
			}

		case <-h.done:
			return
		}
	}
}

// Send delivers an event to a specific user across all their connections
func (h *Hub) SendToUser(userID string, event Event) error {
	payload, err := json.Marshal(event)
	if err != nil {
		return err
	}

	bm := broadcastMsg{UserID: userID, Payload: payload}
	bmBytes, err := json.Marshal(bm)
	if err != nil {
		return err
	}

	// Publish to Redis so all API instances can deliver it
	return h.rdb.Publish(context.Background(), "deco:events", bmBytes).Err()
}

func (h *Hub) setPresence(userID string, online bool) {
	ctx := context.Background()
	key := "presence:" + userID
	if online {
		h.rdb.Set(ctx, key, "online", 0)
	} else {
		h.rdb.Del(ctx, key)
	}
}

func (h *Hub) Shutdown() {
	close(h.done)
}

func (h *Hub) onlineUserIDsLocked() []string {
	ids := make([]string, 0, len(h.clients))
	for userID, clients := range h.clients {
		if len(clients) > 0 {
			ids = append(ids, userID)
		}
	}
	return ids
}

func (h *Hub) sendPresenceSnapshot(client *Client, onlineUserIDs []string) {
	for _, userID := range onlineUserIDs {
		payload, err := json.Marshal(Event{
			Type: EventPresence,
			Payload: mustMarshalPresence(map[string]string{
				"user_id": userID,
				"status":  "online",
			}),
		})
		if err != nil {
			continue
		}

		select {
		case client.Send <- payload:
		default:
		}
	}
}

func (h *Hub) broadcastPresence(userID, status string) {
	h.mu.RLock()
	recipients := make([]string, 0, len(h.clients))
	for recipientID := range h.clients {
		recipients = append(recipients, recipientID)
	}
	h.mu.RUnlock()

	event := Event{
		Type: EventPresence,
		Payload: mustMarshalPresence(map[string]string{
			"user_id": userID,
			"status":  status,
		}),
	}

	for _, recipientID := range recipients {
		h.SendToUser(recipientID, event) //nolint:errcheck
	}
}

func mustMarshalPresence(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
