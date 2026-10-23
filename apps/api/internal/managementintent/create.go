// Package managementintent deduplicates management creation attempts inside the
// caller's transaction. It stores hashes and entity IDs, never request payloads.
package managementintent

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
)

var (
	ErrInvalidKey        = errors.New("invalid management creation key")
	ErrConflict          = errors.New("management creation key was reused with another request")
	ErrResultUnavailable = errors.New("management creation result is no longer available")
)

type Reservation struct {
	OrganizationID string
	UserID         string
	EntityType     string
	KeyHash        string
	RequestHash    string
	EntityID       string
}

// ValidKey accepts the canonical UUID format generated once per frontend attempt.
func ValidKey(key string) bool {
	normalized, ok := pgvalue.NormalizeUUID(key)
	return ok && strings.EqualFold(strings.TrimSpace(key), normalized)
}

func Lookup(ctx context.Context, tx pgx.Tx, organizationID, userID, entityType, key string, canonicalRequest []byte) (Reservation, error) {
	organizationID, orgOK := pgvalue.NormalizeUUID(organizationID)
	userID, userOK := pgvalue.NormalizeUUID(userID)
	if !orgOK || !userOK || !ValidKey(key) || (entityType != "team" && entityType != "round_robin") || len(canonicalRequest) == 0 {
		return Reservation{}, ErrInvalidKey
	}
	keyDigest := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(key))))
	requestDigest := sha256.Sum256(canonicalRequest)
	reservation := Reservation{
		OrganizationID: organizationID, UserID: userID, EntityType: entityType,
		KeyHash: hex.EncodeToString(keyDigest[:]), RequestHash: hex.EncodeToString(requestDigest[:]),
	}
	// Acquire before entity locks. Two replicas handling the same attempt cannot
	// both create an entity, even when the first HTTP response is lost.
	lockScope := strings.Join([]string{"management-create", organizationID, userID, entityType, reservation.KeyHash}, ":")
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockScope); err != nil {
		return Reservation{}, err
	}
	var recordedHash string
	err := tx.QueryRow(ctx, `
		select request_hash, entity_id::text
		from private.crm_management_create_requests
		where organization_id = $1::uuid and user_id = $2::uuid
		  and entity_type = $3 and key_hash = $4
	`, organizationID, userID, entityType, reservation.KeyHash).Scan(&recordedHash, &reservation.EntityID)
	if errors.Is(err, pgx.ErrNoRows) {
		return reservation, nil
	}
	if err != nil {
		return Reservation{}, err
	}
	if recordedHash != reservation.RequestHash {
		return Reservation{}, ErrConflict
	}
	return reservation, nil
}

// Record must run in the transaction that inserted the entity. There is no TTL:
// an old retry must not recreate a deleted team or queue.
func Record(ctx context.Context, tx pgx.Tx, reservation Reservation, entityID string) error {
	entityID, ok := pgvalue.NormalizeUUID(entityID)
	if !ok || reservation.EntityID != "" || len(reservation.KeyHash) != 64 || len(reservation.RequestHash) != 64 {
		return fmt.Errorf("%w: invalid reservation", ErrInvalidKey)
	}
	_, err := tx.Exec(ctx, `
		insert into private.crm_management_create_requests
		  (organization_id, user_id, entity_type, key_hash, request_hash, entity_id)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
	`, reservation.OrganizationID, reservation.UserID, reservation.EntityType, reservation.KeyHash, reservation.RequestHash, entityID)
	return err
}
