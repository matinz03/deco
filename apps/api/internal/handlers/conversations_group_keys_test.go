package handlers

import (
	"testing"

	"github.com/matinz03/deco/internal/models"
)

func TestValidateCompleteGroupKeyCopies(t *testing.T) {
	members := []string{"alice", "bob"}
	tests := []struct {
		name    string
		copies  []groupKeyCopyInput
		wantErr bool
	}{
		{
			name: "one copy for every member",
			copies: []groupKeyCopyInput{
				{UserID: "alice", EncryptedKey: "key-a"},
				{UserID: "bob", EncryptedKey: "key-b"},
			},
		},
		{
			name:    "missing member",
			copies:  []groupKeyCopyInput{{UserID: "alice", EncryptedKey: "key-a"}},
			wantErr: true,
		},
		{
			name: "duplicate member",
			copies: []groupKeyCopyInput{
				{UserID: "alice", EncryptedKey: "key-a"},
				{UserID: "alice", EncryptedKey: "key-b"},
			},
			wantErr: true,
		},
		{
			name: "outsider",
			copies: []groupKeyCopyInput{
				{UserID: "alice", EncryptedKey: "key-a"},
				{UserID: "mallory", EncryptedKey: "key-m"},
			},
			wantErr: true,
		},
		{
			name: "empty encrypted key",
			copies: []groupKeyCopyInput{
				{UserID: "alice", EncryptedKey: "key-a"},
				{UserID: "bob", EncryptedKey: " "},
			},
			wantErr: true,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validateCompleteGroupKeyCopies(test.copies, members)
			if (err != nil) != test.wantErr {
				t.Fatalf("validateCompleteGroupKeyCopies() error = %v, wantErr %v", err, test.wantErr)
			}
		})
	}
}

func TestMessageUsesGroupKey(t *testing.T) {
	for _, messageType := range []models.MessageType{
		models.MessageTypeText,
		models.MessageTypeImage,
		models.MessageTypeVideo,
		models.MessageTypeAudio,
		models.MessageTypeFile,
		models.MessageTypeLocation,
		models.MessageTypeContact,
	} {
		if !messageUsesGroupKey(string(messageType)) {
			t.Errorf("messageUsesGroupKey(%q) = false, want true", messageType)
		}
	}

	for _, messageType := range []models.MessageType{
		models.MessageTypeSticker,
		models.MessageTypePoll,
		models.MessageTypeSystem,
	} {
		if messageUsesGroupKey(string(messageType)) {
			t.Errorf("messageUsesGroupKey(%q) = true, want false", messageType)
		}
	}
}
