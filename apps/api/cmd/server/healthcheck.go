package main

import (
	"fmt"
	"net/http"
	"os"
	"time"
)

func checkHealth() error {
	url := os.Getenv("API_HEALTHCHECK_URL")
	if url == "" {
		url = "http://127.0.0.1:8080/health"
	}

	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("API healthcheck request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("API healthcheck returned %s", response.Status)
	}
	return nil
}
