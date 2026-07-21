package pushconfig

import (
	"crypto/ecdh"
	"encoding/base64"
	"strings"
	"testing"
)

func TestValidateVAPIDKeyPair(t *testing.T) {
	privateBytes := make([]byte, 32)
	privateBytes[31] = 1
	private, err := ecdh.P256().NewPrivateKey(privateBytes)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	publicKey := base64.RawURLEncoding.EncodeToString(private.PublicKey().Bytes())
	privateKey := base64.RawURLEncoding.EncodeToString(private.Bytes())

	if err := ValidateVAPIDKeyPair(publicKey, privateKey); err != nil {
		t.Fatalf("expected valid VAPID pair, got %v", err)
	}

	otherPrivateBytes := make([]byte, 32)
	otherPrivateBytes[31] = 2
	other, err := ecdh.P256().NewPrivateKey(otherPrivateBytes)
	if err != nil {
		t.Fatalf("generate other key: %v", err)
	}
	if err := ValidateVAPIDKeyPair(
		base64.RawURLEncoding.EncodeToString(other.PublicKey().Bytes()),
		privateKey,
	); err == nil || !strings.Contains(err.Error(), "do not form a pair") {
		t.Fatalf("expected mismatched VAPID pair error, got %v", err)
	}
}

func TestFingerprintIsStableAndDoesNotExposeKey(t *testing.T) {
	const publicKey = "public-key"
	fingerprint := Fingerprint("  " + publicKey + "  ")
	if len(fingerprint) != 64 {
		t.Fatalf("expected SHA-256 fingerprint, got %q", fingerprint)
	}
	if strings.Contains(fingerprint, publicKey) {
		t.Fatalf("fingerprint must not expose the source key")
	}
}
