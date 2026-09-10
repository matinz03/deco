package middleware

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// PostgresClerkUserMapper resolves a Clerk id to the internal user UUID using
// the `users.clerk_user_id` column. The internal UUID primary key is unchanged;
// this is a lookup, not a re-keying.
type PostgresClerkUserMapper struct {
	pool *pgxpool.Pool
}

func NewPostgresClerkUserMapper(pool *pgxpool.Pool) *PostgresClerkUserMapper {
	return &PostgresClerkUserMapper{pool: pool}
}

func (m *PostgresClerkUserMapper) InternalUserID(ctx context.Context, clerkUserID string) (string, error) {
	if m == nil || m.pool == nil {
		return "", ErrProfileRequired
	}
	if !validSubject(clerkUserID) {
		return "", ErrUnauthorized
	}

	var id string
	err := m.pool.QueryRow(ctx, `
		SELECT id::text
		FROM users
		WHERE clerk_user_id = $1
	`, clerkUserID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrProfileRequired
	}
	if err != nil {
		// A database failure must not be reported as "no profile" — that
		// would turn an outage into a 409 storm and, worse, invite a client
		// to re-bootstrap. Fail closed as unauthorized.
		return "", ErrUnauthorized
	}
	return id, nil
}

// RedisCache adapts *redis.Client to the Cache interface. Every error is a miss:
// the cache can only ever speed up a decision, never make one.
type RedisCache struct {
	client *redis.Client
}

func NewRedisCache(client *redis.Client) *RedisCache {
	return &RedisCache{client: client}
}

func (c *RedisCache) GetString(ctx context.Context, key string) (string, bool) {
	if c == nil || c.client == nil {
		return "", false
	}
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()

	v, err := c.client.Get(ctx, key).Result()
	if err != nil || v == "" {
		return "", false
	}
	return v, true
}

func (c *RedisCache) SetString(ctx context.Context, key, value string, ttl time.Duration) {
	if c == nil || c.client == nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancel()

	if value == "" {
		c.client.Del(ctx, key)
		return
	}
	c.client.Set(ctx, key, value, ttl)
}
