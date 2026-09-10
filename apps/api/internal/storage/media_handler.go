package storage

import (
	"net/http"
	"path"
	"strings"
	"time"
)

// NewMediaHandler serves local media only when the request has the appropriate
// short-lived capability. Avatars and sticker assets intentionally remain
// public; every other path must carry a valid GET ticket.
func NewMediaHandler(uploadRoot, ticketSecret string, now func() time.Time) http.Handler {
	if now == nil {
		now = time.Now
	}

	files := http.FileServer(http.Dir(uploadRoot))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, `{"error":"method not allowed"}`, http.StatusMethodNotAllowed)
			return
		}

		relativePath, ok := canonicalMediaRequestPath(r.URL.Path)
		if !ok {
			http.NotFound(w, r)
			return
		}
		isPublic := IsPublicMediaPath(relativePath)
		if !isPublic && !ValidateMediaTicket(r.Method, relativePath, r.URL.Query().Get("ticket"), ticketSecret, now()) {
			http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
			return
		}

		if !isPublic {
			// A ticket's lifetime must not be extended by a browser or proxy cache.
			w.Header().Set("Cache-Control", "private, no-store")
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'none'")
		if strings.HasPrefix(relativePath, "messages/files/") {
			w.Header().Set("Content-Disposition", "attachment")
		}
		files.ServeHTTP(w, r)
	})
}

func canonicalMediaRequestPath(requestPath string) (string, bool) {
	relativePath := strings.TrimPrefix(requestPath, "/")
	if relativePath == "" || strings.HasSuffix(requestPath, "/") || strings.Contains(relativePath, "\\") {
		return "", false
	}
	for _, segment := range strings.Split(relativePath, "/") {
		if segment == "" || segment == "." || segment == ".." {
			return "", false
		}
	}
	cleaned := path.Clean(relativePath)
	if cleaned != relativePath {
		return "", false
	}
	return cleaned, true
}
