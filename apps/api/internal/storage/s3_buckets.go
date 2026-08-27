package storage

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
)

// EnsureBuckets provisions both logical buckets at boot so a fresh
// `docker compose up` needs no manual console step.
//
// It is idempotent — running it against an already-provisioned MinIO changes
// nothing — and it fails closed: any bucket it cannot create, any policy it
// cannot apply, and any sign that the PRIVATE bucket is anonymously readable
// is returned as an error for the caller to abort on. Booting an API whose
// attachment bucket is world-readable is worse than not booting at all.
func (b *S3Backend) EnsureBuckets(ctx context.Context) error {
	if err := b.ensureBucketExists(ctx, b.opts.PublicBucket); err != nil {
		return err
	}
	if err := b.ensureBucketExists(ctx, b.opts.PrivateBucket); err != nil {
		return err
	}

	// Avatars and stickers are fetched by plain <img> tags with no
	// credentials, so the public bucket needs an anonymous read policy.
	policy := publicReadPolicy(b.opts.PublicBucket)
	if _, err := b.client.PutBucketPolicy(ctx, &s3.PutBucketPolicyInput{
		Bucket: aws.String(b.opts.PublicBucket),
		Policy: aws.String(policy),
	}); err != nil {
		return fmt.Errorf("storage: applying the public-read policy to bucket %q failed: %w", b.opts.PublicBucket, err)
	}

	// The private bucket must have no anonymous access. This does not
	// silently "fix" a policy someone deliberately put there — it refuses to
	// start and names the bucket.
	if err := b.assertNotAnonymouslyReadable(ctx, b.opts.PrivateBucket); err != nil {
		return err
	}

	return nil
}

func (b *S3Backend) ensureBucketExists(ctx context.Context, bucket string) error {
	_, err := b.client.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(bucket)})
	if err == nil {
		return nil
	}

	if _, createErr := b.client.CreateBucket(ctx, &s3.CreateBucketInput{Bucket: aws.String(bucket)}); createErr != nil {
		if isBucketAlreadyOwned(createErr) {
			return nil
		}
		// Report the original HeadBucket failure too: a permissions or
		// connectivity problem is far more common than a genuinely missing
		// bucket, and the CreateBucket error alone hides it.
		return fmt.Errorf("storage: bucket %q is not reachable (head: %v) and could not be created: %w", bucket, err, createErr)
	}
	return nil
}

// assertNotAnonymouslyReadable fails when the bucket carries a policy that
// allows a wildcard principal.
func (b *S3Backend) assertNotAnonymouslyReadable(ctx context.Context, bucket string) error {
	out, err := b.client.GetBucketPolicy(ctx, &s3.GetBucketPolicyInput{Bucket: aws.String(bucket)})
	if err != nil {
		if isNoSuchBucketPolicy(err) {
			return nil
		}
		return fmt.Errorf("storage: could not read the bucket policy of %q to confirm it is private: %w", bucket, err)
	}
	if out.Policy == nil || strings.TrimSpace(*out.Policy) == "" {
		return nil
	}

	public, err := policyAllowsAnonymousAccess(*out.Policy)
	if err != nil {
		return fmt.Errorf("storage: could not parse the bucket policy of %q to confirm it is private: %w", bucket, err)
	}
	if public {
		return fmt.Errorf("storage: bucket %q holds message attachments but its policy grants access to an anonymous principal; refusing to start", bucket)
	}
	return nil
}

// bucketPolicy is the subset of an S3 bucket policy this check needs.
// Principal is deliberately json.RawMessage: S3 accepts a bare "*", an object
// of principal types, and arrays inside that object.
type bucketPolicy struct {
	Statement []struct {
		Effect    string          `json:"Effect"`
		Principal json.RawMessage `json:"Principal"`
	} `json:"Statement"`
}

func policyAllowsAnonymousAccess(raw string) (bool, error) {
	var parsed bucketPolicy
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return false, err
	}
	for _, statement := range parsed.Statement {
		if !strings.EqualFold(strings.TrimSpace(statement.Effect), "Allow") {
			continue
		}
		if principalIsWildcard(statement.Principal) {
			return true, nil
		}
	}
	return false, nil
}

// principalIsWildcard reports whether any principal in the statement is "*".
// The shape varies, so this walks whatever JSON is there rather than assuming
// one encoding.
func principalIsWildcard(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var decoded any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		// An unparseable principal is not proof of safety.
		return true
	}
	return containsWildcard(decoded)
}

func containsWildcard(value any) bool {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v) == "*"
	case []any:
		for _, item := range v {
			if containsWildcard(item) {
				return true
			}
		}
	case map[string]any:
		for _, item := range v {
			if containsWildcard(item) {
				return true
			}
		}
	}
	return false
}

// publicReadPolicy grants anonymous read — and only read — on the objects of
// one bucket. It never grants ListBucket: a public bucket should serve the
// objects whose keys someone already has, not enumerate every avatar.
func publicReadPolicy(bucket string) string {
	policy := map[string]any{
		"Version": "2012-10-17",
		"Statement": []any{
			map[string]any{
				"Sid":       "DecoPublicRead",
				"Effect":    "Allow",
				"Principal": map[string]any{"AWS": []string{"*"}},
				"Action":    []string{"s3:GetObject"},
				"Resource":  []string{fmt.Sprintf("arn:aws:s3:::%s/*", bucket)},
			},
		},
	}
	encoded, err := json.Marshal(policy)
	if err != nil {
		// The map above is a literal with no unencodable values.
		panic(fmt.Sprintf("storage: encoding the public bucket policy: %v", err))
	}
	return string(encoded)
}

func isBucketAlreadyOwned(err error) bool {
	var owned *types.BucketAlreadyOwnedByYou
	if errors.As(err, &owned) {
		return true
	}
	var exists *types.BucketAlreadyExists
	if errors.As(err, &exists) {
		return true
	}
	return apiErrorCodeIn(err, "BucketAlreadyOwnedByYou", "BucketAlreadyExists")
}

func isNoSuchBucketPolicy(err error) bool {
	return apiErrorCodeIn(err, "NoSuchBucketPolicy")
}

func apiErrorCodeIn(err error, codes ...string) bool {
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	for _, code := range codes {
		if apiErr.ErrorCode() == code {
			return true
		}
	}
	return false
}
