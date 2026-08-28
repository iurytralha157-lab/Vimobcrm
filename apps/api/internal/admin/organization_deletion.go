package admin

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	organizationStorageDeleteBatchSize       = 1000
	maxOrganizationAsaasCleanupResourceCount = 10002 // 10k payments + subscription + customer.
)

type organizationUserCleanup struct {
	ID string
}

type organizationStorageObject struct {
	Bucket string
	Name   string
}

type organizationAsaasCleanupClaim struct {
	Outcome           string `json:"outcome"`
	ClaimToken        string `json:"claim_token"`
	OrganizationID    string `json:"organization_id"`
	ResourceCount     int    `json:"resource_count"`
	RemainingCount    int    `json:"remaining_count"`
	BusyReason        string `json:"busy_reason"`
	Reason            string `json:"reason"`
	RetryAfterSeconds int    `json:"retry_after_seconds"`
}

type organizationAsaasCleanupResourceClaim struct {
	Outcome           string `json:"outcome"`
	ResourceKind      string `json:"resource_kind"`
	ResourceID        string `json:"resource_id"`
	AttemptToken      string `json:"attempt_token"`
	BusyReason        string `json:"busy_reason"`
	Reason            string `json:"reason"`
	RetryAfterSeconds int    `json:"retry_after_seconds"`
}

type organizationAsaasCleanupResourceAck struct {
	Outcome string `json:"outcome"`
	Reason  string `json:"reason"`
}

type organizationAsaasProviderDeleteResult struct {
	HTTPStatus      int
	ProviderPayload map[string]any
	Deleted         bool
	ID              string
}

type organizationAsaasCleanupFinalization struct {
	Outcome        string `json:"outcome"`
	OrganizationID string `json:"organization_id"`
}

type googleCalendarChannelCleanup struct {
	ID         string
	ResourceID string
}

type googleCalendarConnectionCleanup struct {
	ID          string
	AccessToken string
	Channels    []googleCalendarChannelCleanup
}

type whatsappSessionCleanup struct {
	ID           string
	InstanceName string
	InstanceID   string
	Status       string
	Settings     map[string]any
}

type organizationScopedTable struct {
	Schema string
	Name   string
}

type organizationForeignKeyNullifier struct {
	Table   organizationScopedTable
	Columns []string
}

func (table organizationScopedTable) key() string {
	return table.Schema + "." + table.Name
}

// DeleteOrganization performs a fail-closed tenant purge. The organization is
// disabled first, external connections and tenant-owned files are removed
// next, and the relational data is only deleted after those cleanup steps
// succeed. User identities and user-scoped assets are deliberately preserved:
// deleting an organization is not the same operation as deleting a person.
func (repo Repository) DeleteOrganization(
	ctx context.Context,
	tenantContext tenant.Context,
	organizationID string,
	request OrganizationDeleteRequest,
) (OrganizationDeleteResult, error) {
	if !tenantContext.IsSuperAdmin {
		return OrganizationDeleteResult{}, tenant.ErrOrganizationAccessDenied
	}

	organizationID, ok := normalizeUUID(organizationID)
	if !ok || strings.TrimSpace(request.ConfirmationName) == "" {
		return OrganizationDeleteResult{}, ErrInvalidInput
	}

	if err := repo.lockAndDisableOrganization(ctx, organizationID, request.ConfirmationName); err != nil {
		return OrganizationDeleteResult{}, err
	}

	if err := repo.cancelOrganizationAsaasBilling(ctx, organizationID); err != nil {
		return OrganizationDeleteResult{}, fmt.Errorf("%w: %v", ErrOrganizationExternalCleanup, err)
	}
	if err := repo.disconnectOrganizationGoogleCalendars(ctx, organizationID); err != nil {
		return OrganizationDeleteResult{}, fmt.Errorf("%w: %v", ErrOrganizationExternalCleanup, err)
	}
	if err := repo.deleteOrganizationEvolutionInstances(ctx, organizationID); err != nil {
		return OrganizationDeleteResult{}, fmt.Errorf("%w: %v", ErrOrganizationExternalCleanup, err)
	}
	if err := repo.deleteOrganizationStorage(ctx, organizationID); err != nil {
		return OrganizationDeleteResult{}, fmt.Errorf("%w: %v", ErrOrganizationExternalCleanup, err)
	}

	if err := repo.purgeOrganizationDatabase(ctx, organizationID); err != nil {
		return OrganizationDeleteResult{}, err
	}

	return OrganizationDeleteResult{
		OK:              true,
		DeletedUsers:    0,
		CleanupWarnings: []string{},
	}, nil
}

