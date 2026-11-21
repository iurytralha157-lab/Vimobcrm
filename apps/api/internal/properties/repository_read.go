package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, propertyID string) (Property, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}

	args := []any{tenantContext.OrganizationID, propertyID}
	where := []string{
		"p.organization_id = $1::uuid",
		"p.id = $2::uuid",
	}
	args, where = addScopedPropertyVisibility(args, where, tenantContext, "p", "")

	property, err := scanProperty(repo.db.Pool().QueryRow(ctx, `
		select (
			to_jsonb(p) || jsonb_build_object(
				'published_on_site', `+propertyPublishedOnSiteSQL("p", "site_publication")+`,
				'site_publication', `+propertySitePublicationMetadataSQL("site_publication")+`,
				'_property_edit_policy', coalesce(property_organization.property_edit_policy, 'responsible_or_admin'),
				'_property_owner_contact_visibility', coalesce(property_organization.property_owner_contact_visibility, 'hidden')
			)
		)::text
		from public.properties p
		join public.organizations property_organization
		  on property_organization.id = p.organization_id
		`+propertySitePublicationJoinSQL("p", "site_publication")+`
		where `+strings.Join(where, " and ")+`
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	if err != nil {
		return nil, err
	}

	authorization := propertyUpdateAuthorizationFromProperty(
		tenantContext,
		property,
		anyString(property["_property_edit_policy"]),
		anyString(property["_property_owner_contact_visibility"]),
	)
	property["can_edit"] = authorization.CanEdit
	attachPropertyManagedTerms(property)
	return projectWorkspaceProperty(property, canManageProperties(tenantContext), authorization.CanViewOwnerContacts), nil
}

type jsonTextProperty Property

func (property *jsonTextProperty) Scan(value any) error {
	var raw string
	switch typed := value.(type) {
	case string:
		raw = typed
	case []byte:
		raw = string(typed)
	default:
		return fmt.Errorf("cannot scan property json from %T", value)
	}

	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return err
	}
	*property = jsonTextProperty(out)
	return nil
}

func scanPropertyWithTotal(row scanner) (Property, int64, error) {
	var total int64
	property, err := scanPropertyFields(row, &total)
	return property, total, err
}

func scanProperty(row scanner) (Property, error) {
	return scanPropertyFields(row, nil)
}

func scanPropertyFields(row scanner, total *int64) (Property, error) {
	var property Property
	dest := []any{(*jsonTextProperty)(&property)}
	if total != nil {
		dest = append([]any{total}, dest...)
	}
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	return normalizePropertyOutput(property), nil
}

func normalizePropertyOutput(property Property) Property {
	if property == nil {
		return property
	}
	scrubCreationLedger(property)

	if strings.TrimSpace(anyString(property["tipo_de_imovel"])) == "" {
		property["tipo_de_imovel"] = anyString(property["tipo"])
	}
	dealType := anyString(property["finalidade"])
	if normalizedDealTypeForFilter(dealType) == "" {
		dealType = anyString(property["tipo_de_negocio"])
	}
	property["tipo_de_negocio"] = displayDealType(dealType)
	property["finalidade"] = property["finalidade_uso"]
	property["status"] = displayPropertyStatus(anyString(property["status"]))
	property["destaque"] = anyBool(property["is_featured"])
	property["anunciar"] = anyBool(property["published_on_site"])
	addressVisibility := anyString(property["address_visibility"])
	if strings.TrimSpace(addressVisibility) == "" {
		addressVisibility = anyString(property["public_address_visibility"])
	}
	property["public_address_visibility"] = NormalizePublicAddressVisibility(addressVisibility)
	if originMedia := anyString(property["origin_media"]); originMedia != "" {
		property["owner_media_source"] = originMedia
	}
	if documents := property["documents"]; documents != nil {
		property["arquivos"] = documents
	}

	// cadastrado_por is a legacy text column. Older rows may contain a user UUID,
	// an empty string, or an arbitrary label. Keep the compatibility alias typed:
	// prefer canonical UUID columns, accept only UUID-shaped legacy values, and
	// emit null when no trustworthy user reference exists.
	property["cadastrado_por"] = normalizedPropertyResponsibleReference(
		property["responsible_user_id"],
		property["created_by"],
		property["cadastrado_por"],
	)

	imageURLs := anyStringSlice(property["image_urls"])
	if len(imageURLs) == 0 {
		imageURLs = anyStringSlice(property["fotos"])
	}
	property["fotos"] = imageURLs
	if mainImage := anyString(property["imagem_principal"]); mainImage == "" {
		if len(imageURLs) > 0 {
			property["imagem_principal"] = imageURLs[0]
		} else {
			property["imagem_principal"] = ""
		}
	}

	metadata, ok := property["metadata"].(map[string]any)
	if !ok {
		metadata = map[string]any{}
		property["metadata"] = metadata
	}
	legacy, _ := metadata["legacy"].(map[string]any)
	for key, value := range legacy {
		if _, exists := property[key]; !exists {
			property[key] = value
		}
	}

	return property
}

func normalizedPropertyResponsibleReference(values ...any) any {
	for _, value := range values {
		if normalized, ok := normalizeUUID(anyString(value)); ok {
			return normalized
		}
	}
	return nil
}

func anyString(value any) string {
	text, _ := value.(string)
	return text
}

func anyBool(value any) bool {
	boolean, _ := value.(bool)
	return boolean
}

func anyStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return []string{}
	}
}

func displayDealType(value string) string {
	normalized, err := normalizeDealType(value)
	if err != nil {
		return "Venda"
	}
	switch normalized {
	case "locacao":
		return "Aluguel"
	case "lancamento":
		return "Lan\u00e7amento"
	case "temporada":
		return "Temporada"
	case "venda_locacao":
		return "Venda e Aluguel"
	default:
		return "Venda"
	}
}

func displayPropertyStatus(value string) string {
	switch normalizeASCII(value) {
	case "draft", "rascunho":
		return "rascunho"
	case "sold", "vendido":
		return "vendido"
	case "reserved", "reservado":
		return "reservado"
	case "rented", "alugado", "locado":
		return "alugado"
	case "inactive", "inativo":
		return "inativo"
	case "archived", "arquivado":
		return "arquivado"
	default:
		return "ativo"
	}
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}
