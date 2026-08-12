package storage

import (
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestMediaTicketBindsPathAndExpires(t *testing.T) {
	now := time.Date(2026, time.August, 10, 0, 0, 0, 0, time.UTC)
	ticket, err := SignMediaTicket(http.MethodGet, "messages/images/a.png", "test-secret", now)
	if err != nil {
		t.Fatalf("SignMediaTicket() error = %v", err)
	}
	if !ValidateMediaTicket(http.MethodGet, "messages/images/a.png", ticket, "test-secret", now.Add(time.Minute)) {
		t.Fatal("expected ticket to validate for its original path")
	}
	if ValidateMediaTicket(http.MethodGet, "messages/images/other.png", ticket, "test-secret", now.Add(time.Minute)) {
		t.Fatal("ticket must not authorize a different object")
	}
	if ValidateMediaTicket(http.MethodGet, "messages/images/a.png", ticket, "other-secret", now.Add(time.Minute)) {
		t.Fatal("ticket must not validate with a different signing secret")
	}
	if ValidateMediaTicket(http.MethodGet, "messages/images/a.png", ticket, "test-secret", now.Add(mediaTicketLifetime+time.Second)) {
		t.Fatal("expired ticket validated")
	}
	if ValidateMediaTicket(http.MethodHead, "messages/images/a.png", ticket, "test-secret", now.Add(time.Minute)) {
		t.Fatal("GET ticket unexpectedly authorized a HEAD request")
	}
}

func TestPrivateMediaPath(t *testing.T) {
	path, ok := PrivateMediaPath("/api/v1/media/messages/images/a.png", "/api/v1/media", "https://api.example.test")
	if !ok || path != "messages/images/a.png" {
		t.Fatalf("PrivateMediaPath() = %q, %v", path, ok)
	}
	if _, ok := PrivateMediaPath("/api/v1/media/avatars/a.png", "/api/v1/media", "https://api.example.test"); ok {
		t.Fatal("avatar unexpectedly treated as a private attachment")
	}
	if _, ok := PrivateMediaPath("/api/v1/media/messages/images/../../avatars/a.png", "/api/v1/media", "https://api.example.test"); ok {
		t.Fatal("traversal path unexpectedly accepted")
	}
	if _, ok := PrivateMediaPath("https://attacker.example/messages/images/a.png", "/api/v1/media", "https://api.example.test"); ok {
		t.Fatal("absolute attacker URL unexpectedly accepted")
	}
	if _, ok := PrivateMediaPath("//attacker.example/messages/images/a.png", "/api/v1/media", "https://api.example.test"); ok {
		t.Fatal("protocol-relative attacker URL unexpectedly accepted")
	}
	path, ok = PrivateMediaPath("https://api.example.test/api/v1/media/messages/images/a.png", "/api/v1/media", "https://api.example.test")
	if !ok || path != "messages/images/a.png" {
		t.Fatalf("same-origin absolute PrivateMediaPath() = %q, %v", path, ok)
	}
}

func TestTicketedMediaURLDoesNotContainSessionToken(t *testing.T) {
	url, ok := TicketedMediaURL("/api/v1/media/messages/files/a.pdf", "/api/v1/media", "https://api.example.test", "session-secret", time.Now())
	if !ok || !strings.Contains(url, "?ticket=") || strings.Contains(url, "session-secret") {
		t.Fatalf("TicketedMediaURL() = %q, %v", url, ok)
	}
}
