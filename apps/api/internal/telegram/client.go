package telegram

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"strings"
	"time"
)

const botAPIBase = "https://api.telegram.org"

type Client struct {
	token      string
	httpClient *http.Client
}

type StickerSet struct {
	Name        string    `json:"name"`
	Title       string    `json:"title"`
	StickerType string    `json:"sticker_type"`
	Stickers    []Sticker `json:"stickers"`
}

type Sticker struct {
	FileID       string      `json:"file_id"`
	FileUniqueID string      `json:"file_unique_id"`
	Type         string      `json:"type"`
	Width        int         `json:"width"`
	Height       int         `json:"height"`
	IsAnimated   bool        `json:"is_animated"`
	IsVideo      bool        `json:"is_video"`
	Emoji        string      `json:"emoji"`
	SetName      string      `json:"set_name"`
	Thumbnail    *PhotoSize  `json:"thumbnail"`
}

type PhotoSize struct {
	FileID string `json:"file_id"`
	Width  int    `json:"width"`
	Height int    `json:"height"`
}

type File struct {
	FileID   string `json:"file_id"`
	FilePath string `json:"file_path"`
}

type responseEnvelope[T any] struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
	Result      T      `json:"result"`
}

func NewClient(token string) *Client {
	if strings.TrimSpace(token) == "" {
		return nil
	}
	return &Client{
		token: strings.TrimSpace(token),
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

func ParseStickerSetInput(input string) string {
	input = strings.TrimSpace(input)
	if input == "" {
		return ""
	}
	input = strings.TrimSuffix(input, "/")
	if !strings.Contains(input, "://") && !strings.HasPrefix(input, "t.me/") {
		return strings.TrimPrefix(input, "@")
	}

	normalized := input
	if strings.HasPrefix(normalized, "t.me/") {
		normalized = "https://" + normalized
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		return strings.TrimPrefix(input, "@")
	}

	if set := parsed.Query().Get("set"); set != "" {
		return strings.TrimPrefix(set, "@")
	}

	base := path.Base(strings.Trim(parsed.Path, "/"))
	if base == "" {
		return ""
	}
	if strings.EqualFold(base, "addstickers") {
		parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
		if len(parts) > 1 {
			return strings.TrimPrefix(parts[len(parts)-1], "@")
		}
	}
	return strings.TrimPrefix(base, "@")
}

func (c *Client) GetStickerSet(ctx context.Context, name string) (*StickerSet, error) {
	if c == nil {
		return nil, fmt.Errorf("telegram bot token is not configured")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("sticker set name is required")
	}
	endpoint := fmt.Sprintf("%s/bot%s/getStickerSet?name=%s", botAPIBase, c.token, url.QueryEscape(name))
	var env responseEnvelope[StickerSet]
	if err := c.doJSON(ctx, endpoint, &env); err != nil {
		return nil, err
	}
	if !env.OK {
		return nil, fmt.Errorf(env.Description)
	}
	return &env.Result, nil
}

func (c *Client) GetFile(ctx context.Context, fileID string) (*File, error) {
	if c == nil {
		return nil, fmt.Errorf("telegram bot token is not configured")
	}
	endpoint := fmt.Sprintf("%s/bot%s/getFile?file_id=%s", botAPIBase, c.token, url.QueryEscape(fileID))
	var env responseEnvelope[File]
	if err := c.doJSON(ctx, endpoint, &env); err != nil {
		return nil, err
	}
	if !env.OK {
		return nil, fmt.Errorf(env.Description)
	}
	return &env.Result, nil
}

func (c *Client) DownloadFile(ctx context.Context, filePath string) (io.ReadCloser, error) {
	if c == nil {
		return nil, fmt.Errorf("telegram bot token is not configured")
	}
	endpoint := fmt.Sprintf("%s/file/bot%s/%s", botAPIBase, c.token, strings.TrimLeft(filePath, "/"))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	res, err := c.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		defer res.Body.Close()
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return nil, fmt.Errorf("telegram file download failed: %s", strings.TrimSpace(string(body)))
	}
	return res.Body, nil
}

func (c *Client) doJSON(ctx context.Context, endpoint string, target any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return err
	}
	res, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 4096))
		return fmt.Errorf("telegram api failed: %s", strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(res.Body).Decode(target)
}