func (repo Repository) cancelOrganizationAsaasBilling(ctx context.Context, organizationID string) error {
	leaseID, err := randomUUIDString()
	if err != nil {
		return fmt.Errorf("create Asaas cleanup lease: %w", err)
	}
	leaseOwner := "go-admin:" + leaseID

	claim, err := repo.claimOrganizationAsaasCleanup(
		ctx,
		organizationID,
		leaseOwner,
	)
	if err != nil {
		return err
	}

	switch claim.Outcome {
	case "already_completed":
		if claim.OrganizationID != organizationID {
			return fmt.Errorf("Asaas cleanup claim organization mismatch")
		}
		return nil
	case "organization_not_found":
		return ErrNotFound
	case "organization_active":
		return fmt.Errorf("Asaas cleanup requires a disabled organization")
	case "busy":
		return fmt.Errorf(
			"Asaas cleanup is busy (%s); retry after %d seconds",
			firstNonEmpty(strings.TrimSpace(claim.BusyReason), "provider_operation"),
			claim.RetryAfterSeconds,
		)
	case "manual_review":
		return fmt.Errorf(
			"Asaas cleanup requires manual review (%s)",
			firstNonEmpty(strings.TrimSpace(claim.Reason), "provider_outcome_ambiguous"),
		)
	case "state_changed":
		return fmt.Errorf("Asaas cleanup state changed while acquiring the claim")
	case "invalid_request":
		return fmt.Errorf("Asaas cleanup claim was rejected")
	case "proceed", "recover_only":
		// Continue below with the immutable provider snapshot returned by the
		// database claim. Never re-read mutable billing identifiers here.
	default:
		return fmt.Errorf("unexpected Asaas cleanup claim outcome %q", claim.Outcome)
	}

	claimToken, ok := normalizeUUID(claim.ClaimToken)
	if !ok || claim.OrganizationID != organizationID {
		return fmt.Errorf("invalid Asaas cleanup claim binding")
	}
	if claim.ResourceCount < 0 ||
		claim.ResourceCount > maxOrganizationAsaasCleanupResourceCount ||
		claim.RemainingCount < 0 || claim.RemainingCount > claim.ResourceCount {
		return fmt.Errorf("invalid Asaas cleanup resource counts")
	}
	if claim.ResourceCount > 0 && (repo.asaasURL == "" || repo.asaasAPIKey == "") {
		return fmt.Errorf("Asaas cleanup is not configured")
	}

	seenResources := make(map[string]struct{}, claim.ResourceCount)
	lastResourceRank := -1
	for step := 0; step <= claim.ResourceCount; step++ {
		resourceClaim, err := repo.claimOrganizationAsaasCleanupResource(
			ctx,
			organizationID,
			claimToken,
			leaseOwner,
		)
		if err != nil {
			return err
		}

		switch resourceClaim.Outcome {
		case "complete":
			return repo.finalizeOrganizationAsaasCleanup(ctx, organizationID, claimToken)
		case "busy":
			return fmt.Errorf(
				"Asaas cleanup resource is busy (%s); retry after %d seconds",
				firstNonEmpty(strings.TrimSpace(resourceClaim.BusyReason), "provider_delete"),
				resourceClaim.RetryAfterSeconds,
			)
		case "manual_review":
			return fmt.Errorf(
				"Asaas cleanup resource requires manual review (%s)",
				firstNonEmpty(strings.TrimSpace(resourceClaim.Reason), "provider_outcome_ambiguous"),
			)
		case "claim_not_found", "lost_claim":
			return fmt.Errorf("Asaas cleanup resource claim was lost")
		case "invalid_request":
			return fmt.Errorf("Asaas cleanup resource claim was rejected")
		case "proceed":
			// Continue below. The resource marker is durable before any provider
			// DELETE, so a crash can never be mistaken for a confirmed removal.
		default:
			return fmt.Errorf(
				"unexpected Asaas cleanup resource outcome %q",
				resourceClaim.Outcome,
			)
		}

		resourceKind := strings.TrimSpace(resourceClaim.ResourceKind)
		resourceID, err := normalizeAsaasCleanupResourceID(resourceClaim.ResourceID)
		if err != nil || resourceID == "" {
			return fmt.Errorf("invalid Asaas cleanup resource identifier")
		}
		attemptToken, ok := normalizeUUID(resourceClaim.AttemptToken)
		if !ok {
			return fmt.Errorf("invalid Asaas cleanup resource attempt binding")
		}
		resourceRank, ok := asaasCleanupResourceRank(resourceKind)
		if !ok || resourceRank < lastResourceRank {
			return fmt.Errorf("invalid Asaas cleanup resource ordering")
		}
		resourceKey := resourceKind + ":" + resourceID
		if _, exists := seenResources[resourceKey]; exists {
			return fmt.Errorf("duplicate Asaas cleanup resource claim")
		}
		seenResources[resourceKey] = struct{}{}
		lastResourceRank = resourceRank

		providerResult, providerErr := repo.deleteAsaasResource(
			ctx,
			resourceKind,
			resourceID,
		)
		ack, ackErr := repo.ackOrganizationAsaasCleanupResource(
			ctx,
			organizationID,
			claimToken,
			resourceKind,
			resourceID,
			attemptToken,
			providerResult.HTTPStatus,
			providerResult.ProviderPayload,
		)
		if ackErr != nil {
			return ackErr
		}
		if providerErr != nil {
			return providerErr
		}
		if ack.Outcome != "succeeded" ||
			providerResult.HTTPStatus != http.StatusOK ||
			!providerResult.Deleted || providerResult.ID != resourceID {
			return fmt.Errorf(
				"Asaas cleanup resource was not authoritatively deleted (%s)",
				firstNonEmpty(strings.TrimSpace(ack.Reason), ack.Outcome),
			)
		}
	}

	return fmt.Errorf("Asaas cleanup resource claim exceeded its frozen bound")
}

