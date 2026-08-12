package storage

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type Kind string

const (
	KindAvatar  Kind = "avatar"
	KindImage   Kind = "image"
	KindVideo   Kind = "video"
	KindAudio   Kind = "audio"
	KindFile    Kind = "file"
	KindSticker Kind = "sticker"
)

type SavedFile struct {
	URL      string
	MimeType string
	Size     int64
	Name     string
}

func EnsureDirectories(root string) error {
	for _, dir := range []string{
		filepath.Join(root, "avatars"),
		filepath.Join(root, "messages", "images"),
		filepath.Join(root, "messages", "videos"),
		filepath.Join(root, "messages", "audio"),
		filepath.Join(root, "messages", "files"),
		filepath.Join(root, "stickers", "static"),
		filepath.Join(root, "stickers", "video"),
		filepath.Join(root, "stickers", "animated"),
	} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return nil
}

func Save(kind Kind, root, publicBase, originalName, mimeType string, data io.Reader, size int64) (*SavedFile, error) {
	subdir := subdirectoryForKind(kind, originalName, mimeType)
	if subdir == "" {
		return nil, fmt.Errorf("unsupported upload kind: %s", kind)
	}

	if err := EnsureDirectories(root); err != nil {
		return nil, err
	}

	ext := fileExtension(originalName, mimeType)
	filename := fmt.Sprintf("%d_%s%s", time.Now().UnixMilli(), randomID(), ext)
	relativePath := filepath.Join(subdir, filename)
	absolutePath := filepath.Join(root, relativePath)

	file, err := os.Create(absolutePath)
	if err != nil {
		return nil, err
	}

	written, err := io.Copy(file, data)
	if err != nil {
		_ = file.Close()
		_ = os.Remove(absolutePath)
		return nil, err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(absolutePath)
		return nil, err
	}

	return &SavedFile{
		URL:      joinURL(publicBase, filepath.ToSlash(relativePath)),
		MimeType: mimeType,
		Size:     written,
		Name:     sanitizeFileName(originalName),
	}, nil
}

func DetectMimeType(header []byte, _ string) string {
	// A multipart Content-Type is supplied by an untrusted client. Keep it out
	// of the authorization decision when the bytes cannot be identified.
	return http.DetectContentType(header)
}

func subdirectoryForKind(kind Kind, originalName, mimeType string) string {
	switch kind {
	case KindAvatar:
		return "avatars"
	case KindImage:
		return filepath.Join("messages", "images")
	case KindVideo:
		return filepath.Join("messages", "videos")
	case KindAudio:
		return filepath.Join("messages", "audio")
	case KindFile:
		return filepath.Join("messages", "files")
	case KindSticker:
		if strings.HasSuffix(strings.ToLower(filepath.Ext(originalName)), ".tgs") || mimeType == "application/x-tgsticker" {
			return filepath.Join("stickers", "animated")
		}
		if strings.HasPrefix(mimeType, "video/") || strings.HasSuffix(strings.ToLower(filepath.Ext(originalName)), ".webm") {
			return filepath.Join("stickers", "video")
		}
		return filepath.Join("stickers", "static")
	default:
		return ""
	}
}

func fileExtension(originalName, mimeType string) string {
	ext := strings.ToLower(filepath.Ext(originalName))
	if ext != "" && len(ext) <= 10 {
		return ext
	}
	if exts, _ := mime.ExtensionsByType(mimeType); len(exts) > 0 {
		return exts[0]
	}
	return ".bin"
}

func sanitizeFileName(name string) string {
	name = filepath.Base(strings.TrimSpace(name))
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "upload"
	}
	return name
}

// RemovePrivate removes a server-generated private attachment after a
// definite failure to register it. It refuses public paths and traversal so a
// failed upload can never delete an unrelated file.
func RemovePrivate(root, relativePath string) error {
	cleaned := filepath.ToSlash(filepath.Clean(filepath.FromSlash(relativePath)))
	if cleaned != relativePath || !isPrivateMediaPath(cleaned) {
		return fmt.Errorf("invalid private media path")
	}
	return os.Remove(filepath.Join(root, filepath.FromSlash(cleaned)))
}

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
