package leads

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type LeadAttachmentListFilter struct {
	LeadID       string
	MetadataOnly bool
}

func ParseLeadAttachmentListFilter(values url.Values) (LeadAttachmentListFilter, error) {
	leadID, ok := normalizeUUID(values.Get("leadId"))
	if !ok {
		return LeadAttachmentListFilter{}, ErrInvalidInput
	}
	filter := LeadAttachmentListFilter{LeadID: leadID}
	if values.Has("metadataOnly") {
		metadataOnly, err := strconv.ParseBool(values.Get("metadataOnly"))
		if err != nil {
			return LeadAttachmentListFilter{}, fmt.Errorf("%w: metadataOnly is invalid", ErrInvalidInput)
		}
		filter.MetadataOnly = metadataOnly
	}
	return filter, nil
}

// Metadata listing must not mint access URLs or perform a Storage request for
// every document. The default remains signed for existing callers.
func prepareLeadAttachmentList(attachments []LeadAttachment, metadataOnly bool, sign func(*LeadAttachment)) {
	for index := range attachments {
		if metadataOnly {
			attachments[index].FileURL = ""
			attachments[index].Availability = "not_requested"
			continue
		}
		sign(&attachments[index])
	}
}

func (repo Repository) GetLeadAttachmentAccess(ctx context.Context, actor tenant.Context, leadID, attachmentID string) (LeadAttachment, error) {
	var ok bool
	if leadID, ok = normalizeUUID(leadID); !ok {
		return LeadAttachment{}, ErrInvalidInput
	}
	if attachmentID, ok = normalizeUUID(attachmentID); !ok {
		return LeadAttachment{}, ErrInvalidInput
	}
	columns, err := repo.getLeadAttachmentColumns(ctx)
	if err != nil {
		return LeadAttachment{}, err
	}
	attachment, err := loadLeadAttachmentAccess(ctx, repo.db.Pool(), actor, leadID, attachmentID, columns)
	if err != nil {
		return LeadAttachment{}, err
	}
	// The signer reauthorizes the current lead and the immutable document or
	// message origin before and after signing; failed reauthorization hides it.
	repo.signLeadAttachmentURL(ctx, actor, &attachment)
	return attachment, nil
}

func loadLeadAttachmentAccess(ctx context.Context, q attachmentQueryer, actor tenant.Context, leadID, attachmentID string, columns leadAttachmentColumns) (LeadAttachment, error) {
	where := []string{
		"l.organization_id = $1::uuid",
		"la.lead_id = $5::uuid",
		"la.id = $6::uuid",
		leadVisibilitySQL("$2", "$3", "$4", actor.HasPermission(permissions.LeadViewOwn)),
	}
	if columns.OrganizationID {
		where = append(where, "la.organization_id = $1::uuid")
	}
	attachment, err := scanLeadAttachment(q.QueryRow(ctx, `
		select `+leadAttachmentSelectFields(columns)+`
		from public.lead_attachments la
		join public.leads l on l.id = la.lead_id
		where `+strings.Join(where, " and "), actor.OrganizationID, canViewAllLeads(actor), actor.UserID,
		actor.HasPermission(permissions.LeadViewTeam), leadID, attachmentID))
	if errors.Is(err, ErrInvalidReference) {
		return LeadAttachment{}, ErrLeadNotFound
	}
	return attachment, err
}
