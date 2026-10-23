package pipelines

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type DeletePipelineRequest struct {
	ExpectedRevision string `json:"expectedRevision"`
}

type deletePipelineInput struct {
	ExpectedRevision string
}

func (request DeletePipelineRequest) Validate() (deletePipelineInput, error) {
	if err := validatePipelineRevision(request.ExpectedRevision); err != nil {
		return deletePipelineInput{}, err
	}
	return deletePipelineInput{ExpectedRevision: request.ExpectedRevision}, nil
}

func validatePipelineRevision(value string) error {
	if value == "" {
		return ErrPipelineChanged
	}
	if len(value) != 64 {
		return fmt.Errorf("%w: expectedRevision must be the exact pipeline revision returned by the API", ErrInvalidInput)
	}
	for _, character := range value {
		if !(character >= '0' && character <= '9') && !(character >= 'a' && character <= 'f') {
			return fmt.Errorf("%w: expectedRevision must be a lowercase SHA256 revision", ErrInvalidInput)
		}
	}
	return nil
}

// A single statement snapshot includes parent metadata and every child stage,
// including archived stages. Epoch strings avoid session-timezone dependence or
// JavaScript timestamp rounding; JSONB gives deterministic key and stage ordering.
const pipelineRevisionPayloadSQL = `jsonb_build_array(
 (to_jsonb(p) - 'created_at' - 'updated_at' - 'pool_enabled_at') || jsonb_build_object(
   'created_at', extract(epoch from p.created_at)::text,
   'updated_at', extract(epoch from p.updated_at)::text,
   'pool_enabled_at', extract(epoch from (to_jsonb(p)->>'pool_enabled_at')::timestamptz)::text),
 coalesce((select jsonb_agg(
   (to_jsonb(revision_stage) - 'created_at' - 'updated_at') || jsonb_build_object(
     'created_at', extract(epoch from revision_stage.created_at)::text,
     'updated_at', extract(epoch from revision_stage.updated_at)::text)
   order by revision_stage.id)
   from public.stages revision_stage
   where revision_stage.organization_id = p.organization_id
     and revision_stage.pipeline_id = p.id), '[]'::jsonb)
)::text`

func pipelineRevision(payload string) string {
	digest := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(digest[:])
}

// Call only after organization and parent locks. Some automation writers lock
// only their source stage before checking a target-stage FK. NO KEY UPDATE
// blocks content writers/deletes while allowing those FK KEY SHARE checks, so
// acquiring all children cannot invert source->target locks. Delete proceeds
// only after every child has been acquired and its revision was checked.
func lockPipelineRevision(ctx context.Context, tx pgx.Tx, organizationID, pipelineID, expected string) error {
	rows, err := tx.Query(ctx, `select id from public.stages
 where organization_id=$1::uuid and pipeline_id=$2::uuid order by id for no key update`, organizationID, pipelineID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	var payload string
	if err := tx.QueryRow(ctx, `select `+pipelineRevisionPayloadSQL+`
 from public.pipelines p where p.organization_id=$1::uuid and p.id=$2::uuid`, organizationID, pipelineID).Scan(&payload); err != nil {
		return err
	}
	if pipelineRevision(payload) != expected {
		return ErrPipelineChanged
	}
	return nil
}