func (repo Repository) claimOrganizationAsaasCleanup(
	ctx context.Context,
	organizationID string,
	leaseOwner string,
) (organizationAsaasCleanupClaim, error) {
	var claim organizationAsaasCleanupClaim
	err := repo.callOrganizationAsaasCleanupRPC(
		ctx,
		"claim_billing_organization_asaas_cleanup",
		map[string]any{
			"p_organization_id": organizationID,
			"p_lease_owner":     leaseOwner,
			"p_lease_seconds":   600,
		},
		&claim,
	)
	if err != nil {
		return organizationAsaasCleanupClaim{}, fmt.Errorf("claim Asaas cleanup: %w", err)
	}
	claim.Outcome = strings.TrimSpace(claim.Outcome)
	claim.OrganizationID = strings.TrimSpace(claim.OrganizationID)
	claim.ClaimToken = strings.TrimSpace(claim.ClaimToken)
	return claim, nil
}

func (repo Repository) claimOrganizationAsaasCleanupResource(
	ctx context.Context,
	organizationID string,
	claimToken string,
	leaseOwner string,
) (organizationAsaasCleanupResourceClaim, error) {
	var claim organizationAsaasCleanupResourceClaim
	err := repo.callOrganizationAsaasCleanupRPC(
		ctx,
		"claim_billing_organization_asaas_cleanup_resource",
		map[string]any{
			"p_organization_id": organizationID,
			"p_claim_token":     claimToken,
			"p_lease_owner":     leaseOwner,
			"p_lease_seconds":   600,
		},
		&claim,
	)
	if err != nil {
		return organizationAsaasCleanupResourceClaim{}, fmt.Errorf(
			"claim Asaas cleanup resource: %w",
			err,
		)
	}
	claim.Outcome = strings.TrimSpace(claim.Outcome)
	claim.ResourceKind = strings.TrimSpace(claim.ResourceKind)
	claim.ResourceID = strings.TrimSpace(claim.ResourceID)
	claim.AttemptToken = strings.TrimSpace(claim.AttemptToken)
	return claim, nil
}

func (repo Repository) ackOrganizationAsaasCleanupResource(
	ctx context.Context,
	organizationID string,
	claimToken string,
	resourceKind string,
	resourceID string,
	attemptToken string,
	httpStatus int,
	providerResponse map[string]any,
) (organizationAsaasCleanupResourceAck, error) {
	if providerResponse == nil {
		providerResponse = map[string]any{}
	}
	var result organizationAsaasCleanupResourceAck
	err := repo.callOrganizationAsaasCleanupRPC(
		ctx,
		"ack_billing_organization_asaas_cleanup_resource",
		map[string]any{
			"p_organization_id":   organizationID,
			"p_claim_token":       claimToken,
			"p_resource_kind":     resourceKind,
			"p_resource_id":       resourceID,
			"p_attempt_token":     attemptToken,
			"p_http_status":       httpStatus,
			"p_provider_response": providerResponse,
		},
		&result,
	)
	if err != nil {
		return organizationAsaasCleanupResourceAck{}, fmt.Errorf(
			"acknowledge Asaas cleanup resource: %w",
			err,
		)
	}
	result.Outcome = strings.TrimSpace(result.Outcome)
	result.Reason = strings.TrimSpace(result.Reason)
	return result, nil
}

func (repo Repository) finalizeOrganizationAsaasCleanup(
	ctx context.Context,
	organizationID string,
	claimToken string,
) error {
	var result organizationAsaasCleanupFinalization
	if err := repo.callOrganizationAsaasCleanupRPC(
		ctx,
		"finalize_billing_organization_asaas_cleanup",
		map[string]any{
			"p_organization_id": organizationID,
			"p_claim_token":     claimToken,
		},
		&result,
	); err != nil {
		return fmt.Errorf("finalize Asaas cleanup: %w", err)
	}

	result.Outcome = strings.TrimSpace(result.Outcome)
	switch result.Outcome {
	case "completed":
		if strings.TrimSpace(result.OrganizationID) != organizationID {
			return fmt.Errorf("Asaas cleanup finalization organization mismatch")
		}
		return nil
	case "already_completed":
		return nil
	case "claim_not_found":
		return fmt.Errorf("Asaas cleanup claim was not found during finalization")
	case "resources_pending":
		return fmt.Errorf("Asaas cleanup resources are still pending")
	case "manual_review":
		return fmt.Errorf("Asaas cleanup requires manual review before finalization")
	case "invalid_request":
		return fmt.Errorf("Asaas cleanup finalization was rejected")
	default:
		return fmt.Errorf("unexpected Asaas cleanup finalization outcome %q", result.Outcome)
	}
}

