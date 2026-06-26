package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	storage storageClient
}

type scanner interface {
	Scan(dest ...any) error
}

type propertySnapshot struct {
	ID           string
	CreatorID    string
	PropertyType string
	Title        string
	Code         string
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (ListResponse, error) {
	args := []any{tenantContext.OrganizationID}
	where := []string{"p.organization_id = $1::uuid"}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.Search != "" {
		args = append(args, "%"+filter.Search+"%")
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			p.code ilike $%d
			or p.title ilike $%d
			or p.bairro ilike $%d
			or p.cidade ilike $%d
			or p.uf ilike $%d
			or p.tipo ilike $%d
			or p.finalidade ilike $%d
			or p.external_id ilike $%d
		)`, index, index, index, index, index, index, index, index))
	}
	dealType := normalizedDealTypeForFilter(filter.DealType)
	if filter.DealType != "" {
		addFilter("p.finalidade = $%d", dealType)
	}
	if filter.PropertyType != "" {
		addFilter("p.tipo = $%d", filter.PropertyType)
	}
	if filter.City != "" {
		addFilter("p.cidade ilike $%d", "%"+filter.City+"%")
	}
	if filter.Neighborhood != "" {
		addFilter("p.bairro ilike $%d", "%"+filter.Neighborhood+"%")
	}
	if filter.ResponsibleID != "" {
		args = append(args, filter.ResponsibleID)
		index := len(args)
		where = append(where, fmt.Sprintf("(p.responsible_user_id = $%d::uuid or p.created_by = $%d::uuid)", index, index))
	}
	if filter.BedroomsMin > 0 {
		addFilter("p.quartos >= $%d::integer", filter.BedroomsMin)
	}
	if filter.SuitesMin > 0 {
		addFilter("p.suites >= $%d::integer", filter.SuitesMin)
	}
	if filter.BathroomsMin > 0 {
		addFilter("p.banheiros >= $%d::integer", filter.BathroomsMin)
	}
	if filter.PriceMin > 0 {
		if dealType == "locacao" || dealType == "temporada" {
			addFilter("p.valor_locacao >= $%d::numeric", filter.PriceMin)
		} else if dealType == "venda" {
			addFilter("p.preco >= $%d::numeric", filter.PriceMin)
		} else {
			args = append(args, filter.PriceMin)
			index := len(args)
			where = append(where, fmt.Sprintf("(p.preco >= $%d::numeric or p.valor_locacao >= $%d::numeric)", index, index))
		}
	}
	if filter.PriceMax > 0 {
		if dealType == "locacao" || dealType == "temporada" {
			addFilter("p.valor_locacao <= $%d::numeric", filter.PriceMax)
		} else if dealType == "venda" {
			addFilter("p.preco <= $%d::numeric", filter.PriceMax)
		} else {
			args = append(args, filter.PriceMax)
			index := len(args)
			where = append(where, fmt.Sprintf("(p.preco <= $%d::numeric or p.valor_locacao <= $%d::numeric)", index, index))
		}
	}

	args = append(args, filter.Limit, filter.Offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			count(*) over() as total_count,
			to_jsonb(p)::text
		from public.properties p
		where `+strings.Join(where, " and ")+`
		order by p.created_at desc, p.id desc
		limit $`+fmt.Sprint(limitIndex)+`
		offset $`+fmt.Sprint(offsetIndex),
		args...,
	)
	if err != nil {
		return ListResponse{}, err
	}
	defer rows.Close()

	properties := make([]Property, 0, filter.Limit)
	var total int64
	for rows.Next() {
		property, rowTotal, err := scanPropertyWithTotal(rows)
		if err != nil {
			return ListResponse{}, err
		}
		total = rowTotal
		properties = append(properties, property)
	}
	if err := rows.Err(); err != nil {
		return ListResponse{}, err
	}

	return ListResponse{
		Data:   properties,
		Total:  total,
		Limit:  filter.Limit,
		Offset: filter.Offset,
	}, nil
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, propertyID string) (Property, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}

	property, err := scanProperty(repo.db.Pool().QueryRow(ctx, `
		select to_jsonb(p)::text
		from public.properties p
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, propertyID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	return property, err
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input propertyRequest) (Property, error) {
	if !canManageProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if input["created_by"] == nil {
		input["created_by"] = tenantContext.UserID
	}
	if input["responsible_user_id"] == nil {
		input["responsible_user_id"] = tenantContext.UserID
	}

	propertyType, _ := input["tipo"].(string)
	code, err := repo.generatePropertyCode(ctx, tx, tenantContext.OrganizationID, propertyType)
	if err != nil {
		return nil, err
	}

	columns, placeholders, args := mutationParts(input, 3)
	columns = append([]string{"organization_id", "code"}, columns...)
	placeholders = append([]string{"$1::uuid", "$2"}, placeholders...)
	args = append([]any{tenantContext.OrganizationID, code}, args...)

	var property Property
	err = tx.QueryRow(ctx, `
		insert into public.properties (`+strings.Join(columns, ", ")+`)
		values (`+strings.Join(placeholders, ", ")+`)
		returning to_jsonb(properties)::text
	`, args...).Scan((*jsonTextProperty)(&property))
	if err != nil {
		return nil, err
	}
	property = normalizePropertyOutput(property)

	if err := repo.insertPropertyCreatedActivity(ctx, tx, tenantContext, property); err != nil {
		slog.Warn("property activity insert skipped", "error", err)
	}

	if err := repo.removeDemoProperties(ctx, tx, tenantContext.OrganizationID); err != nil {
		slog.Warn("demo property cleanup skipped", "error", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return property, nil
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, propertyID string, input propertyRequest) (Property, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	if !canEditProperty(tenantContext, current.CreatorID) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	if nextType, ok := input["tipo"].(string); ok && strings.TrimSpace(nextType) != "" && nextType != current.PropertyType {
		code, err := repo.generatePropertyCode(ctx, tx, tenantContext.OrganizationID, nextType)
		if err != nil {
			return nil, err
		}
		input["code"] = code
	}

	assignments, args := updateParts(input, 3)
	if len(assignments) == 0 {
		return nil, ErrNoChanges
	}
	assignments = append(assignments, "updated_at = now()")
	args = append([]any{tenantContext.OrganizationID, propertyID}, args...)

	var property Property
	err = tx.QueryRow(ctx, `
		update public.properties
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning to_jsonb(properties)::text
	`, args...).Scan((*jsonTextProperty)(&property))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	if err != nil {
		return nil, err
	}
	property = normalizePropertyOutput(property)

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return property, nil
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, propertyID string) error {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return ErrPropertyNotFound
	}
	if !canDeleteProperties(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPropertyNotFound
	}

	return nil
}

func (repo Repository) getSnapshotForUpdate(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string) (propertySnapshot, error) {
	var snapshot propertySnapshot
	var creatorID, propertyType, title, code pgtype.Text
	err := tx.QueryRow(ctx, `
		select
			id::text,
			coalesce(responsible_user_id::text, created_by::text, ''),
			tipo,
			title,
			code
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, propertyID).Scan(&snapshot.ID, &creatorID, &propertyType, &title, &code)
	if errors.Is(err, pgx.ErrNoRows) {
		return propertySnapshot{}, ErrPropertyNotFound
	}
	if err != nil {
		return propertySnapshot{}, err
	}

	snapshot.CreatorID = textValue(creatorID)
	snapshot.PropertyType = textValue(propertyType)
	snapshot.Title = textValue(title)
	snapshot.Code = textValue(code)
	return snapshot, nil
}

