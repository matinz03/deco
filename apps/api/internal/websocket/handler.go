package websocket

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	appmiddleware "github.com/matinz03/deco/internal/middleware"
	"github.com/matinz03/deco/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

const (
	writeWait      = 10 * time.Second
	pongWait       = 60 * time.Second
	pingPeriod     = (pongWait * 9) / 10
	maxMessageSize = 8 * 1024 // 8 KB
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Allow all origins; the auth middleware already validates the JWT
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Handler returns an http.HandlerFunc that upgrades the connection to WebSocket,
// authenticates via JWT (query param ?token=...), and registers the client in the Hub.
func Handler(hub *Hub, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Auth: accept JWT as query param (browsers can't set headers on WebSocket)
		userID := appmiddleware.GetUserID(r)
		if userID == "" {
			// Fallback: validate token query param
			tokenStr := r.URL.Query().Get("token")
			if tokenStr == "" {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
			var err error
			userID, err = appmiddleware.ValidateToken(tokenStr, cfg.JWTSecret)
			if err != nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			logger.Warn("websocket upgrade failed", zap.Error(err))
			return
		}

		client := &Client{
			UserID: userID,
			Send:   make(chan []byte, 256),
			hub:    hub,
		}

		hub.register <- client

		// Update last_seen_at on connect
		pool.Exec(r.Context(), `UPDATE users SET last_seen_at = NOW() WHERE id = $1`, userID)

		go client.writePump(conn, logger)
		go client.readPump(conn, hub, pool, logger)
	}
}

// readPump pumps messages from the WebSocket connection to the hub.
// Handles incoming client events (typing, read receipts).
func (c *Client) readPump(conn *websocket.Conn, hub *Hub, pool *pgxpool.Pool, logger *zap.Logger) {
	defer func() {
		hub.unregister <- c
		conn.Close()
	}()

	conn.SetReadLimit(maxMessageSize)
	conn.SetReadDeadline(time.Now().Add(pongWait))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, msg, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				logger.Debug("websocket read error", zap.String("user", c.UserID), zap.Error(err))
			}
			break
		}

		var event Event
		if err := json.Unmarshal(msg, &event); err != nil {
			continue
		}

		// Handle client-to-server events
		switch event.Type {
		case EventTyping:
			// Broadcast typing indicator to conversation members
			// Payload: { "conversation_id": "..." }
			var p struct {
				ConversationID string `json:"conversation_id"`
			}
			if json.Unmarshal(event.Payload, &p) == nil && p.ConversationID != "" {
				outEvent := Event{
					Type:    EventTyping,
					Payload: mustMarshalPayload(map[string]string{
						"user_id":         c.UserID,
						"conversation_id": p.ConversationID,
					}),
				}
				rows, err := pool.Query(context.Background(), `SELECT user_id FROM members WHERE conversation_id = $1`, p.ConversationID)
				if err == nil {
					for rows.Next() {
						var userID string
						if rows.Scan(&userID) == nil && userID != c.UserID {
							hub.SendToUser(userID, outEvent) //nolint:errcheck
						}
					}
					rows.Close()
				}
			}

		case EventRead:
			// Payload: { "conversation_id": "..." }
			// Handled via REST (PATCH /messages/read) but we also accept WS for speed
		}
	}
}

// writePump pumps messages from the hub to the WebSocket connection.
func (c *Client) writePump(conn *websocket.Conn, logger *zap.Logger) {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.Send:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				// Hub closed the channel
				conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			w, err := conn.NextWriter(websocket.TextMessage)
			if err != nil {
				return
			}
			w.Write(message)

			// Drain any queued messages in the same write frame
			n := len(c.Send)
			for i := 0; i < n; i++ {
				w.Write([]byte{'\n'})
				w.Write(<-c.Send)
			}

			if err := w.Close(); err != nil {
				return
			}

		case <-ticker.C:
			conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func mustMarshalPayload(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}
