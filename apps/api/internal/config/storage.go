package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// StorageBackendName selects the media storage implementation.
type StorageBackendName string

const (
	// StorageBackendLocal writes to the API server's own disk and serves the
	// files through http.FileServer. Development / single-host fallback: it
	// cannot sign URLs and does not enforce the public/private split.
	StorageBackendLocal StorageBackendName = "local"
	// StorageBackendS3 talks to any S3-compatible provider. Deco runs MinIO
	// behind it in both development and production; the same code path works
	// against any other S3-compatible service without changes.
	StorageBackendS3 StorageBackendName = "s3"
)

// SupportedStorageBackends is the complete set of accepted STORAGE_BACKEND
// values, used for validation and for the error message.
var SupportedStorageBackends = []StorageBackendName{StorageBackendLocal, StorageBackendS3}

// DefaultStorageBackend applies when STORAGE_BACKEND is not set at all. It is
// deliberately the pre-existing behaviour so that an environment written
// before this variable existed keeps booting. A STORAGE_BACKEND that IS set
// but is not recognised is a boot failure, never a silent fallback.
const DefaultStorageBackend = StorageBackendLocal

// MaxStoragePresignTTL bounds STORAGE_PRESIGN_TTL. A presigned URL is a bearer
// credential for one object; a long TTL turns a leaked URL into long-lived
// unauthenticated access.
const MaxStoragePresignTTL = time.Hour

// DefaultStoragePresignTTL applies when STORAGE_PRESIGN_TTL is unset.
const DefaultStoragePresignTTL = 5 * time.Minute

// StorageConfig is the storage half of the API configuration. It lives in its
// own file and is loaded by its own function so that storage settings can
// evolve without touching config.go.
type StorageConfig struct {
	Backend StorageBackendName

	// Local backend.
	UploadRoot       string
	PublicUploadBase string

	// S3-compatible backend.
	S3Endpoint        string
	S3PresignEndpoint string
	S3Region          string
	S3AccessKeyID     string
	S3SecretKey       string
	S3UsePathStyle    bool
	PublicBucket      string
	PrivateBucket     string
	PublicBaseURL     string
	PresignTTL        time.Duration
	CORSOrigins       []string
}

