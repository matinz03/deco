package storage

import (
	"regexp"
	"strings"
	"testing"
)

// generatedName is the filename shape every backend must produce:
// <unix-millis>_<16 hex chars><extension>.
var generatedName = regexp.MustCompile(`^[0-9]{10,}_[0-9a-f]{16}\.[a-z0-9]{1,9}$`)

// The key prefixes are load-bearing: URLs already stored on message and
// sticker rows resolve through them.
func TestNewObjectKeyPrefixes(t *testing.T) {
	cases := []struct {
		kind         Kind
		originalName string
		mimeType     string
		wantPrefix   string
	}{
		{KindAvatar, "me.png", "image/png", "avatars/"},
		{KindImage, "holiday.jpg", "image/jpeg", "messages/images/"},
		{KindVideo, "clip.mp4", "video/mp4", "messages/videos/"},
		{KindAudio, "note.m4a", "audio/mp4", "messages/audio/"},
		{KindFile, "report.pdf", "application/pdf", "messages/files/"},
		{KindSticker, "cat.webp", "image/webp", "stickers/static/"},
		{KindSticker, "cat.webm", "video/webm", "stickers/video/"},
		{KindSticker, "cat.tgs", "application/x-tgsticker", "stickers/animated/"},
	}

	for _, tc := range cases {
		t.Run(string(tc.kind)+"/"+tc.originalName, func(t *testing.T) {
			key, err := NewObjectKey(tc.kind, tc.originalName, tc.mimeType)
			if err != nil {
				t.Fatalf("NewObjectKey() error = %v", err)
			}
			if !strings.HasPrefix(key, tc.wantPrefix) {
				t.Fatalf("key = %q, want prefix %q", key, tc.wantPrefix)
			}
			name := strings.TrimPrefix(key, tc.wantPrefix)
			if !generatedName.MatchString(name) {
				t.Fatalf("generated name %q does not match %s", name, generatedName)
			}
			if err := ValidateKey(key); err != nil {
				t.Fatalf("generated key failed validation: %v", err)
			}
		})
	}
}

func TestNewObjectKeyRejectsUnknownKind(t *testing.T) {
	if _, err := NewObjectKey(Kind("../../etc"), "x.png", "image/png"); err == nil {
		t.Fatal("expected an unknown kind to be rejected")
	}
}

func TestNewObjectKeyIsUnique(t *testing.T) {
	seen := make(map[string]bool, 256)
	for i := 0; i < 256; i++ {
		key, err := NewObjectKey(KindImage, "a.png", "image/png")
		if err != nil {
			t.Fatalf("NewObjectKey() error = %v", err)
		}
		if seen[key] {
			t.Fatalf("duplicate key generated: %q", key)
		}
		seen[key] = true
	}
}

// Filenames are attacker-controlled. Nothing from them may reach a key beyond
// a short lowercase-alphanumeric extension.
func TestFileExtensionRejectsHostileNames(t *testing.T) {
	cases := []struct {
		name     string
		mimeType string
		want     string
	}{
		{"payload.<script>", "application/octet-stream", ".bin"},
		{"payload.jp g", "application/octet-stream", ".bin"},
		{"payload.\"onerror=x\"", "application/octet-stream", ".bin"},
		{"payload.a/b", "application/octet-stream", ".bin"},
		{"payload.verylongextension", "application/octet-stream", ".bin"},
		{"payload", "application/octet-stream", ".bin"},
		{"payload.", "application/octet-stream", ".bin"},
		{"..", "application/octet-stream", ".bin"},
		{"../../../../etc/passwd", "application/octet-stream", ".bin"},
		{"ok.PNG", "image/png", ".png"},
		{"ok.jpeg", "image/jpeg", ".jpeg"},
		{"archive.tar.gz", "application/gzip", ".gz"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := fileExtension(tc.name, tc.mimeType); got != tc.want {
				t.Errorf("fileExtension(%q, %q) = %q, want %q", tc.name, tc.mimeType, got, tc.want)
			}
		})
	}
}

