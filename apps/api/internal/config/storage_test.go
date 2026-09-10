package config

import (
	"strings"
	"testing"
	"time"
)

// storageEnvKeys is every variable LoadStorage reads. Tests blank them all so
// a developer's real .env cannot make an assertion pass or fail by accident.
var storageEnvKeys = []string{
	"STORAGE_BACKEND",
	"STORAGE_S3_ENDPOINT",
	"STORAGE_S3_REGION",
	"STORAGE_S3_ACCESS_KEY_ID",
	"STORAGE_S3_SECRET_ACCESS_KEY",
	"STORAGE_S3_FORCE_PATH_STYLE",
	"STORAGE_PUBLIC_BUCKET",
	"STORAGE_PRIVATE_BUCKET",
	"STORAGE_PUBLIC_BASE_URL",
	"STORAGE_PRESIGN_TTL",
	"UPLOAD_ROOT",
	"PUBLIC_UPLOAD_BASE",
	"R2_ENDPOINT",
	"R2_ACCOUNT_ID",
	"R2_ACCESS_KEY_ID",
	"R2_SECRET_ACCESS_KEY",
	"R2_PUBLIC_URL",
}

func clearStorageEnv(t *testing.T) {
	t.Helper()
	for _, key := range storageEnvKeys {
		t.Setenv(key, "")
	}
}

// A STORAGE_BACKEND value that is not a backend must stop the process at boot.
// The failure this guards against is a typo that boots cleanly and only
// surfaces when the first user uploads a file.
func TestLoadStorageRejectsUnknownBackendAtBoot(t *testing.T) {
	for _, name := range []string{"minio", "r2", "localhost", "disk", "gcs", "s3x"} {
		t.Run(name, func(t *testing.T) {
			clearStorageEnv(t)
			t.Setenv("STORAGE_BACKEND", name)

			cfg, err := LoadStorage()
			if err == nil {
				t.Fatalf("expected STORAGE_BACKEND=%q to fail at boot, got backend %q", name, cfg.Backend)
			}
			if !strings.Contains(err.Error(), "STORAGE_BACKEND") {
				t.Errorf("error should name the offending variable, got: %v", err)
			}
			if !strings.Contains(err.Error(), "local") || !strings.Contains(err.Error(), "s3") {
				t.Errorf("error should list the supported backends, got: %v", err)
			}
		})
	}
}

// Casing and stray whitespace from a hand-edited .env must still resolve to a
// backend rather than being rejected.
func TestLoadStorageAcceptsKnownBackendNames(t *testing.T) {
	cases := map[string]StorageBackendName{
		"local": StorageBackendLocal,
		"LOCAL": StorageBackendLocal,
		" s3 ":  StorageBackendS3,
		"S3":    StorageBackendS3,
	}

	for raw, want := range cases {
		t.Run(raw, func(t *testing.T) {
			clearStorageEnv(t)
			t.Setenv("STORAGE_BACKEND", raw)
			if want == StorageBackendS3 {
				t.Setenv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")
				t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
				t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")
			}

			cfg, err := LoadStorage()
			if err != nil {
				t.Fatalf("LoadStorage() error = %v", err)
			}
			if cfg.Backend != want {
				t.Errorf("backend = %q, want %q", cfg.Backend, want)
			}
		})
	}
}

// An environment written before STORAGE_BACKEND existed must keep booting on
// the pre-existing on-disk behaviour.
func TestLoadStorageDefaultsToLocalWhenUnset(t *testing.T) {
	clearStorageEnv(t)

	cfg, err := LoadStorage()
	if err != nil {
		t.Fatalf("LoadStorage() error = %v", err)
	}
	if cfg.Backend != StorageBackendLocal {
		t.Errorf("backend = %q, want %q", cfg.Backend, StorageBackendLocal)
	}
	if cfg.UploadRoot != "./uploads" {
		t.Errorf("UploadRoot = %q, want ./uploads", cfg.UploadRoot)
	}
	if cfg.PublicUploadBase != "/api/v1/media" {
		t.Errorf("PublicUploadBase = %q, want /api/v1/media", cfg.PublicUploadBase)
	}
}

func TestLoadStorageS3RequiresCredentialsAndEndpoint(t *testing.T) {
	t.Run("no endpoint", func(t *testing.T) {
		clearStorageEnv(t)
		t.Setenv("STORAGE_BACKEND", "s3")
		t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
		t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")

		if _, err := LoadStorage(); err == nil {
			t.Fatal("expected an error when no endpoint is configured")
		}
	})

	t.Run("no credentials", func(t *testing.T) {
		clearStorageEnv(t)
		t.Setenv("STORAGE_BACKEND", "s3")
		t.Setenv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")

		if _, err := LoadStorage(); err == nil {
			t.Fatal("expected an error when no credentials are configured")
		}
	})

	t.Run("endpoint without a scheme", func(t *testing.T) {
		clearStorageEnv(t)
		t.Setenv("STORAGE_BACKEND", "s3")
		t.Setenv("STORAGE_S3_ENDPOINT", "127.0.0.1:9000")
		t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
		t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")

		if _, err := LoadStorage(); err == nil {
			t.Fatal("expected an error for an endpoint with no http/https scheme")
		}
	})
}