func (repo Repository) generatePropertyCode(ctx context.Context, tx pgx.Tx, organizationID string, propertyType string) (string, error) {
	prefix := propertyPrefix(propertyType)
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtext($1), hashtext($2))
	`, organizationID, prefix); err != nil {
		return "", err
	}

	usesPrefixSequence, err := repo.propertySequenceUsesPrefix(ctx, tx)
	if err != nil {
		return "", err
	}
	if !usesPrefixSequence {
		return repo.generateLegacyPropertyCode(ctx, tx, organizationID, prefix)
	}

	var nextNumber int64
	var sequenceID string
	var currentNumber pgtype.Int8
	err = tx.QueryRow(ctx, `
		select id::text, last_number
		from public.property_sequences
		where organization_id = $1::uuid
		  and prefix = $2
		for update
	`, organizationID, prefix).Scan(&sequenceID, &currentNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		nextNumber = 1
		_, err = tx.Exec(ctx, `
			insert into public.property_sequences (organization_id, prefix, last_number)
			values ($1::uuid, $2, $3)
		`, organizationID, prefix, nextNumber)
		if err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		nextNumber = 1
		if currentNumber.Valid {
			nextNumber = currentNumber.Int64 + 1
		}
		_, err = tx.Exec(ctx, `
			update public.property_sequences
			set last_number = $1
			where id = $2::uuid
		`, nextNumber, sequenceID)
		if err != nil {
			return "", err
		}
	}

	return fmt.Sprintf("%s%04d", prefix, nextNumber), nil
}

func (repo Repository) propertySequenceUsesPrefix(ctx context.Context, tx pgx.Tx) (bool, error) {
	var usesPrefixSequence bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from information_schema.columns
			where table_schema = 'public'
			  and table_name = 'property_sequences'
			  and column_name = 'prefix'
		)
	`).Scan(&usesPrefixSequence)
	return usesPrefixSequence, err
}

