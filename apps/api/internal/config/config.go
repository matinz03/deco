package config

import "os"

type Config struct {
	Port           string
	Env            string
	DatabaseURL    string
	RedisURL       string
	JWTSecret      string
	AllowedOrigins string
	UploadRoot     string
	PublicUploadBase string
	R2AccountID    string
	R2AccessKey    string
	R2SecretKey    string
	R2BucketName   string
	R2PublicURL    string
	AnthropicKey   string
}

func Load() *Config {
	return &Config{
		Port:           getEnv("API_PORT", "8080"),
		Env:            getEnv("API_ENV", "development"),
		DatabaseURL:    getEnv("DATABASE_URL", ""),
		RedisURL:       getEnv("REDIS_URL", "redis://localhost:6379"),
		JWTSecret:      getEnv("JWT_SECRET", "change-me"),
		AllowedOrigins: getEnv("ALLOWED_ORIGINS", "http://localhost:3000"),
		UploadRoot:     getEnv("UPLOAD_ROOT", "./uploads"),
		PublicUploadBase: getEnv("PUBLIC_UPLOAD_BASE", "/api/v1/media"),
		R2AccountID:    getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKey:    getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretKey:    getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:   getEnv("R2_BUCKET_NAME", "deco-media"),
		R2PublicURL:    getEnv("R2_PUBLIC_URL", ""),
		AnthropicKey:   getEnv("ANTHROPIC_API_KEY", ""),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