func (repo Repository) callOrganizationAsaasCleanupRPC(
	ctx context.Context,
	functionName string,
	payload any,
	target any,
) error {
	if repo.projectURL == "" || repo.apiKey == "" {
		return fmt.Errorf("Supabase service API is not configured")
	}

	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	endpoint := repo.projectURL + "/rest/v1/rpc/" + url.PathEscape(functionName)
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint,
		bytes.NewReader(encodedPayload),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	setSupabaseServiceAPIAuth(request, repo.apiKey)

	response, err := repo.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()

	const maxRPCResponseBytes = 64 * 1024
	responseBody, err := io.ReadAll(io.LimitReader(response.Body, maxRPCResponseBytes+1))
	if err != nil {
		return err
	}
	if len(responseBody) > maxRPCResponseBytes {
		return fmt.Errorf("Supabase cleanup RPC response is too large")
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Supabase cleanup RPC returned HTTP %d", response.StatusCode)
	}
	if err := json.Unmarshal(responseBody, target); err != nil {
		return fmt.Errorf("decode Supabase cleanup RPC response: %w", err)
	}
	return nil
}

func setSupabaseServiceAPIAuth(request *http.Request, apiKey string) {
	request.Header.Set("apikey", apiKey)
	request.Header.Del("Authorization")
	segments := strings.Split(apiKey, ".")
	if len(segments) == 3 && segments[0] != "" && segments[1] != "" && segments[2] != "" {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
}

func normalizeAsaasCleanupResourceID(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	if len(value) > 255 {
		return "", fmt.Errorf("identifier is too long")
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '_' || character == '-' {
			continue
		}
		return "", fmt.Errorf("identifier contains unsupported characters")
	}
	return value, nil
}

func asaasCleanupResourceRank(resourceKind string) (int, bool) {
	switch resourceKind {
	case "payment":
		return 0, true
	case "subscription":
		return 1, true
	case "customer":
		return 2, true
	default:
		return 0, false
	}
}

func (repo Repository) deleteAsaasResource(
	ctx context.Context,
	resourceKind string,
	resourceID string,
) (organizationAsaasProviderDeleteResult, error) {
	resourcePath := ""
	switch resourceKind {
	case "payment":
		resourcePath = "payments"
	case "subscription":
		resourcePath = "subscriptions"
	case "customer":
		resourcePath = "customers"
	default:
		return organizationAsaasProviderDeleteResult{}, fmt.Errorf(
			"unsupported Asaas cleanup resource kind",
		)
	}
	endpoint := repo.asaasURL + "/" + resourcePath + "/" + url.PathEscape(resourceID)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return organizationAsaasProviderDeleteResult{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "VimobCRM/1.0 (Go API)")
	request.Header.Set("access_token", repo.asaasAPIKey)
	response, err := repo.httpClient.Do(request)
	if err != nil {
		return organizationAsaasProviderDeleteResult{}, fmt.Errorf(
			"Asaas %s cleanup failed: %w",
			resourceKind,
			err,
		)
	}
	defer response.Body.Close()

	const maxAsaasDeleteResponseBytes = 16 * 1024
	responseBody, readErr := io.ReadAll(io.LimitReader(
		response.Body,
		maxAsaasDeleteResponseBytes+1,
	))
	result := organizationAsaasProviderDeleteResult{
		HTTPStatus:      response.StatusCode,
		ProviderPayload: map[string]any{},
	}
	if readErr != nil {
		return result, fmt.Errorf("read Asaas %s cleanup response: %w", resourceKind, readErr)
	}
	if len(responseBody) > maxAsaasDeleteResponseBytes {
		return result, fmt.Errorf("Asaas %s cleanup response is too large", resourceKind)
	}

	var providerResponse struct {
		Deleted bool   `json:"deleted"`
		ID      string `json:"id"`
	}
	if err := json.Unmarshal(responseBody, &providerResponse); err == nil {
		result.Deleted = providerResponse.Deleted
		result.ID = providerResponse.ID
		result.ProviderPayload = map[string]any{
			"deleted": providerResponse.Deleted,
			"id":      result.ID,
		}
	}
	if response.StatusCode != http.StatusOK ||
		!result.Deleted || result.ID != resourceID {
		return result, fmt.Errorf(
			"Asaas %s cleanup returned an unverified response (HTTP %d)",
			resourceKind,
			response.StatusCode,
		)
	}
	return result, nil
}

func (repo Repository) lockAndDisableOrganization(ctx context.Context, organizationID string, confirmationName string) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('admin-delete-organization:' || $1::text, 0))`, organizationID); err != nil {
		return err
	}

	var organizationName string
	err = tx.QueryRow(ctx, `
		select name
		from public.organizations
		where id = $1::uuid
		for update
	`, organizationID).Scan(&organizationName)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if strings.TrimSpace(organizationName) != strings.TrimSpace(confirmationName) {
		return ErrOrganizationDeleteConfirm
	}

	if _, err := tx.Exec(ctx, `
		update public.organizations
		set is_active = false,
		    updated_at = now()
		where id = $1::uuid
	`, organizationID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update public.organization_members
		set is_active = false,
		    updated_at = now()
		where organization_id = $1::uuid
	`, organizationID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update public.users u
		set is_active = false,
		    updated_at = now()
		where u.organization_id = $1::uuid
		  and coalesce(u.role, '') <> 'super_admin'
		  and not exists (
			select 1
			from public.organization_members other_membership
			join public.organizations other_organization
			  on other_organization.id = other_membership.organization_id
			 and other_organization.is_active = true
			where other_membership.user_id = u.id
			  and other_membership.organization_id <> $1::uuid
			  and other_membership.is_active = true
		  )
	`, organizationID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) disconnectOrganizationGoogleCalendars(ctx context.Context, organizationID string) error {
	connections, err := repo.listGoogleCalendarConnectionsForDeletion(ctx, organizationID)
	if err != nil {
		return err
	}

	for _, connection := range connections {
		for _, channel := range connection.Channels {
			if connection.AccessToken == "" {
				break
			}
			if err := repo.stopGoogleCalendarChannel(ctx, connection.AccessToken, channel); err != nil {
				return err
			}
		}

		// OAuth grants belong to the Google account, not to a single Vimob
		// organization. Revoking one here could disconnect another tenant that
		// legitimately uses the same grant. Only target channels and the local
		// organization-scoped connection are removed by this flow.
		if _, err := repo.db.Pool().Exec(ctx, `select public.google_calendar_disconnect_connection($1::uuid)`, connection.ID); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) listGoogleCalendarConnectionsForDeletion(
	ctx context.Context,
	organizationID string,
) ([]googleCalendarConnectionCleanup, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			token.id::text,
			public.google_calendar_get_token_secret(token.token_secret_ref)
		from public.google_calendar_tokens token
		where token.organization_id = $1::uuid
		order by token.id
	`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	connections := make([]googleCalendarConnectionCleanup, 0)
	connectionIndex := map[string]int{}
	for rows.Next() {
		var connection googleCalendarConnectionCleanup
		var secret *string
		if err := rows.Scan(&connection.ID, &secret); err != nil {
			return nil, err
		}
		if secret != nil {
			var parsed map[string]any
			if json.Unmarshal([]byte(*secret), &parsed) == nil {
				connection.AccessToken = deletionStringFromAny(parsed["access_token"])
			}
		}
		connectionIndex[connection.ID] = len(connections)
		connections = append(connections, connection)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	channelRows, err := repo.db.Pool().Query(ctx, `
		select connection_id::text, channel_id, coalesce(resource_id, '')
		from public.google_calendar_channels
		where organization_id = $1::uuid
		  and stopped_at is null
		order by connection_id, channel_id
	`, organizationID)
	if err != nil {
		return nil, err
	}
	defer channelRows.Close()
	for channelRows.Next() {
		var connectionID string
		var channel googleCalendarChannelCleanup
		if err := channelRows.Scan(&connectionID, &channel.ID, &channel.ResourceID); err != nil {
			return nil, err
		}
		if index, ok := connectionIndex[connectionID]; ok {
			connections[index].Channels = append(connections[index].Channels, channel)
		}
	}
	return connections, channelRows.Err()
}