func (repo Repository) generateLegacyPropertyCode(ctx context.Context, tx pgx.Tx, organizationID string, prefix string) (string, error) {
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtext($1), hashtext('property_sequences'))
	`, organizationID); err != nil {
		return "", err
	}

	var nextNumber pgtype.Int8
	err := tx.QueryRow(ctx, `
		select next_value
		from public.property_sequences
		where organization_id = $1::uuid
		for update
	`, organizationID).Scan(&nextNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		number := int64(1)
		_, err = tx.Exec(ctx, `
			insert into public.property_sequences (organization_id, next_value)
			values ($1::uuid, $2)
		`, organizationID, number+1)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%s%04d", prefix, number), nil
	}
	if err != nil {
		return "", err
	}

	number := int64(1)
	if nextNumber.Valid && nextNumber.Int64 > 0 {
		number = nextNumber.Int64
	}
	_, err = tx.Exec(ctx, `
		update public.property_sequences
		set next_value = $1,
		    updated_at = now()
		where organization_id = $2::uuid
	`, number+1, organizationID)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%s%04d", prefix, number), nil
}

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
		"title":           title,
		"property_id":     propertyID,
		"code":            code,
		"organization_id": tenantContext.OrganizationID,
		"message":         fmt.Sprintf(`Imovel "%s" (Cod: %s) foi captado`, title, code),
	}))
	return err
}

func (repo Repository) removeDemoProperties(ctx context.Context, tx pgx.Tx, organizationID string) error {
	_, err := tx.Exec(ctx, `
		delete from public.properties
		where organization_id = $1::uuid
		  and metadata ->> 'is_demo' = 'true'
	`, organizationID)
	return err
}

func mutationParts(input propertyRequest, firstPlaceholder int) ([]string, []string, []any) {
	keys := sortedMutationKeys(input)
	columns := make([]string, 0, len(keys))
	placeholders := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))

	for _, key := range keys {
		def := writableColumns[key]
		args = append(args, input[key])
		columns = append(columns, def.column)
		placeholders = append(placeholders, typedPlaceholder(firstPlaceholder+len(args)-1, def.kind))
	}

	return columns, placeholders, args
}

func updateParts(input propertyRequest, firstPlaceholder int) ([]string, []any) {
	keys := sortedMutationKeys(input)
	assignments := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))

	for _, key := range keys {
		def := writableColumns[key]
		args = append(args, input[key])
		placeholder := typedPlaceholder(firstPlaceholder+len(args)-1, def.kind)
		if def.column == "metadata" {
			assignments = append(assignments, fmt.Sprintf("%s = coalesce(%s, '{}'::jsonb) || %s", def.column, def.column, placeholder))
			continue
		}
		assignments = append(assignments, fmt.Sprintf("%s = %s", def.column, placeholder))
	}

	return assignments, args
}

func sortedMutationKeys(input propertyRequest) []string {
	keys := make([]string, 0, len(input))
	for key := range input {
		if _, ok := writableColumns[key]; ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

func typedPlaceholder(index int, kind fieldKind) string {
	placeholder := fmt.Sprintf("$%d", index)
	switch kind {
	case fieldBool:
		return placeholder + "::boolean"
	case fieldInt:
		return placeholder + "::integer"
	case fieldNumeric:
		return placeholder + "::numeric"
	case fieldUUID:
		return placeholder + "::uuid"
	case fieldDate:
		return placeholder + "::date"
	case fieldJSON:
		return placeholder + "::jsonb"
	case fieldTextArray:
		return placeholder + "::text[]"
	default:
		return placeholder
	}
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

	if _, ok := property["tipo_de_imovel"]; !ok {
		property["tipo_de_imovel"] = anyString(property["tipo"])
	}
	property["tipo_de_negocio"] = displayDealType(anyString(property["finalidade"]))
	property["status"] = displayPropertyStatus(anyString(property["status"]))
	property["destaque"] = anyBool(property["is_featured"])
	property["anunciar"] = anyBool(property["published_on_site"])
	property["public_address_visibility"] = anyString(property["address_visibility"])
	property["owner_media_source"] = anyString(property["origin_media"])
	property["arquivos"] = property["documents"]

	responsibleID := anyString(property["responsible_user_id"])
	if responsibleID == "" {
		responsibleID = anyString(property["created_by"])
	}
	property["cadastrado_por"] = responsibleID

	imageURLs := anyStringSlice(property["image_urls"])
	property["fotos"] = imageURLs
	if len(imageURLs) > 0 {
		property["imagem_principal"] = imageURLs[0]
	} else {
		property["imagem_principal"] = ""
	}

	metadata, _ := property["metadata"].(map[string]any)
	legacy, _ := metadata["legacy"].(map[string]any)
	for key, value := range legacy {
		if _, exists := property[key]; !exists {
			property[key] = value
		}
	}

	return property
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
	switch value {
	case "locacao":
		return "Aluguel"
	case "temporada":
		return "Temporada"
	case "venda_locacao":
		return "Venda e Aluguel"
	default:
		return "Venda"
	}
}

func displayPropertyStatus(value string) string {
	switch value {
	case "draft":
		return "draft"
	case "sold":
		return "vendido"
	case "rented":
		return "alugado"
	case "inactive":
		return "inativo"
	case "archived":
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

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func propertyPrefix(propertyType string) string {
	normalized := normalizeASCII(propertyType)
	switch normalized {
	case "casa", "sobrado", "condominio":
		return "CA"
	case "apartamento", "cobertura", "kitnet", "flat", "loft", "studio":
		return "AP"
	case "comercial", "sala comercial", "loja":
		return "CO"
	case "galpao":
		return "GA"
	case "terreno", "lote":
		return "TR"
	case "sitio", "chacara":
		return "SI"
	case "fazenda":
		return "FA"
	default:
		return "IM"
	}
}

func normalizeASCII(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"\u00e1", "a", "\u00e0", "a", "\u00e2", "a", "\u00e3", "a",
		"\u00e9", "e", "\u00ea", "e",
		"\u00ed", "i",
		"\u00f3", "o", "\u00f4", "o", "\u00f5", "o",
		"\u00fa", "u",
		"\u00e7", "c",
	)
	return replacer.Replace(value)
}

func canManageProperties(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("property_manage")
}

func canEditProperty(tenantContext tenant.Context, creatorID string) bool {
	return canManageProperties(tenantContext) ||
		(creatorID != "" && creatorID == tenantContext.UserID)
}

func canDeleteProperties(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission("property_delete")
}
