package leads

import (
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Nil means this response did not load tags. A non-nil empty collection is
// authoritative and must survive JSON encoding as [] (not null/omitted).
type LeadTags = []LeadEnrichmentTag

const leadDetailTagsSQL = `
	(select coalesce(jsonb_agg(jsonb_build_object(
		'id', t.id::text, 'name', t.name, 'color', t.color
	) order by lt.created_at asc, t.id asc), '[]'::jsonb)
	from public.lead_tags lt
	join public.tags t on t.id = lt.tag_id
	where lt.organization_id = l.organization_id
	  and t.organization_id = l.organization_id
	  and lt.lead_id = l.id)`

// Append the Get-only column without changing scanLead's shared read contract
// for list/create/update/move/assignment responses.
type leadDetailTagsRow struct {
	row  pgx.Row
	tags *LeadTags
}

func (row leadDetailTagsRow) Scan(destinations ...any) error {
	var raw []byte
	if err := row.row.Scan(append(destinations, &raw)...); err != nil {
		return err
	}
	var tags LeadTags
	if err := json.Unmarshal(raw, &tags); err != nil {
		return fmt.Errorf("decode lead tags: %w", err)
	}
	if tags == nil {
		return fmt.Errorf("decode lead tags: canonical collection is null")
	}
	*row.tags = tags
	return nil
}