func (repo Repository) stopGoogleCalendarChannel(
	ctx context.Context,
	accessToken string,
	channel googleCalendarChannelCleanup,
) error {
	if strings.TrimSpace(channel.ID) == "" || strings.TrimSpace(channel.ResourceID) == "" {
		return nil
	}
	payload, _ := json.Marshal(map[string]string{
		"id":         channel.ID,
		"resourceId": channel.ResourceID,
	})
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://www.googleapis.com/calendar/v3/channels/stop", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+accessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("Google Agenda channel stop failed: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))

	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	return fmt.Errorf("Google Agenda channel stop returned HTTP %d", response.StatusCode)
}

func (repo Repository) deleteOrganizationEvolutionInstances(ctx context.Context, organizationID string) error {
	sessions, err := repo.listEvolutionSessionsForDeletion(ctx, organizationID)
	if err != nil {
		return err
	}
	if len(sessions) != 0 {
		// Instance identifiers are not globally unique or durably tombstoned in
		// the current schema. A tenant purge therefore cannot prove that a remote
		// DELETE belongs only to this organization, and a 404 cannot prove exact
		// absence. Fail closed until the sessions are removed by a dedicated,
		// provider-reconciled workflow.
		return fmt.Errorf(
			"WhatsApp cleanup requires manual review: %d Evolution Go session(s) remain",
			len(sessions),
		)
	}
	return nil
}

