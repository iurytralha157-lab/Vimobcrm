package whatsapp

import (
	"strings"
	"testing"
)

func TestReactToMessageRequestSupportsRemovalAndRequiresIdempotencyKey(t *testing.T) {
	input, err := (ReactToMessageRequest{
		Emoji:            "",
		ClientReactionID: "reaction-client-1",
	}).Validate()
	if err != nil {
		t.Fatalf("Validate() removal error = %v", err)
	}
	if input.Emoji != "" || input.ClientReactionID != "reaction-client-1" {
		t.Fatalf("Validate() removal = %#v", input)
	}

	if _, err := (ReactToMessageRequest{Emoji: "👍"}).Validate(); err == nil {
		t.Fatal("Validate() accepted reaction without clientReactionId")
	}
	if _, err := (ReactToMessageRequest{
		Emoji:            strings.Repeat("👍", 65),
		ClientReactionID: "reaction-client-2",
	}).Validate(); err == nil {
		t.Fatal("Validate() accepted emoji above the database limit")
	}
}