// Message attachments must never share a bucket with avatars and stickers,
// because the public bucket carries an anonymous read policy.
func TestLoadStorageRejectsSharedPublicAndPrivateBucket(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("STORAGE_BACKEND", "s3")
	t.Setenv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")
	t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
	t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")
	t.Setenv("STORAGE_PUBLIC_BUCKET", "deco-media")
	t.Setenv("STORAGE_PRIVATE_BUCKET", "deco-media")

	if _, err := LoadStorage(); err == nil {
		t.Fatal("expected an error when both logical buckets name the same bucket")
	}
}

func TestLoadStoragePresignTTL(t *testing.T) {
	t.Run("defaults to five minutes", func(t *testing.T) {
		clearStorageEnv(t)
		t.Setenv("STORAGE_BACKEND", "s3")
		t.Setenv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")
		t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
		t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")

		cfg, err := LoadStorage()
		if err != nil {
			t.Fatalf("LoadStorage() error = %v", err)
		}
		if cfg.PresignTTL != DefaultStoragePresignTTL {
			t.Errorf("PresignTTL = %s, want %s", cfg.PresignTTL, DefaultStoragePresignTTL)
		}
	})

	t.Run("rejects a TTL above the maximum", func(t *testing.T) {
		clearStorageEnv(t)
		t.Setenv("STORAGE_BACKEND", "s3")
		t.Setenv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")
		t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
		t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")
		t.Setenv("STORAGE_PRESIGN_TTL", "168h")

		if _, err := LoadStorage(); err == nil {
			t.Fatalf("expected a TTL above %s to be rejected at boot", MaxStoragePresignTTL)
		}
	})

	t.Run("rejects an unparseable TTL", func(t *testing.T) {
		clearStorageEnv(t)
		t.Setenv("STORAGE_BACKEND", "s3")
		t.Setenv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")
		t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
		t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")
		t.Setenv("STORAGE_PRESIGN_TTL", "five minutes")

		if _, err := LoadStorage(); err == nil {
			t.Fatal("expected an unparseable STORAGE_PRESIGN_TTL to fail at boot")
		}
	})

	t.Run("accepts a short explicit TTL", func(t *testing.T) {
		clearStorageEnv(t)
		t.Setenv("STORAGE_BACKEND", "s3")
		t.Setenv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")
		t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
		t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")
		t.Setenv("STORAGE_PRESIGN_TTL", "90s")

		cfg, err := LoadStorage()
		if err != nil {
			t.Fatalf("LoadStorage() error = %v", err)
		}
		if cfg.PresignTTL != 90*time.Second {
			t.Errorf("PresignTTL = %s, want 90s", cfg.PresignTTL)
		}
	})
}

// The R2_* variables in config.go are unused placeholders. Storage must be
// configured only through STORAGE_*, so that a stale R2 secret left in an env
// file can never quietly become the credential the API uploads with.
func TestLoadStorageIgnoresR2Variables(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("STORAGE_BACKEND", "s3")
	t.Setenv("R2_ACCOUNT_ID", "abc123")
	t.Setenv("R2_ENDPOINT", "https://abc123.r2.cloudflarestorage.com")
	t.Setenv("R2_ACCESS_KEY_ID", "r2-key")
	t.Setenv("R2_SECRET_ACCESS_KEY", "r2-secret")
	t.Setenv("R2_PUBLIC_URL", "https://media.example.com")

	if _, err := LoadStorage(); err == nil {
		t.Fatal("the R2_* variables alone configured the s3 backend; they must be ignored")
	}

	t.Setenv("STORAGE_S3_ENDPOINT", "http://minio:9000")
	t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "storage-key")
	t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "storage-secret")

	cfg, err := LoadStorage()
	if err != nil {
		t.Fatalf("LoadStorage() error = %v", err)
	}
	if cfg.S3Endpoint != "http://minio:9000" {
		t.Errorf("S3Endpoint = %q, want the STORAGE_S3_ENDPOINT value", cfg.S3Endpoint)
	}
	if cfg.S3AccessKeyID != "storage-key" || cfg.S3SecretKey != "storage-secret" {
		t.Errorf("credentials = %q / %q, want the STORAGE_S3_* values", cfg.S3AccessKeyID, cfg.S3SecretKey)
	}
	if cfg.PublicBaseURL != "" {
		t.Errorf("PublicBaseURL = %q, want empty: R2_PUBLIC_URL must not be consulted", cfg.PublicBaseURL)
	}
}

func TestLoadStorageDefaultRegionSuitsMinIO(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("STORAGE_BACKEND", "s3")
	t.Setenv("STORAGE_S3_ENDPOINT", "http://minio:9000")
	t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
	t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")

	cfg, err := LoadStorage()
	if err != nil {
		t.Fatalf("LoadStorage() error = %v", err)
	}
	// us-east-1 is the region for which the SDK omits the CreateBucket
	// location constraint that MinIO validates.
	if cfg.S3Region != "us-east-1" {
		t.Errorf("S3Region = %q, want us-east-1", cfg.S3Region)
	}
}

func TestLoadStorageRejectsNonBooleanPathStyle(t *testing.T) {
	clearStorageEnv(t)
	t.Setenv("STORAGE_BACKEND", "s3")
	t.Setenv("STORAGE_S3_ENDPOINT", "http://127.0.0.1:9000")
	t.Setenv("STORAGE_S3_ACCESS_KEY_ID", "key")
	t.Setenv("STORAGE_S3_SECRET_ACCESS_KEY", "secret")
	t.Setenv("STORAGE_S3_FORCE_PATH_STYLE", "yes-please")

	if _, err := LoadStorage(); err == nil {
		t.Fatal("expected a non-boolean STORAGE_S3_FORCE_PATH_STYLE to fail at boot")
	}
}