func (repo Repository) listEvolutionSessionsForDeletion(ctx context.Context, organizationID string) ([]whatsappSessionCleanup, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			coalesce(instance_name, ''),
			coalesce(instance_id, ''),
			coalesce(status, 'disconnected'),
			coalesce(advanced_settings, '{}'::jsonb)::text
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and provider = 'evolution_go'
		order by id
	`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := make([]whatsappSessionCleanup, 0)
	for rows.Next() {
		var session whatsappSessionCleanup
		var settingsRaw string
		if err := rows.Scan(&session.ID, &session.InstanceName, &session.InstanceID, &session.Status, &settingsRaw); err != nil {
			return nil, err
		}
		session.Settings = map[string]any{}
		_ = json.Unmarshal([]byte(settingsRaw), &session.Settings)
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func evolutionInstanceKeyForDeletion(session whatsappSessionCleanup) string {
	return firstNonEmpty(
		deletionStringFromAny(session.Settings["evolution_go_resolved_instance_key"]),
		session.InstanceName,
		session.InstanceID,
	)
}

func (repo Repository) deleteOrganizationStorage(
	ctx context.Context,
	organizationID string,
) error {
	objects, err := repo.listOrganizationStorageObjects(ctx, organizationID)
	if err != nil {
		return err
	}
	if len(objects) == 0 {
		return nil
	}
	if repo.projectURL == "" || repo.apiKey == "" {
		return fmt.Errorf("Supabase Storage cleanup is not configured")
	}

	byBucket := map[string][]string{}
	for _, object := range objects {
		byBucket[object.Bucket] = append(byBucket[object.Bucket], object.Name)
	}
	buckets := make([]string, 0, len(byBucket))
	for bucket := range byBucket {
		buckets = append(buckets, bucket)
	}
	sort.Strings(buckets)

	for _, bucket := range buckets {
		paths := byBucket[bucket]
		sort.Strings(paths)
		for start := 0; start < len(paths); start += organizationStorageDeleteBatchSize {
			end := min(start+organizationStorageDeleteBatchSize, len(paths))
			batch := paths[start:end]
			if err := repo.deleteStorageObjectBatch(ctx, bucket, batch); err != nil {
				return err
			}
			if err := repo.verifyStorageObjectBatchDeleted(ctx, bucket, batch); err != nil {
				return err
			}
		}
	}
	remaining, err := repo.listOrganizationStorageObjects(ctx, organizationID)
	if err != nil {
		return err
	}
	if len(remaining) != 0 {
		return fmt.Errorf("Supabase Storage cleanup left %d tenant-owned objects", len(remaining))
	}
	return nil
}

func organizationStorageObjectPatterns(organizationID string) []string {
	return []string{
		organizationID + "/%",
		"orgs/" + organizationID + "/%",
		"organization/" + organizationID + "/%",
		"organizations/" + organizationID + "/%",
	}
}

func (repo Repository) listOrganizationStorageObjects(
	ctx context.Context,
	organizationID string,
) ([]organizationStorageObject, error) {
	patterns := organizationStorageObjectPatterns(organizationID)
	rows, err := repo.db.Pool().Query(ctx, `
		select bucket_id, name
		from storage.objects
		where name like any($1::text[])
		order by bucket_id, name
	`, patterns)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	seen := map[string]bool{}
	objects := make([]organizationStorageObject, 0)
	for rows.Next() {
		var object organizationStorageObject
		if err := rows.Scan(&object.Bucket, &object.Name); err != nil {
			return nil, err
		}
		key := object.Bucket + "\x00" + object.Name
		if !seen[key] {
			seen[key] = true
			objects = append(objects, object)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return objects, nil
}

func storageObjectHasTenantPrefix(
	object organizationStorageObject,
	organizationID string,
) bool {
	name := strings.TrimLeft(object.Name, "/")
	prefixes := []string{
		organizationID + "/",
		"orgs/" + organizationID + "/",
		"organization/" + organizationID + "/",
		"organizations/" + organizationID + "/",
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

func (repo Repository) deleteStorageObjectBatch(ctx context.Context, bucket string, objectPaths []string) error {
	payload, _ := json.Marshal(map[string]any{"prefixes": objectPaths})
	endpoint := repo.projectURL + "/storage/v1/object/" + url.PathEscape(bucket)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	setSupabaseServiceAPIAuth(request, repo.apiKey)
	request.Header.Set("Content-Type", "application/json")
	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("Supabase Storage cleanup failed: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("Supabase Storage cleanup returned HTTP %d", response.StatusCode)
	}
	return nil
}

func (repo Repository) verifyStorageObjectBatchDeleted(
	ctx context.Context,
	bucket string,
	objectPaths []string,
) error {
	if len(objectPaths) == 0 {
		return nil
	}
	var remaining int
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::int
		from storage.objects
		where bucket_id = $1
		  and name = any($2::text[])
	`, bucket, objectPaths).Scan(&remaining); err != nil {
		return err
	}
	if remaining != 0 {
		return fmt.Errorf("Supabase Storage cleanup did not remove %d requested objects", remaining)
	}
	return nil
}

func (repo Repository) purgeOrganizationDatabase(
	ctx context.Context,
	organizationID string,
) error {
	return repo.purgeOrganizationDatabaseWithExplicitUsers(ctx, organizationID, nil)
}

