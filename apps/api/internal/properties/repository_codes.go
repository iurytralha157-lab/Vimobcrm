package properties

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

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

	maxExistingNumber, err := repo.maxPropertyCodeNumber(ctx, tx, organizationID, prefix)
	if err != nil {
		return "", err
	}

	var nextNumber int64
	var sequenceID string
	var currentNumber pgtype.Int8
	err = tx.QueryRow(ctx, `
		select id::text, last_number
		from public.property_sequences
		where organization_id = $1::uuid
		  and upper(btrim(prefix)) = upper(btrim($2))
		order by coalesce(last_number, 0) desc, created_at asc
		limit 1
		for update
	`, organizationID, prefix).Scan(&sequenceID, &currentNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		nextNumber = maxExistingNumber + 1
		err = tx.QueryRow(ctx, `
			insert into public.property_sequences (organization_id, prefix, last_number)
			values ($1::uuid, $2, $3)
			returning id::text
		`, organizationID, prefix, nextNumber).Scan(&sequenceID)
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
	}

	if nextNumber <= maxExistingNumber {
		nextNumber = maxExistingNumber + 1
	}

	for attempts := 0; attempts < 10_000; attempts++ {
		code := fmt.Sprintf("%s%04d", prefix, nextNumber)
		exists, err := repo.propertyCodeExists(ctx, tx, organizationID, code)
		if err != nil {
			return "", err
		}

		_, err = tx.Exec(ctx, `
			update public.property_sequences
			set last_number = $1
			where id = $2::uuid
		`, nextNumber, sequenceID)
		if err != nil {
			return "", err
		}

		if !exists {
			return code, nil
		}
		nextNumber++
	}

	return "", fmt.Errorf("%w: unable to generate a unique property code", ErrInvalidInput)
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
		number, err := repo.maxPropertyCodeNumber(ctx, tx, organizationID, prefix)
		if err != nil {
			return "", err
		}
		number++
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

	maxExistingNumber, err := repo.maxPropertyCodeNumber(ctx, tx, organizationID, prefix)
	if err != nil {
		return "", err
	}
	if number <= maxExistingNumber {
		number = maxExistingNumber + 1
	}

	for attempts := 0; attempts < 10_000; attempts++ {
		code := fmt.Sprintf("%s%04d", prefix, number)
		exists, err := repo.propertyCodeExists(ctx, tx, organizationID, code)
		if err != nil {
			return "", err
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

		if !exists {
			return code, nil
		}
		number++
	}

	return "", fmt.Errorf("%w: unable to generate a unique property code", ErrInvalidInput)
}

func (repo Repository) maxPropertyCodeNumber(ctx context.Context, tx pgx.Tx, organizationID string, prefix string) (int64, error) {
	var maxNumber pgtype.Int8
	err := tx.QueryRow(ctx, `
		select max((regexp_match(code, '^' || $2 || '([0-9]+)$'))[1]::bigint)
		from public.properties
		where organization_id = $1::uuid
		  and code ~ ('^' || $2 || '[0-9]+$')
	`, organizationID, prefix).Scan(&maxNumber)
	if err != nil {
		return 0, err
	}
	if !maxNumber.Valid || maxNumber.Int64 < 0 {
		return 0, nil
	}
	return maxNumber.Int64, nil
}

func (repo Repository) propertyCodeExists(ctx context.Context, tx pgx.Tx, organizationID string, code string) (bool, error) {
	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.properties
			where organization_id = $1::uuid
			  and lower(btrim(code)) = lower(btrim($2))
		)
	`, organizationID, code).Scan(&exists)
	return exists, err
}

func propertyPrefix(propertyType string) string {
	normalized := normalizeASCII(propertyType)
	switch normalized {
	case "casa", "sobrado", "condominio", "casa de condominio":
		return "CA"
	case "apartamento", "cobertura", "kitnet", "flat", "loft", "studio":
		return "AP"
	case "comercial", "sala comercial", "loja":
		return "CO"
	case "galpao":
		return "GA"
	case "terreno", "lote":
		return "TE"
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
		"\u00e1", "a", "\u00e0", "a", "\u00e2", "a", "\u00e3", "a", "\u00e4", "a",
		"\u00e9", "e", "\u00e8", "e", "\u00ea", "e", "\u00eb", "e",
		"\u00ed", "i", "\u00ec", "i", "\u00ee", "i", "\u00ef", "i",
		"\u00f3", "o", "\u00f2", "o", "\u00f4", "o", "\u00f5", "o", "\u00f6", "o",
		"\u00fa", "u", "\u00f9", "u", "\u00fb", "u", "\u00fc", "u",
		"\u00e7", "c",
	)
	return replacer.Replace(value)
}
