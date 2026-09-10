package storage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

const mediaTicketLifetime = 5 * time.Minute

// PrivateMediaPath converts a stored local media URL into the canonical
// relative path used by local storage. Only message attachments are private;
// avatars and sticker assets deliberately have public visibility.
func PrivateMediaPath(value, publicBase, publicOrigin string) (string, bool) {
	value = strings.TrimSpace(value)
	if parsed, err := url.Parse(value); err == nil {
		if parsed.IsAbs() || parsed.Host != "" {
			trustedOrigin, err := url.Parse(publicOrigin)
			if err != nil || !trustedOrigin.IsAbs() || trustedOrigin.Host == "" || parsed.User != nil || parsed.Scheme != trustedOrigin.Scheme || parsed.Host != trustedOrigin.Host {
				return "", false
			}
			// Older clients persisted this same-origin absolute form. Normalize it
			// only after the configured API origin has matched exactly.
			if parsed.Path == "" {
				return "", false
			}
			value = parsed.Path
		} else if parsed.Path != "" {
			value = parsed.Path
		}
	}
	publicBase = strings.TrimRight(strings.TrimSpace(publicBase), "/")
	if publicBase != "" {
		if parsed, err := url.Parse(publicBase); err == nil && parsed.Path != "" {
			publicBase = strings.TrimRight(parsed.Path, "/")
		}
		if strings.HasPrefix(value, publicBase+"/") {
			value = strings.TrimPrefix(value, publicBase+"/")
		}
	}
	value = strings.TrimPrefix(value, "/uploads/")
	value = strings.TrimPrefix(value, "/")
	cleaned := path.Clean(value)
	if cleaned == "." || strings.HasPrefix(cleaned, "../") || !isPrivateMediaPath(cleaned) {
		return "", false
	}
	return cleaned, true
}

func IsPublicMediaPath(value string) bool {
	cleaned := path.Clean(strings.TrimPrefix(value, "/"))
	return strings.HasPrefix(cleaned, "avatars/") || strings.HasPrefix(cleaned, "stickers/")
}

func SignMediaTicket(method, relativePath, jwtSecret string, now time.Time) (string, error) {
	if method != http.MethodGet || !isPrivateMediaPath(relativePath) {
		return "", fmt.Errorf("invalid private media path")
	}
	expiresAt := now.Add(mediaTicketLifetime).Unix()
	payload := method + "\n" + relativePath + "\n" + strconv.FormatInt(expiresAt, 10)
	signature := signMediaPayload(payload, jwtSecret)
	return base64.RawURLEncoding.EncodeToString([]byte(payload)) + "." + base64.RawURLEncoding.EncodeToString(signature), nil
}

func ValidateMediaTicket(method, relativePath, ticket, jwtSecret string, now time.Time) bool {
	if method != http.MethodGet || !isPrivateMediaPath(relativePath) {
		return false
	}
	parts := strings.Split(ticket, ".")
	if len(parts) != 2 {
		return false
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || !hmac.Equal(signature, signMediaPayload(string(payloadBytes), jwtSecret)) {
		return false
	}
	fields := strings.Split(string(payloadBytes), "\n")
	if len(fields) != 3 || fields[0] != method || fields[1] != relativePath {
		return false
	}
	expiresAt, err := strconv.ParseInt(fields[2], 10, 64)
	return err == nil && now.Unix() <= expiresAt
}

func TicketedMediaURL(value, publicBase, publicOrigin, jwtSecret string, now time.Time) (string, bool) {
	relativePath, ok := PrivateMediaPath(value, publicBase, publicOrigin)
	if !ok {
		return value, false
	}
	ticket, err := SignMediaTicket(http.MethodGet, relativePath, jwtSecret, now)
	if err != nil {
		return value, false
	}
	separator := "?"
	if strings.Contains(value, "?") {
		separator = "&"
	}
	return value + separator + "ticket=" + url.QueryEscape(ticket), true
}

func isPrivateMediaPath(value string) bool {
	return strings.HasPrefix(value, "messages/images/") ||
		strings.HasPrefix(value, "messages/videos/") ||
		strings.HasPrefix(value, "messages/audio/") ||
		strings.HasPrefix(value, "messages/files/")
}

func signMediaPayload(payload, jwtSecret string) []byte {
	// Domain separation gives media tickets their own signing key purpose; a
	// media ticket can never be interpreted as a session JWT.
	derivedKey := sha256.Sum256([]byte("deco/media-ticket/v1\x00" + jwtSecret))
	mac := hmac.New(sha256.New, derivedKey[:])
	_, _ = mac.Write([]byte(payload))
	return mac.Sum(nil)
}