// purgeOrganizationDatabaseWithExplicitUsers is restricted to the
// capability-bound cancellation of an unconfirmed public signup. Normal
// organization deletion must always call purgeOrganizationDatabase so a
// tenant snapshot can never authorize identity deletion.
func (repo Repository) purgeOrganizationDatabaseWithExplicitUsers(
	ctx context.Context,
	organizationID string,
	explicitUsers []organizationUserCleanup,
) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('admin-delete-organization:' || $1::text, 0))`, organizationID); err != nil {
		return err
	}
	var lockedOrganizationID string
	if err := tx.QueryRow(ctx, `
		select id::text
		from public.organizations
		where id = $1::uuid
		for update
	`, organizationID).Scan(&lockedOrganizationID); errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	} else if err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.users target_user
		set organization_id = (
			select other_membership.organization_id
			from public.organization_members other_membership
			join public.organizations other_organization
			  on other_organization.id = other_membership.organization_id
			 and other_organization.is_active = true
			where other_membership.user_id = target_user.id
			  and other_membership.organization_id <> $1::uuid
			  and other_membership.is_active = true
			order by other_membership.joined_at, other_membership.organization_id
			limit 1
		),
		    is_active = case
		      when coalesce(target_user.role, '') = 'super_admin' then true
		      else exists (
		        select 1
		        from public.organization_members active_membership
		        join public.organizations active_organization
		          on active_organization.id = active_membership.organization_id
		         and active_organization.is_active = true
		        where active_membership.user_id = target_user.id
		          and active_membership.organization_id <> $1::uuid
		          and active_membership.is_active = true
		      )
		    end,
		    updated_at = now()
		where target_user.organization_id = $1::uuid
	`, organizationID); err != nil {
		return err
	}

	tables, nullifiers, err := organizationScopedDeletionPlan(ctx, tx)
	if err != nil {
		return err
	}
	for _, nullifier := range nullifiers {
		assignments := make([]string, 0, len(nullifier.Columns))
		for _, column := range nullifier.Columns {
			assignments = append(assignments, pgx.Identifier{column}.Sanitize()+" = null")
		}
		query := "update " + pgx.Identifier{nullifier.Table.Schema, nullifier.Table.Name}.Sanitize() +
			" set " + strings.Join(assignments, ", ") + " where organization_id = $1::uuid"
		if _, err := tx.Exec(ctx, query, organizationID); err != nil {
			return fmt.Errorf("clear %s dependency: %w", nullifier.Table.key(), err)
		}
	}
	for _, table := range tables {
		query := "delete from " + pgx.Identifier{table.Schema, table.Name}.Sanitize() + " where organization_id = $1::uuid"
		if _, err := tx.Exec(ctx, query, organizationID); err != nil {
			return fmt.Errorf("delete %s: %w", table.key(), err)
		}
	}

	// Freeze Storage metadata for the final absence proof. Upload endpoints are
	// already fenced by the disabled organization; this short table lock closes
	// the remaining check-to-commit window against service-side writers.
	if _, err := tx.Exec(ctx, `lock table storage.objects in share row exclusive mode`); err != nil {
		return err
	}
	var remainingStorageObjects int
	if err := tx.QueryRow(ctx, `
		select count(*)::int
		from storage.objects
		where name like any($1::text[])
	`, organizationStorageObjectPatterns(organizationID)).Scan(&remainingStorageObjects); err != nil {
		return err
	}
	if remainingStorageObjects != 0 {
		return ErrOrganizationPurgeUnsafe
	}

	tag, err := tx.Exec(ctx, `delete from public.organizations where id = $1::uuid`, organizationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	userIDs := make([]string, 0, len(explicitUsers))
	for _, user := range explicitUsers {
		userIDs = append(userIDs, user.ID)
	}
	if len(userIDs) > 0 {
		var deletedUsers int
		if err := tx.QueryRow(ctx, `
			with deleted as (
			  delete from public.users target_user
			  where target_user.id = any($1::uuid[])
			    and target_user.organization_id is null
			    and coalesce(target_user.role, '') <> 'super_admin'
			    and not exists (
			      select 1
			      from public.organization_members other_membership
			      join public.organizations other_organization
			        on other_organization.id = other_membership.organization_id
			       and other_organization.is_active = true
			      where other_membership.user_id = target_user.id
			        and other_membership.is_active = true
			    )
			  returning target_user.id
			)
			select count(*)::int from deleted
		`, userIDs).Scan(&deletedUsers); err != nil {
			return err
		}
		if deletedUsers != len(userIDs) {
			return ErrOrganizationPurgeUnsafe
		}
	}

	return tx.Commit(ctx)
}

