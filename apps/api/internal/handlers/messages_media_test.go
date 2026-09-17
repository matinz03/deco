package handlers

import (
	"strings"
	"testing"

	"github.com/matinz03/deco/internal/models"
)

func TestValidateMediaMessagePolicy(t *testing.T) {
	encryptedImage := registeredMediaObject{Kind: string(models.MessageTypeImage), Encrypted: true}
	plainImage := registeredMediaObject{Kind: string(models.MessageTypeImage), Encrypted: false}

	tests := []struct {
		name             string
		conversationType string
		messageType      string
		media            registeredMediaObject
		requested        bool
		wantError        string
	}{
		{name: "direct accepts encrypted attachment", conversationType: string(models.ConversationTypeDirect), messageType: string(models.MessageTypeImage), media: encryptedImage, requested: true},
		{name: "group rejects plaintext attachment", conversationType: string(models.ConversationTypeGroup), messageType: string(models.MessageTypeImage), media: plainImage, wantError: "must be encrypted"},
		{name: "direct rejects plaintext attachment", conversationType: string(models.ConversationTypeDirect), messageType: string(models.MessageTypeImage), media: plainImage, wantError: "must be encrypted"},
		{name: "saved messages accepts plaintext attachment", conversationType: string(models.ConversationTypeSaved), messageType: string(models.MessageTypeImage), media: plainImage},
		{name: "channel rejects attachment until key distribution exists", conversationType: string(models.ConversationTypeChannel), messageType: string(models.MessageTypeImage), media: encryptedImage, requested: true, wantError: "channel attachments"},
		{name: "rejects mismatched kind", conversationType: string(models.ConversationTypeDirect), messageType: string(models.MessageTypeVideo), media: encryptedImage, requested: true, wantError: "type does not match"},
		{name: "rejects false encryption claim", conversationType: string(models.ConversationTypeDirect), messageType: string(models.MessageTypeImage), media: encryptedImage, wantError: "metadata does not match"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateMediaMessagePolicy(tt.conversationType, tt.messageType, tt.media, tt.requested)
			if tt.wantError == "" {
				if err != nil {
					t.Fatalf("validateMediaMessagePolicy() error = %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantError) {
				t.Fatalf("validateMediaMessagePolicy() error = %v, want substring %q", err, tt.wantError)
			}
		})
	}
}
