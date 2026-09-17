package storage

import (
	"fmt"

	"github.com/matinz03/deco/internal/config"
)

// NewBackend builds the configured storage backend.
//
// It is called once, at boot, from cmd/server. Every configuration problem it
// can see is an error returned here so the process refuses to start, rather
// than a nil-pointer or an authentication failure on the first upload.
func NewBackend(cfg *config.StorageConfig) (Backend, error) {
	if cfg == nil {
		return nil, fmt.Errorf("storage: nil storage config")
	}

	switch cfg.Backend {
	case config.StorageBackendLocal:
		return NewLocalBackend(cfg.UploadRoot, cfg.PublicUploadBase)

	case config.StorageBackendS3:
		return NewS3Backend(S3Options{
			Endpoint:        cfg.S3Endpoint,
			PresignEndpoint: cfg.S3PresignEndpoint,
			Region:          cfg.S3Region,
			AccessKeyID:     cfg.S3AccessKeyID,
			SecretAccessKey: cfg.S3SecretKey,
			UsePathStyle:    cfg.S3UsePathStyle,
			PublicBucket:    cfg.PublicBucket,
			PrivateBucket:   cfg.PrivateBucket,
			PublicBaseURL:   cfg.PublicBaseURL,
			PrivateRefBase:  cfg.PublicUploadBase,
			DefaultTTL:      cfg.PresignTTL,
			CORSOrigins:     cfg.CORSOrigins,
		})

	default:
		return nil, fmt.Errorf("storage: unsupported backend %q", string(cfg.Backend))
	}
}
