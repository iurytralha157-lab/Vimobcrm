package properties

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const propertyCreationLedgerKey = "_creation_idempotency"

var ErrPropertyCreationKeyConflict = errors.New("property creation key belongs to another request")
var ErrPropertyCreationResourceRemoved = errors.New("created property was removed")

// Old clients without a key retain their original non-idempotent contract. A
// keyed request is reserved in a privileged receipt in the same commit. Its
// tombstone survives deletion, so a delayed retry can never recreate the property.
func (repo Repository) CreateIdempotent(ctx context.Context, tenantContext tenant.Context, input propertyRequest, rawKey string) (Property, bool, error) {
	if rawKey == "" {
		property, err := repo.Create(ctx, tenantContext, input)
		return property, true, err
	}
	if !canCreateProperties(tenantContext) {
		return nil, false, tenant.ErrOrganizationAccessDenied
	}
	key, valid := normalizeUUID(rawKey)
	if !valid {
		return nil, false, fmt.Errorf("%w: Idempotency-Key must be a UUID", ErrInvalidInput)
	}
	actor, valid := normalizeUUID(tenantContext.UserID)
	if !valid {
		return nil, false, tenant.ErrOrganizationAccessDenied
	}
	keyHash := propertyCreationHash(key)
	fingerprint, err := propertyCreationFingerprint(input)
	if err != nil {
		return nil, false, err
	}
	copyInput := propertyRequest{}
	for field, value := range input {
		copyInput[field] = value
	}
	input = copyInput
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, "property-create:"+actor+":"+keyHash); err != nil {
		return nil, false, err
	}
	var existingJSON *string
	var existingPropertyID *string
	var existingFingerprint string
	var receiptState string
	err = tx.QueryRow(ctx, `
		select receipt.request_hash, receipt.state, p.id::text, to_jsonb(p)::text
		from public.property_creation_receipts receipt
		left join public.properties p on p.organization_id = receipt.organization_id and p.id = receipt.property_id
		where receipt.organization_id = $1::uuid and receipt.actor_id = $2::uuid and receipt.key_hash = $3
	`, tenantContext.OrganizationID, actor, keyHash).Scan(&existingFingerprint, &receiptState, &existingPropertyID, &existingJSON)
	if err == nil {
		if err := validatePropertyCreationReplay(existingFingerprint, fingerprint, receiptState, existingPropertyID != nil && existingJSON != nil); err != nil {
			return nil, false, err
		}
		var existing Property
		if err := json.Unmarshal([]byte(*existingJSON), &existing); err != nil {
			return nil, false, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, false, err
		}
		attachPropertyManagedTerms(existing)
		canManage := canManageProperties(tenantContext)
		return projectWorkspaceProperty(normalizePropertyOutput(existing), canManage, canManage), false, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return nil, false, err
	}
	metadata := propertyMetadataMap(input["metadata"])
	metadata[propertyCreationLedgerKey] = map[string]string{"actor_id": actor, "key_hash": keyHash, "request_hash": fingerprint}
	input["metadata"] = jsonb(metadata)
	property, err := repo.createPropertyTx(ctx, tx, tenantContext, input)
	if err != nil {
		return nil, false, err
	}
	// The migration also captures legacy metadata-ledger INSERTs. Ensure the
	// receipt explicitly here and verify it before committing either resource.
	if _, err := tx.Exec(ctx, `insert into public.property_creation_receipts
		(organization_id, actor_id, key_hash, request_hash, property_id, state)
		values ($1::uuid, $2::uuid, $3, $4, $5::uuid, 'created')
		on conflict (organization_id, actor_id, key_hash) do nothing`, tenantContext.OrganizationID, actor, keyHash, fingerprint, anyString(property["id"])); err != nil {
		return nil, false, err
	}
	var receiptPropertyID *string
	if err := tx.QueryRow(ctx, `select request_hash, state, property_id::text from public.property_creation_receipts
		where organization_id = $1::uuid and actor_id = $2::uuid and key_hash = $3`, tenantContext.OrganizationID, actor, keyHash).Scan(&existingFingerprint, &receiptState, &receiptPropertyID); err != nil {
		return nil, false, err
	}
	if err := validatePropertyCreationReplay(existingFingerprint, fingerprint, receiptState, receiptPropertyID != nil); err != nil {
		return nil, false, err
	}
	if *receiptPropertyID != anyString(property["id"]) {
		return nil, false, ErrPropertyCreationKeyConflict
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, false, err
	}
	attachPropertyManagedTerms(property)
	canManage := canManageProperties(tenantContext)
	return projectWorkspaceProperty(property, canManage, canManage), true, nil
}

func validatePropertyCreationReplay(storedHash, requestHash, state string, resourceExists bool) error {
	if storedHash != requestHash {
		return ErrPropertyCreationKeyConflict
	}
	if state != "created" && state != "removed" || state == "removed" && resourceExists {
		return errors.New("property creation receipt state is invalid")
	}
	if state == "removed" || !resourceExists {
		return ErrPropertyCreationResourceRemoved
	}
	return nil
}

func propertyCreationHash(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func propertyCreationFingerprint(input propertyRequest) (string, error) {
	copyInput := propertyRequest{}
	for key, value := range input {
		copyInput[key] = value
	}
	metadata := propertyCreationMetadata(copyInput["metadata"])
	delete(metadata, propertyCreationLedgerKey)
	if len(metadata) > 0 {
		copyInput["metadata"] = metadata
	} else {
		delete(copyInput, "metadata")
	}
	encoded, err := json.Marshal(copyInput)
	if err != nil {
		return "", fmt.Errorf("%w: property request cannot be encoded", ErrInvalidInput)
	}
	return propertyCreationHash(string(encoded)), nil
}

func propertyCreationMetadata(value any) map[string]any {
	if encoded, ok := value.(string); ok {
		metadata := map[string]any{}
		decoder := json.NewDecoder(strings.NewReader(encoded))
		decoder.UseNumber()
		_ = decoder.Decode(&metadata)
		return metadata
	}
	return propertyMetadataMap(value)
}

func removeCreationLedgerFromInput(input propertyRequest) {
	if _, supplied := input["metadata"]; !supplied {
		return
	}
	metadata := propertyCreationMetadata(input["metadata"])
	delete(metadata, propertyCreationLedgerKey)
	input["metadata"] = jsonb(metadata)
}

func scrubCreationLedger(property Property) {
	if metadata := propertyMetadataMap(property["metadata"]); len(metadata) > 0 {
		delete(metadata, propertyCreationLedgerKey)
		property["metadata"] = metadata
	}
}