// LoadStorage reads the storage configuration from the environment and
// validates it completely.
//
// Every failure it can detect is returned here so the caller can abort at
// boot. Discovering a missing bucket name or an unparseable TTL on the first
// user upload — hours after a deploy — is the failure mode this exists to
// prevent.
func LoadStorage() (*StorageConfig, error) {
	cfg := &StorageConfig{
		UploadRoot:       getEnv("UPLOAD_ROOT", "./uploads"),
		PublicUploadBase: getEnv("PUBLIC_UPLOAD_BASE", "/api/v1/media"),
	}

	raw, set := os.LookupEnv("STORAGE_BACKEND")
	name := StorageBackendName(strings.ToLower(strings.TrimSpace(raw)))
	switch {
	case !set || strings.TrimSpace(raw) == "":
		cfg.Backend = DefaultStorageBackend
	case name == StorageBackendLocal || name == StorageBackendS3:
		cfg.Backend = name
	default:
		return nil, fmt.Errorf("STORAGE_BACKEND=%q is not a known storage backend (supported: %s)", raw, storageBackendList())
	}

	if cfg.Backend == StorageBackendLocal {
		if strings.TrimSpace(cfg.UploadRoot) == "" {
			return nil, fmt.Errorf("UPLOAD_ROOT must not be empty when STORAGE_BACKEND=local")
		}
		return cfg, nil
	}

	// The R2_* variables in config.go are deliberately NOT consulted here.
	// They remain unused placeholders; object storage is configured only
	// through STORAGE_*, so switching providers never depends on which of two
	// overlapping variable sets happens to be set.
	cfg.S3Endpoint = strings.TrimRight(strings.TrimSpace(os.Getenv("STORAGE_S3_ENDPOINT")), "/")
	if cfg.S3Endpoint == "" {
		return nil, fmt.Errorf("STORAGE_S3_ENDPOINT must be set when STORAGE_BACKEND=s3")
	}
	if !strings.HasPrefix(cfg.S3Endpoint, "http://") && !strings.HasPrefix(cfg.S3Endpoint, "https://") {
		return nil, fmt.Errorf("STORAGE_S3_ENDPOINT=%q must start with http:// or https://", cfg.S3Endpoint)
	}
	cfg.S3PresignEndpoint = strings.TrimRight(strings.TrimSpace(getEnv("STORAGE_S3_PRESIGN_ENDPOINT", cfg.S3Endpoint)), "/")
	if !strings.HasPrefix(cfg.S3PresignEndpoint, "http://") && !strings.HasPrefix(cfg.S3PresignEndpoint, "https://") {
		return nil, fmt.Errorf("STORAGE_S3_PRESIGN_ENDPOINT=%q must start with http:// or https://", cfg.S3PresignEndpoint)
	}
	for _, origin := range strings.Split(getEnv("ALLOWED_ORIGINS", "http://localhost:3000"), ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			cfg.CORSOrigins = append(cfg.CORSOrigins, trimmed)
		}
	}
	if len(cfg.CORSOrigins) == 0 {
		return nil, fmt.Errorf("ALLOWED_ORIGINS must contain at least one browser origin when STORAGE_BACKEND=s3")
	}

	// MinIO validates the CreateBucket location constraint; us-east-1 is the
	// value for which the SDK omits it entirely. Providers that require a
	// specific region (Cloudflare R2 wants "auto") override this.
	cfg.S3Region = getEnv("STORAGE_S3_REGION", "us-east-1")
	cfg.S3AccessKeyID = strings.TrimSpace(os.Getenv("STORAGE_S3_ACCESS_KEY_ID"))
	cfg.S3SecretKey = strings.TrimSpace(os.Getenv("STORAGE_S3_SECRET_ACCESS_KEY"))
	if cfg.S3AccessKeyID == "" || cfg.S3SecretKey == "" {
		return nil, fmt.Errorf("STORAGE_S3_ACCESS_KEY_ID and STORAGE_S3_SECRET_ACCESS_KEY must be set when STORAGE_BACKEND=s3")
	}

	pathStyle, err := parseBoolEnv("STORAGE_S3_FORCE_PATH_STYLE", false)
	if err != nil {
		return nil, err
	}
	cfg.S3UsePathStyle = pathStyle

	cfg.PublicBucket = strings.TrimSpace(getEnv("STORAGE_PUBLIC_BUCKET", "deco-public"))
	cfg.PrivateBucket = strings.TrimSpace(getEnv("STORAGE_PRIVATE_BUCKET", "deco-private"))
	if cfg.PublicBucket == "" || cfg.PrivateBucket == "" {
		return nil, fmt.Errorf("STORAGE_PUBLIC_BUCKET and STORAGE_PRIVATE_BUCKET must not be empty when STORAGE_BACKEND=s3")
	}
	if cfg.PublicBucket == cfg.PrivateBucket {
		return nil, fmt.Errorf("STORAGE_PUBLIC_BUCKET and STORAGE_PRIVATE_BUCKET must name different buckets (both are %q); message attachments must not live in a publicly readable bucket", cfg.PublicBucket)
	}

	// The origin browsers fetch avatars and stickers from. It is persisted
	// onto user and sticker rows, so an internal container hostname here
	// would be baked into the database. Left empty it is derived from the
	// endpoint, which is only ever right for local development.
	cfg.PublicBaseURL = strings.TrimRight(strings.TrimSpace(os.Getenv("STORAGE_PUBLIC_BASE_URL")), "/")

	ttl, err := parseDurationEnv("STORAGE_PRESIGN_TTL", DefaultStoragePresignTTL)
	if err != nil {
		return nil, err
	}
	if ttl <= 0 {
		return nil, fmt.Errorf("STORAGE_PRESIGN_TTL must be positive")
	}
	if ttl > MaxStoragePresignTTL {
		return nil, fmt.Errorf("STORAGE_PRESIGN_TTL=%s exceeds the maximum of %s", ttl, MaxStoragePresignTTL)
	}
	cfg.PresignTTL = ttl

	return cfg, nil
}

func storageBackendList() string {
	names := make([]string, 0, len(SupportedStorageBackends))
	for _, n := range SupportedStorageBackends {
		names = append(names, string(n))
	}
	return strings.Join(names, ", ")
}

func parseBoolEnv(key string, fallback bool) (bool, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseBool(raw)
	if err != nil {
		return false, fmt.Errorf("%s=%q is not a boolean", key, raw)
	}
	return value, nil
}

func parseDurationEnv(key string, fallback time.Duration) (time.Duration, error) {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("%s=%q is not a duration (e.g. 5m, 30s)", key, raw)
	}
	return value, nil
}
