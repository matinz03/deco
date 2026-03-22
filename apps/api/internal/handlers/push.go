package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"

	webpush "github.com/SherClockHolmes/webpush-go"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/matinz03/deco/internal/config"
	"github.com/matinz03/deco/internal/middleware"
	"go.uber.org/zap"
)

type PushHandler struct {
	pool   *pgxpool.Pool
	cfg    *config.Config
	logger *zap.Logger
}

// GetVAPIDPublicKey returns the VAPID public key so the frontend can subscribe.
func (h *PushHandler) GetVAPIDPublicKey(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]string{"publicKey": h.cfg.VAPIDPublicKey})
}

// Subscribe saves a Web Push subscription for the authenticated user.
func (h *PushHandler) Subscribe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var sub struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&sub); err != nil || sub.Endpoint == "" {
		respondError(w, http.StatusBadRequest, "invalid subscription")
		return
	}

	_, err := h.pool.Exec(r.Context(), `
		INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id, endpoint) DO UPDATE SET p256dh = $3, auth = $4
	`, userID, sub.Endpoint, sub.Keys.P256dh, sub.Keys.Auth)
	if err != nil {
		h.logger.Error("failed to save push subscription", zap.Error(err))
		respondError(w, http.StatusInternalServerError, "failed to save subscription")
		return
	}

	respondJSON(w, http.StatusCreated, map[string]string{"message": "subscribed"})
}

// Unsubscribe removes a push subscription by endpoint.
func (h *PushHandler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondError(w, http.StatusBadRequest, "invalid request")
		return
	}

	h.pool.Exec(r.Context(), `
		DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2
	`, userID, body.Endpoint)

	respondJSON(w, http.StatusOK, map[string]string{"message": "unsubscribed"})
}

// SendPushToUser delivers a Web Push notification to all subscriptions of a user.
// title and body must NOT contain plaintext message content (messages are E2E encrypted).
func SendPushToUser(ctx context.Context, pool *pgxpool.Pool, cfg *config.Config, logger *zap.Logger, userID, title, body string) {
	if cfg.VAPIDPublicKey == "" || cfg.VAPIDPrivateKey == "" {
		return
	}

	rows, err := pool.Query(ctx, `
		SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1
	`, userID)
	if err != nil {
		return
	}
	defer rows.Close()

	payload, _ := json.Marshal(map[string]string{"title": title, "body": body})

	for rows.Next() {
		var endpoint, p256dh, auth string
		if err := rows.Scan(&endpoint, &p256dh, &auth); err != nil {
			continue
		}

		sub := &webpush.Subscription{
			Endpoint: endpoint,
			Keys: webpush.Keys{
				P256dh: p256dh,
				Auth:   auth,
			},
		}

		resp, err := webpush.SendNotification(bytes.NewReader(payload), sub, &webpush.Options{
			VAPIDPublicKey:  cfg.VAPIDPublicKey,
			VAPIDPrivateKey: cfg.VAPIDPrivateKey,
			Subscriber:      cfg.VAPIDSubject,
			TTL:             60,
		})
		if err != nil {
			logger.Warn("push send failed", zap.String("userID", userID), zap.Error(err))
			continue
		}
		resp.Body.Close()

		// 410 Gone = subscription is no longer valid, clean it up
		if resp.StatusCode == http.StatusGone {
			pool.Exec(ctx, `DELETE FROM push_subscriptions WHERE endpoint = $1`, endpoint) //nolint:errcheck
		}
	}
}
