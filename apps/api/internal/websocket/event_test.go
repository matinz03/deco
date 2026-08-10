package websocket

import (
	"encoding/json"
	"testing"
)

func TestEventJSONSerialization(t *testing.T) {
	payloadData := map[string]string{"conversation_id": "conv_123", "text": "hello"}
	rawPayload, _ := json.Marshal(payloadData)

	event := Event{
		Type:    EventMessage,
		Payload: rawPayload,
	}

	data, err := json.Marshal(event)
	if err != nil {
		t.Fatalf("failed to marshal event: %v", err)
	}

	var decoded Event
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("failed to unmarshal event: %v", err)
	}

	if decoded.Type != EventMessage {
		t.Errorf("expected event type %s, got %s", EventMessage, decoded.Type)
	}

	var decodedPayload map[string]string
	if err := json.Unmarshal(decoded.Payload, &decodedPayload); err != nil {
		t.Fatalf("failed to unmarshal payload: %v", err)
	}

	if decodedPayload["conversation_id"] != "conv_123" {
		t.Errorf("expected conversation_id conv_123, got %s", decodedPayload["conversation_id"])
	}
}

func TestEventConstants(t *testing.T) {
	events := map[EventType]string{
		EventMessage:         "message.new",
		EventMessageEdited:   "message.edited",
		EventMessageDeleted:  "message.deleted",
		EventMessageReaction: "message.reaction",
		EventTyping:          "typing",
		EventPresence:        "presence",
		EventRead:            "message.read",
	}

	for evt, expectedStr := range events {
		if string(evt) != expectedStr {
			t.Errorf("expected EventType string %s, got %s", expectedStr, string(evt))
		}
	}
}
