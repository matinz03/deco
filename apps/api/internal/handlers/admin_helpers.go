package handlers

import (
	"context"
	"slices"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/matinz03/deco/internal/models"
)

const userSelectColumns = `
	u.id,
	u.username,
	COALESCE(u.email, ''),
	u.display_name,
	u.public_key,
	u.avatar_url,
	u.bio,
	u.is_admin,
	COALESCE(u.restricted_actions, '{}'::text[]),
	u.last_seen_at,
	u.created_at,
	(
		SELECT first_user.id = u.id
		FROM users first_user
		ORDER BY first_user.created_at ASC, first_user.id ASC
		LIMIT 1
	) AS is_owner
`

var allowedRestrictedActions = []string{
	"create_conversations",
	"manage_stickers",
	"send_messages",
}

func scanUser(row pgx.Row, user *models.User) error {
	return row.Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.DisplayName,
		&user.PublicKey,
		&user.AvatarURL,
		&user.Bio,
		&user.IsAdmin,
		&user.RestrictedActions,
		&user.LastSeenAt,
		&user.CreatedAt,
		&user.IsOwner,
	)
}

func normalizeRestrictedActions(input []string) []string {
	if len(input) == 0 {
		return []string{}
	}

	set := make(map[string]struct{}, len(input))
	for _, action := range input {
		action = strings.TrimSpace(action)
		if action == "" || !slices.Contains(allowedRestrictedActions, action) {
			continue
		}
		set[action] = struct{}{}
	}

	result := make([]string, 0, len(set))
	for action := range set {
		result = append(result, action)
	}
	sort.Strings(result)
	return result
}

func hasRestrictedAction(actions []string, action string) bool {
	return slices.Contains(actions, action)
}

func getUserRestrictionState(ctx context.Context, pool *pgxpool.Pool, userID string) (bool, []string, error) {
	var isAdmin bool
	var restrictedActions []string
	err := pool.QueryRow(ctx, `
		SELECT is_admin, COALESCE(restricted_actions, '{}'::text[])
		FROM users
		WHERE id = $1
	`, userID).Scan(&isAdmin, &restrictedActions)
	return isAdmin, restrictedActions, err
}

func requireAllowedAction(ctx context.Context, pool *pgxpool.Pool, userID, action string) error {
	isAdmin, restrictedActions, err := getUserRestrictionState(ctx, pool, userID)
	if err != nil {
		return err
	}
	if isAdmin {
		return nil
	}
	if hasRestrictedAction(restrictedActions, action) {
		return pgx.ErrNoRows
	}
	return nil
}

func isAdminUser(ctx context.Context, pool *pgxpool.Pool, userID string) (bool, error) {
	var isAdmin bool
	err := pool.QueryRow(ctx, `
		SELECT is_admin
		FROM users
		WHERE id = $1
	`, userID).Scan(&isAdmin)
	return isAdmin, err
}
