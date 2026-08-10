package storage

import (
	"strings"
	"testing"
	"time"
)

func TestMediaTicketBindsPathAndExpires(t *testing.T) {
	now := time.Date(2026, time.August, 10, 0, 0, 0, 0, time.UTC)
	ticket, err := SignMediaTicket("messages/images/a.png", "test-secret", now)
	if err != nil {
		t.Fatalf("SignMediaTicket() error = %v", err)
	}
	if !ValidateMediaTicket("messages/images/a.png", ticket, "test-secret", now.Add(time.Minute)) {
		t.Fatal("expected ticket to validate for its original path")
	}
	if ValidateMediaTicket("messages/images/other.png", ticket, "test-secret", now.Add(time.Minute)) {
		t.Fatal("ticket must not authorize a different object")
	}
	if ValidateMediaTicket("messages/images/a.png", ticket, "other-secret", now.Add(time.Minute)) {
		t.Fatal("ticket must not validate with a different signing secret")
	}
	if ValidateMediaTicket("messages/images/a.png", ticket, "test-secret", now.Add(mediaTicketLifetime+time.Second)) {
		t.Fatal("expired ticket validated")
	}
}

func TestPrivateMediaPath(t *testing.T) {
	path, ok := PrivateMediaPath("https://api.example.test/api/v1/media/messages/images/a.png", "/api/v1/media")
	if !ok || path != "messages/images/a.png" {
		t.Fatalf("PrivateMediaPath() = %q, %v", path, ok)
	}
	if _, ok := PrivateMediaPath("/api/v1/media/avatars/a.png", "/api/v1/media"); ok {
		t.Fatal("avatar unexpectedly treated as a private attachment")
	}
	if _, ok := PrivateMediaPath("/api/v1/media/messages/images/../../avatars/a.png", "/api/v1/media"); ok {
		t.Fatal("traversal path unexpectedly accepted")
	}
}

func TestTicketedMediaURLDoesNotContainSessionToken(t *testing.T) {
	url, ok := TicketedMediaURL("/api/v1/media/messages/files/a.pdf", "/api/v1/media", "session-secret", time.Now())
	if !ok || !strings.Contains(url, "?ticket=") || strings.Contains(url, "session-secret") {
		t.Fatalf("TicketedMediaURL() = %q, %v", url, ok)
	}
}