func organizationScopedDeletionPlan(
	ctx context.Context,
	tx pgx.Tx,
) ([]organizationScopedTable, []organizationForeignKeyNullifier, error) {
	rows, err := tx.Query(ctx, `
		select namespace.nspname, relation.relname
		from pg_catalog.pg_class relation
		join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
		join pg_catalog.pg_attribute attribute
		  on attribute.attrelid = relation.oid
		 and attribute.attname = 'organization_id'
		 and attribute.attnum > 0
		 and not attribute.attisdropped
		where namespace.nspname in ('public', 'private')
		  and relation.relkind in ('r', 'p')
		order by namespace.nspname, relation.relname
	`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	tables := make([]organizationScopedTable, 0)
	for rows.Next() {
		var table organizationScopedTable
		if err := rows.Scan(&table.Schema, &table.Name); err != nil {
			return nil, nil, err
		}
		if table.key() == "public.organizations" || table.key() == "public.users" {
			continue
		}
		tables = append(tables, table)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	edges, nullifiers, err := organizationScopedForeignKeyPlan(ctx, tx, tables)
	if err != nil {
		return nil, nil, err
	}
	ordered, ok := sortOrganizationScopedTables(tables, edges)
	if !ok {
		return nil, nil, ErrOrganizationPurgeUnsafe
	}
	return ordered, nullifiers, nil
}

func organizationScopedForeignKeyPlan(
	ctx context.Context,
	tx pgx.Tx,
	tables []organizationScopedTable,
) (map[string][]string, []organizationForeignKeyNullifier, error) {
	tableSet := make(map[string]bool, len(tables))
	for _, table := range tables {
		tableSet[table.key()] = true
	}

	rows, err := tx.Query(ctx, `
		select
			child_namespace.nspname,
			child_relation.relname,
			parent_namespace.nspname,
			parent_relation.relname,
			constraint_row.confdeltype::text,
			array_agg(child_attribute.attname order by constrained_column.ordinality),
			bool_and(not child_attribute.attnotnull),
			bool_or(child_attribute.attname = 'organization_id')
		from pg_catalog.pg_constraint constraint_row
		join pg_catalog.pg_class child_relation on child_relation.oid = constraint_row.conrelid
		join pg_catalog.pg_namespace child_namespace on child_namespace.oid = child_relation.relnamespace
		join pg_catalog.pg_class parent_relation on parent_relation.oid = constraint_row.confrelid
		join pg_catalog.pg_namespace parent_namespace on parent_namespace.oid = parent_relation.relnamespace
		cross join lateral unnest(constraint_row.conkey) with ordinality constrained_column(attribute_number, ordinality)
		join pg_catalog.pg_attribute child_attribute
		  on child_attribute.attrelid = child_relation.oid
		 and child_attribute.attnum = constrained_column.attribute_number
		where constraint_row.contype = 'f'
		  and child_namespace.nspname in ('public', 'private')
		  and parent_namespace.nspname in ('public', 'private')
		group by
			constraint_row.oid,
			child_namespace.nspname,
			child_relation.relname,
			parent_namespace.nspname,
			parent_relation.relname,
			constraint_row.confdeltype
	`)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	edges := map[string][]string{}
	nullifiers := make([]organizationForeignKeyNullifier, 0)
	seen := map[string]bool{}
	seenNullifier := map[string]bool{}
	for rows.Next() {
		var childSchema, childName, parentSchema, parentName, deleteAction string
		var columns []string
		var allNullable, includesOrganizationID bool
		if err := rows.Scan(
			&childSchema,
			&childName,
			&parentSchema,
			&parentName,
			&deleteAction,
			&columns,
			&allNullable,
			&includesOrganizationID,
		); err != nil {
			return nil, nil, err
		}
		child := childSchema + "." + childName
		parent := parentSchema + "." + parentName
		if child == parent || !tableSet[child] || !tableSet[parent] {
			continue
		}
		// CASCADE, SET NULL and SET DEFAULT are safe when the parent is
		// deleted first and therefore do not constrain our explicit order.
		if deleteAction == "c" || deleteAction == "n" || deleteAction == "d" {
			continue
		}
		// Nullable NO ACTION / RESTRICT references can form legitimate cycles
		// (for example an automation pointing to its active version). Clear
		// those target-tenant references before deleting either side.
		if allNullable && !includesOrganizationID && len(columns) > 0 {
			nullifierKey := child + "\x00" + strings.Join(columns, "\x00")
			if !seenNullifier[nullifierKey] {
				seenNullifier[nullifierKey] = true
				nullifiers = append(nullifiers, organizationForeignKeyNullifier{
					Table:   organizationScopedTable{Schema: childSchema, Name: childName},
					Columns: columns,
				})
			}
			continue
		}
		edgeKey := child + "\x00" + parent
		if seen[edgeKey] {
			continue
		}
		seen[edgeKey] = true
		edges[child] = append(edges[child], parent)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}
	sort.Slice(nullifiers, func(i, j int) bool {
		left := nullifiers[i].Table.key() + "." + strings.Join(nullifiers[i].Columns, ".")
		right := nullifiers[j].Table.key() + "." + strings.Join(nullifiers[j].Columns, ".")
		return left < right
	})
	return edges, nullifiers, nil
}

func sortOrganizationScopedTables(
	tables []organizationScopedTable,
	edges map[string][]string,
) ([]organizationScopedTable, bool) {
	byKey := make(map[string]organizationScopedTable, len(tables))
	inDegree := make(map[string]int, len(tables))
	for _, table := range tables {
		byKey[table.key()] = table
		inDegree[table.key()] = 0
	}
	for child, parents := range edges {
		if _, ok := byKey[child]; !ok {
			continue
		}
		for _, parent := range parents {
			if _, ok := byKey[parent]; ok {
				inDegree[parent]++
			}
		}
	}

	ready := make([]string, 0)
	for key, degree := range inDegree {
		if degree == 0 {
			ready = append(ready, key)
		}
	}
	sort.Strings(ready)

	ordered := make([]organizationScopedTable, 0, len(tables))
	for len(ready) > 0 {
		key := ready[0]
		ready = ready[1:]
		ordered = append(ordered, byKey[key])
		for _, parent := range edges[key] {
			inDegree[parent]--
			if inDegree[parent] == 0 {
				ready = append(ready, parent)
				sort.Strings(ready)
			}
		}
	}
	return ordered, len(ordered) == len(tables)
}

func deletionStringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case json.Number:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}
