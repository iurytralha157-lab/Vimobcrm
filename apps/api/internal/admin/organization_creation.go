package admin

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const superAdminOrganizationRetryWindow = 30 * time.Minute

type organizationAdminInvitation struct {
	ID             string
	Token          string
	OrganizationID string
	Email          string
	ExpiresAt      time.Time
	UsedAt         pgtype.Timestamptz
}

func (repo Repository) createOrganizationWithAdminInvitation(
	ctx context.Context,
	tenantContext tenant.Context,
	request CreateOrganizationRequest,
) (map[string]any, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	name := strings.TrimSpace(request.Name)
	adminName := strings.TrimSpace(request.AdminName)
	adminEmail, err := normalizeEmail(request.AdminEmail)
	if err != nil || name == "" || adminName == "" || len(name) > 180 || len(adminName) > 180 {
		return nil, ErrInvalidInput
	}
	canonicalDocument := ""
	if request.CNPJ != nil && strings.TrimSpace(*request.CNPJ) != "" {
		if !hasOnlyBrazilianTaxIDCharacters(strings.TrimSpace(*request.CNPJ)) {
			return nil, ErrInvalidInput
		}
		canonicalDocument = onlyDigitsAdmin(*request.CNPJ)
		if len(canonicalDocument) != 14 || !isValidCNPJ(canonicalDocument) {
			return nil, ErrInvalidInput
		}
	}

	var recipientUserID *string
	existingAccount := false
	if existingUserID, lookupErr := repo.userIDByEmail(ctx, adminEmail); lookupErr == nil {
		existingAccount = true
		recipientUserID = &existingUserID
	} else if !errors.Is(lookupErr, pgx.ErrNoRows) {
		return nil, lookupErr
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	// A browser retry after a lost response must recover the same organization
	// and invite rather than provision duplicate tenants. The lock also closes
	// the race between two simultaneous submissions with the same natural key.
	retryKey := strings.ToLower(strings.Join([]string{
		"superadmin-create-organization",
		tenantContext.UserID,
		name,
		adminEmail,
	}, ":"))
	if _, err := tx.Exec(ctx, `
		select pg_catalog.pg_advisory_xact_lock(
			pg_catalog.hashtextextended($1, 0)
		)
	`, retryKey); err != nil {
		return nil, err
	}
	if canonicalDocument != "" {
		if _, err := tx.Exec(ctx, `
			select pg_catalog.pg_advisory_xact_lock(
				pg_catalog.hashtextextended('public-signup-document:' || $1, 0)
			)
		`, canonicalDocument); err != nil {
			return nil, err
		}
	}

	invitation, recovered, err := findRecoverableOrganizationInvitation(
		ctx,
		tx,
		tenantContext.UserID,
		name,
		adminEmail,
	)
	if err != nil {
		return nil, err
	}

	if !recovered {
		if canonicalDocument != "" {
			var duplicateDocument bool
			if err := tx.QueryRow(ctx, `
				select exists (
					select 1 from public.organizations existing
					where regexp_replace(coalesce(existing.cnpj, ''), '[^0-9]', '', 'g') = $1
					   or regexp_replace(coalesce(existing.billing_tax_id, ''), '[^0-9]', '', 'g') = $1
				)
			`, canonicalDocument).Scan(&duplicateDocument); err != nil {
				return nil, err
			}
			if duplicateDocument {
				return nil, ErrInvalidInput
			}
		}
		err = tx.QueryRow(ctx, `
			insert into public.organizations (
				name,
				segment,
				whatsapp,
				telefone,
				cnpj,
				creci,
				plan_id,
				endereco,
				cidade,
				bairro,
				numero,
				complemento,
				created_by
			)
			values (
				$1,
				coalesce($2, 'imobiliario'),
				$3,
				$4,
				$5,
				$6,
				$7::uuid,
				$8,
				$9,
				$10,
				$11,
				$12,
				$13::uuid
			)
			returning id::text
		`, name, cleanString(request.Segment), cleanString(request.Whatsapp), cleanString(request.Phone),
			cleanString(request.CNPJ), cleanString(request.Creci), cleanString(request.PlanID),
			cleanString(request.Address), cleanString(request.City), cleanString(request.Neighborhood),
			cleanString(request.Number), cleanString(request.Complement), tenantContext.UserID,
		).Scan(&invitation.OrganizationID)
		if err != nil {
			return nil, err
		}

		invitation.Email = adminEmail
		invitation.Token, err = randomInvitationToken()
		if err != nil {
			return nil, err
		}
		tokenHash := invitationTokenHash(invitation.Token)
		err = tx.QueryRow(ctx, `
			insert into public.invitations (
				organization_id,
				email,
				role,
				created_by,
				expires_at,
				token,
				token_hash
			)
			values ($1::uuid, $2, 'admin', $3::uuid, now() + interval '7 days', $4, $5)
			returning id::text, expires_at
		`, invitation.OrganizationID, adminEmail, tenantContext.UserID, invitation.Token, tokenHash).Scan(
			&invitation.ID,
			&invitation.ExpiresAt,
		)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	organization, err := repo.getOrganizationByID(ctx, invitation.OrganizationID)
	if err != nil {
		return nil, err
	}
	invitationResult := map[string]any{
		"id":               invitation.ID,
		"email":            invitation.Email,
		"role":             "admin",
		"expires_at":       invitation.ExpiresAt.UTC().Format(time.RFC3339),
		"email_sent":       false,
		"existing_account": existingAccount,
		"accepted":         invitation.UsedAt.Valid,
	}

	if invitation.UsedAt.Valid {
		invitationResult["used_at"] = invitation.UsedAt.Time.UTC().Format(time.RFC3339)
		invitationResult["email_status"] = "invitation_accepted"
	} else if recovered {
		// A recovered browser request never rotates the existing pair
		// automatically. This preserves a link that Resend may already have
		// accepted while the original HTTP response was lost.
		invitationResult["email_status"] = "delivery_unknown"
		invitationResult["recoverable"] = true
	} else {
		tokenHash := invitationTokenHash(invitation.Token)
		delivery, sendErr := repo.sendInvitationEmail(ctx, invitationEmailInput{
			InvitationID:     invitation.ID,
			OrganizationID:   invitation.OrganizationID,
			UserID:           recipientUserID,
			Email:            adminEmail,
			RecipientName:    adminName,
			OrganizationName: name,
			Role:             "admin",
			InviteURL:        repo.invitationURL(invitation.Token),
			ExistingAccount:  existingAccount,
			IdempotencyKey:   invitationEmailIdempotencyKey(invitation.ID, tokenHash),
		})
		if sendErr != nil {
			// The organization and its pending invitation are intentionally kept.
			// A superadmin can use the normal resend action without rebuilding the
			// tenant or creating an Auth identity with a shared password.
			slog.Error(
				"organization created with recoverable admin invitation delivery failure",
				"organization_id", invitation.OrganizationID,
				"invitation_id", invitation.ID,
				"error", sendErr,
			)
			invitationResult["email_status"] = "delivery_failed"
			invitationResult["recoverable"] = true
		} else {
			invitationResult["email_sent"] = true
			invitationResult["email_status"] = delivery.Status
			invitationResult["email_provider_message_id"] = delivery.ProviderMessageID
		}
	}

	organization["admin_invitation"] = invitationResult
	organization["creation_recovered"] = recovered
	return organization, nil
}

func findRecoverableOrganizationInvitation(
	ctx context.Context,
	tx pgx.Tx,
	createdBy string,
	organizationName string,
	adminEmail string,
) (organizationAdminInvitation, bool, error) {
	var invitation organizationAdminInvitation
	err := tx.QueryRow(ctx, `
		select
			o.id::text,
			i.id::text,
			i.email,
			i.expires_at,
			i.used_at
		from public.organizations o
		join public.invitations i on i.organization_id = o.id
		where o.created_by = $1::uuid
		  and lower(btrim(o.name)) = lower(btrim($2))
		  and lower(btrim(i.email)) = lower(btrim($3))
		  and i.role = 'admin'
		  and o.created_at >= now() - ($4::bigint * interval '1 second')
		order by o.created_at desc, i.created_at desc
		limit 1
	`, createdBy, organizationName, adminEmail, int64(superAdminOrganizationRetryWindow/time.Second)).Scan(
		&invitation.OrganizationID,
		&invitation.ID,
		&invitation.Email,
		&invitation.ExpiresAt,
		&invitation.UsedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return organizationAdminInvitation{}, false, nil
	}
	if err != nil {
		return organizationAdminInvitation{}, false, err
	}
	return invitation, true, nil
}
