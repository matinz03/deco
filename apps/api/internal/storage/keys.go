package storage

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"mime"
	"path"
	"strings"
	"time"
)

// maxKeyLength matches the S3 object-key limit.
const maxKeyLength = 1024

// NewObjectKey builds the slash-separated object key for one upload.
//
// The key is entirely server-generated: a prefix chosen from the upload kind,
// a millisecond timestamp, 8 random bytes, and a validated extension. Nothing
// attacker-supplied survives into the key except the extension, and that is
// restricted to lowercase alphanumerics.
func NewObjectKey(kind Kind, originalName, mimeType string) (string, error) {
	prefix := prefixForKind(kind, originalName, mimeType)
	if prefix == "" {
		return "", fmt.Errorf("storage: unsupported upload kind: %q", string(kind))
	}

	key := path.Join(prefix, fmt.Sprintf("%d_%s%s", time.Now().UnixMilli(), randomID(), fileExtension(originalName, mimeType)))
	if err := ValidateKey(key); err != nil {
		return "", err
	}
	return key, nil
}

// ValidateKey rejects keys that could escape a directory root, confuse a URL
// parser, or smuggle header bytes. Keys are server-generated today, but the
// Backend interface is reachable from anywhere in the API, so every backend
// re-validates rather than trusting its caller.
func ValidateKey(key string) error {
	if key == "" {
		return fmt.Errorf("%w: empty", ErrInvalidKey)
	}
	if len(key) > maxKeyLength {
		return fmt.Errorf("%w: longer than %d bytes", ErrInvalidKey, maxKeyLength)
	}
	if strings.HasPrefix(key, "/") {
		return fmt.Errorf("%w: absolute path", ErrInvalidKey)
	}
	if strings.ContainsAny(key, "\\") {
		return fmt.Errorf("%w: contains a backslash", ErrInvalidKey)
	}
	for _, r := range key {
		if r < 0x20 || r == 0x7f {
			return fmt.Errorf("%w: contains a control character", ErrInvalidKey)
		}
	}
	for _, segment := range strings.Split(key, "/") {
		switch segment {
		case "":
			return fmt.Errorf("%w: empty path segment", ErrInvalidKey)
		case ".", "..":
			return fmt.Errorf("%w: relative path segment %q", ErrInvalidKey, segment)
		}
	}
	return nil
}

// prefixForKind returns the slash-separated key prefix for an upload kind.
// These prefixes are the same directory names the local backend used before
// this package had a Backend interface; existing URLs depend on them.
func prefixForKind(kind Kind, originalName, mimeType string) string {
	switch kind {
	case KindAvatar:
		return "avatars"
	case KindImage:
		return "messages/images"
	case KindVideo:
		return "messages/videos"
	case KindAudio:
		return "messages/audio"
	case KindFile:
		return "messages/files"
	case KindSticker:
		ext := strings.ToLower(path.Ext(strings.ReplaceAll(originalName, "\\", "/")))
		if ext == ".tgs" || mimeType == "application/x-tgsticker" {
			return "stickers/animated"
		}
		if strings.HasPrefix(mimeType, "video/") || ext == ".webm" {
			return "stickers/video"
		}
		return "stickers/static"
	default:
		return ""
	}
}

// fileExtension picks the stored extension. The client-supplied filename is
// only trusted for an extension that is a short run of lowercase
// alphanumerics; anything else falls back to the sniffed MIME type and then
// to .bin. Without this a filename such as `x.<script>` would end up inside a
// served URL.
func fileExtension(originalName, mimeType string) string {
	if ext := strings.ToLower(path.Ext(normalizeName(originalName))); isSafeExtension(ext) {
		return ext
	}
	if exts, _ := mime.ExtensionsByType(mimeType); len(exts) > 0 {
		if ext := strings.ToLower(exts[0]); isSafeExtension(ext) {
			return ext
		}
	}
	return ".bin"
}

func isSafeExtension(ext string) bool {
	if len(ext) < 2 || len(ext) > 10 || ext[0] != '.' {
		return false
	}
	for i := 1; i < len(ext); i++ {
		c := ext[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			continue
		}
		return false
	}
	return true
}

func normalizeName(name string) string {
	return strings.ReplaceAll(strings.TrimSpace(name), "\\", "/")
}

// sanitizeFileName produces the display name echoed back to the client. It is
// never used to build a key or a path.
func sanitizeFileName(name string) string {
	name = path.Base(normalizeName(name))

	var b strings.Builder
	for _, r := range name {
		if r < 0x20 || r == 0x7f {
			continue
		}
		b.WriteRune(r)
	}
	cleaned := strings.TrimSpace(b.String())

	if cleaned == "" || cleaned == "." || cleaned == ".." || cleaned == "/" {
		return "upload"
	}
	if len(cleaned) > 255 {
		cleaned = cleaned[:255]
	}
	return cleaned
}

// joinURL joins a base URL or path with a slash-separated object key.
func joinURL(base, rel string) string {
	base = strings.TrimRight(base, "/")
	rel = strings.TrimLeft(rel, "/")
	return base + "/" + rel
}

func randomID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(buf)
}