func TestNewObjectKeyNeverEmbedsTheOriginalName(t *testing.T) {
	hostile := []string{
		"../../../../etc/passwd.png",
		"..\\..\\windows\\system32\\config.png",
		"a b\r\nX-Injected: 1.png",
		"pwn.png",
	}

	for _, name := range hostile {
		key, err := NewObjectKey(KindImage, name, "image/png")
		if err != nil {
			t.Fatalf("NewObjectKey(%q) error = %v", name, err)
		}
		if strings.Contains(key, "passwd") || strings.Contains(key, "system32") ||
			strings.Contains(key, "pwn") || strings.Contains(key, "Injected") {
			t.Fatalf("key %q leaked part of the original filename %q", key, name)
		}
		if err := ValidateKey(key); err != nil {
			t.Fatalf("key %q generated from %q failed validation: %v", key, name, err)
		}
	}
}

func TestValidateKeyRejectsUnsafeKeys(t *testing.T) {
	bad := []string{
		"",
		"/absolute/key.png",
		"messages/../../etc/passwd",
		"messages/./images/a.png",
		"messages//images/a.png",
		"messages\\images\\a.png",
		"messages/images/a\x00.png",
		"messages/images/a\r\n.png",
		"..",
		strings.Repeat("a", maxKeyLength+1),
	}

	for _, key := range bad {
		if err := ValidateKey(key); err == nil {
			t.Errorf("ValidateKey(%q) = nil, want an error", key)
		}
	}
}

func TestValidateKeyAcceptsGeneratedShape(t *testing.T) {
	good := []string{
		"avatars/1712345678901_0123456789abcdef.png",
		"messages/files/1712345678901_0123456789abcdef.pdf",
		"stickers/animated/1712345678901_0123456789abcdef.tgs",
	}

	for _, key := range good {
		if err := ValidateKey(key); err != nil {
			t.Errorf("ValidateKey(%q) = %v, want nil", key, err)
		}
	}
}

// Avatars and stickers are public by design; anything attached to a message is
// private. Getting this mapping wrong either breaks sticker packs or leaks
// attachments, so it is asserted directly rather than inferred from a caller.
func TestBucketForKind(t *testing.T) {
	cases := map[Kind]Bucket{
		KindAvatar:  BucketPublic,
		KindSticker: BucketPublic,
		KindImage:   BucketPrivate,
		KindVideo:   BucketPrivate,
		KindAudio:   BucketPrivate,
		KindFile:    BucketPrivate,
	}

	for kind, want := range cases {
		got, err := BucketForKind(kind)
		if err != nil {
			t.Fatalf("BucketForKind(%q) error = %v", kind, err)
		}
		if got != want {
			t.Errorf("BucketForKind(%q) = %q, want %q", kind, got, want)
		}
	}

	if _, err := BucketForKind(Kind("secret")); err == nil {
		t.Error("expected an unknown kind to be rejected")
	}
}

func TestSanitizeFileName(t *testing.T) {
	cases := map[string]string{
		"report.pdf":                "report.pdf",
		"../../../../etc/passwd":    "passwd",
		"..\\..\\windows\\evil.exe": "evil.exe",
		"  spaced.png  ":            "spaced.png",
		"inject\r\nContent-Type: x": "injectContent-Type: x",
		"":                          "upload",
		"..":                        "upload",
		"/":                         "upload",
		strings.Repeat("a", 400):    strings.Repeat("a", 255),
	}

	for input, want := range cases {
		if got := sanitizeFileName(input); got != want {
			t.Errorf("sanitizeFileName(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestSanitizeContentType(t *testing.T) {
	cases := map[string]string{
		"image/png":                     "image/png",
		"IMAGE/PNG":                     "image/png",
		"text/plain; charset=utf-8":     "text/plain",
		"image/png\r\nX-Injected: 1":    "application/octet-stream",
		"image/png\"":                   "application/octet-stream",
		"":                              "application/octet-stream",
		"nonsense":                      "application/octet-stream",
		"image/":                        "application/octet-stream",
		"/png":                          "application/octet-stream",
		"application/x-tgsticker":       "application/x-tgsticker",
		strings.Repeat("a", 200) + "/b": "application/octet-stream",
	}

	for input, want := range cases {
		if got := sanitizeContentType(input); got != want {
			t.Errorf("sanitizeContentType(%q) = %q, want %q", input, got, want)
		}
	}
}
