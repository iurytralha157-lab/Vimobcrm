package pushconfig

import (
	"bytes"
	"crypto/ecdh"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
)

const (
	vapidPublicKeyBytes  = 65
	vapidPrivateKeyBytes = 32
)

func ValidateVAPIDKeyPair(publicKey string, privateKey string) error {
	publicBytes, err := decodeVAPIDKey(publicKey)
	if err != nil {
		return fmt.Errorf("invalid VAPID public key: %w", err)
	}
	if len(publicBytes) != vapidPublicKeyBytes || publicBytes[0] != 0x04 {
		return fmt.Errorf("invalid VAPID public key: expected %d-byte uncompressed P-256 key", vapidPublicKeyBytes)
	}

	privateBytes, err := decodeVAPIDKey(privateKey)
	if err != nil {
		return fmt.Errorf("invalid VAPID private key: %w", err)
	}
	if len(privateBytes) != vapidPrivateKeyBytes {
		return fmt.Errorf("invalid VAPID private key: expected %d bytes", vapidPrivateKeyBytes)
	}

	private, err := ecdh.P256().NewPrivateKey(privateBytes)
	if err != nil {
		return fmt.Errorf("invalid VAPID private key: %w", err)
	}
	if !bytes.Equal(private.PublicKey().Bytes(), publicBytes) {
		return errors.New("VAPID public and private keys do not form a pair")
	}
	return nil
}

func Fingerprint(publicKey string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(publicKey)))
	return hex.EncodeToString(sum[:])
}

func decodeVAPIDKey(value string) ([]byte, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, errors.New("key is empty")
	}
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(value, "="))
	if err != nil {
		return nil, err
	}
	return decoded, nil
}
