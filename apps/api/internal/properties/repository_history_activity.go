package properties

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) insertPropertyCreatedActivity(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, property Property) error {
	title, _ := property["title"].(string)
	code, _ := property["code"].(string)
	propertyID, _ := property["id"].(string)
	if propertyID == "" {
		return nil
	}
	if title == "" {
		title = "Imovel"
	}

	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return err
	}
	if !hasEventsTable {
		return nil
	}

	actorName := tenantContext.UserID
	if value, err := repo.getUserDisplayName(ctx, tx, tenantContext.UserID); err == nil && strings.TrimSpace(value) != "" {
		actorName = value
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	_, err := tx.Exec(ctx, `
		insert into public.events (
			organization_id,
			event_type,
			entity_type,
			entity_id,
			payload,
			status
		)
		values (
			$1::uuid,
			'property_created',
			'property',
			$2::uuid,
			$3::jsonb,
			'processed'
		)
	`, tenantContext.OrganizationID, propertyID, jsonb(map[string]any{
		"user_id":         tenantContext.UserID,
		"user_name":       actorName,
		"title":           title,
		"property_id":     propertyID,
		"code":            code,
		"organization_id": tenantContext.OrganizationID,
		"message":         fmt.Sprintf(`Imovel "%s" (Cod: %s) cadastrado`, title, code),
	}))
	return err
}

func (repo Repository) insertPropertyUpdatedActivity(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current propertySnapshot, input propertyRequest, property Property) error {
	propertyID, _ := property["id"].(string)
	if propertyID == "" {
		propertyID = current.ID
	}
	if propertyID == "" {
		return nil
	}

	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return err
	}
	if !hasEventsTable {
		return nil
	}

	title := current.Title
	if value, _ := property["title"].(string); strings.TrimSpace(value) != "" {
		title = value
	}
	if title == "" {
		title = "Imovel"
	}

	changes := map[string]any{}
	eventType := "property_updated"
	message := fmt.Sprintf(`Imovel "%s" atualizado`, title)
	updatedFields := propertyHistoryUpdatedFields(input)
	if len(updatedFields) > 0 {
		message = fmt.Sprintf(`Imovel "%s" editado: %s`, title, strings.Join(updatedFields, ", "))
	}

	previousStatus, _ := normalizePropertyStatus(current.Status)
	nextStatus, _ := normalizePropertyStatus(input["status"])
	if value, ok := input["status"].(string); ok && nextStatus != previousStatus {
		changes["status"] = map[string]any{
			"from": displayPropertyStatus(current.Status),
			"to":   displayPropertyStatus(value),
		}
		eventType = "property_status_changed"
		message = fmt.Sprintf(`Imovel "%s" alterado para %s`, title, displayPropertyStatus(value))
	}
	if value, ok := input["preco"]; ok && !samePropertyHistoryNumber(value, current.Price) {
		changes["preco"] = value
		if eventType == "property_updated" {
			eventType = "property_price_updated"
			message = fmt.Sprintf(`Valor de venda do imovel "%s" atualizado`, title)
		}
	}
	if value, ok := input["valor_locacao"]; ok && !samePropertyHistoryNumber(value, current.RentalPrice) {
		changes["valor_locacao"] = value
		if eventType == "property_updated" {
			eventType = "property_price_updated"
			message = fmt.Sprintf(`Valor de locacao do imovel "%s" atualizado`, title)
		}
	}
	if value, ok := input["published_on_site"]; ok && value != current.PublishedOnSite {
		changes["published_on_site"] = value
		if eventType == "property_updated" {
			eventType = "property_publication_changed"
			message = fmt.Sprintf(`Publicacao do imovel "%s" atualizada`, title)
		}
	}
	if value, ok := input["anunciar"]; ok && value != current.PublishedOnSite {
		changes["anunciar"] = value
		if eventType == "property_updated" {
			eventType = "property_publication_changed"
			message = fmt.Sprintf(`Publicacao do imovel "%s" atualizada`, title)
		}
	}
	if value, ok := input["metadata"]; ok {
		changes["metadata"] = value
	}
	if value, ok := input["portfolio_type"].(string); ok && value != current.PortfolioType {
		changes["portfolio_type"] = map[string]any{"from": current.PortfolioType, "to": value}
	}

	actorName := tenantContext.UserID
	if value, err := repo.getUserDisplayName(ctx, tx, tenantContext.UserID); err == nil && strings.TrimSpace(value) != "" {
		actorName = value
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	_, err := tx.Exec(ctx, `
		insert into public.events (
			organization_id,
			event_type,
			entity_type,
			entity_id,
			payload,
			status
		)
		values (
			$1::uuid,
			$2,
			'property',
			$3::uuid,
			$4::jsonb,
			'processed'
		)
	`, tenantContext.OrganizationID, eventType, propertyID, jsonb(map[string]any{
		"user_id":         tenantContext.UserID,
		"user_name":       actorName,
		"title":           title,
		"property_id":     propertyID,
		"code":            current.Code,
		"organization_id": tenantContext.OrganizationID,
		"message":         message,
		"changes":         changes,
		"updated_fields":  updatedFields,
	}))
	return err
}

func samePropertyHistoryNumber(value any, previous *float64) bool {
	if value == nil || previous == nil {
		return value == nil && previous == nil
	}
	number, ok := numericPropertyValue(value)
	return ok && number == *previous
}

func propertyHistoryUpdatedFields(input propertyRequest) []string {
	fields := make([]string, 0, len(input))
	for field := range input {
		if field == "updated_at" {
			continue
		}
		fields = append(fields, propertyHistoryFieldLabel(field))
	}
	sort.Strings(fields)
	return fields
}

func propertyHistoryFieldLabel(field string) string {
	labels := map[string]string{
		"aceita_financiamento":         "Financiamento",
		"aceita_permuta":               "Permuta",
		"anunciar":                     "Anuncio",
		"banheiros":                    "Banheiros",
		"bairro":                       "Bairro",
		"cadastrado_por":               "Captador",
		"cidade":                       "Cidade",
		"code":                         "Codigo",
		"commission_split_percent":     "Divisao de comissao",
		"condominio_id":                "Condominio",
		"created_by":                   "Criado por",
		"descricao":                    "Descricao",
		"destaque":                     "Destaque",
		"endereco":                     "Endereco",
		"finalidade":                   "Finalidade",
		"iptu":                         "IPTU",
		"metadata":                     "Dados adicionais",
		"mobiliado":                    "Mobilia",
		"partner_contact":              "Contato do parceiro",
		"partner_name":                 "Parceiro",
		"portfolio_type":               "Carteira",
		"preco":                        "Valor de venda",
		"published_on_site":            "Publicacao no site",
		"quartos":                      "Quartos",
		"responsible_user_id":          "Responsavel",
		"status":                       "Status",
		"suites":                       "Suites",
		"tipo":                         "Tipo",
		"tipo_de_imovel":               "Tipo de imovel",
		"tipo_de_negocio":              "Modalidade",
		"third_party_authorized_until": "Autorizacao de terceiros",
		"third_party_kind":             "Tipo de terceiro",
		"title":                        "Titulo",
		"valor_condominio":             "Condominio",
		"valor_locacao":                "Valor de locacao",
		"vagas":                        "Vagas",
	}
	if label, ok := labels[field]; ok {
		return label
	}
	return strings.ReplaceAll(field, "_", " ")
}

func (repo Repository) getUserDisplayName(ctx context.Context, tx pgx.Tx, userID string) (string, error) {
	var name, email pgtype.Text
	err := tx.QueryRow(ctx, `
		select name, email
		from public.users
		where id = $1::uuid
	`, userID).Scan(&name, &email)
	if err != nil {
		return "", err
	}

	if value := textValue(name); value != "" {
		return value, nil
	}
	if value := textValue(email); value != "" {
		return value, nil
	}

	return userID, nil
}
