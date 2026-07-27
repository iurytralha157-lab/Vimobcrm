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
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const organizationStorageDeleteBatchSize = 1000

type organizationUserCleanup struct {
	ID        string
	AvatarURL string
}

type organizationStorageObject struct {
	Bucket string
	Name   string
}

type googleCalendarChannelCleanup struct {
	ID         string
	ResourceID string
}

type googleCalendarConnectionCleanup struct {
	ID           string
	AccessToken  string
	RefreshToken string
	Channels     []googleCalendarChannelCleanup
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
// disabled first, external connections and files are removed next, and the
// relational data is only deleted after those cleanup steps succeed.
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

	exclusiveUsers, err := repo.listExclusiveOrganizationUsers(ctx, organizationID, tenantContext.UserID)
	if err != nil {
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
	if err := repo.deleteOrganizationStorage(ctx, organizationID, exclusiveUsers); err != nil {
		return OrganizationDeleteResult{}, fmt.Errorf("%w: %v", ErrOrganizationExternalCleanup, err)
	}

	if err := repo.purgeOrganizationDatabase(ctx, organizationID, exclusiveUsers); err != nil {
		return OrganizationDeleteResult{}, err
	}

	warnings := make([]string, 0)
	for _, user := range exclusiveUsers {
		if err := repo.deleteOrganizationAuthUser(ctx, user.ID); err != nil {
			warnings = append(warnings, "Uma conta de acesso residual não pôde ser removida automaticamente.")
		}
	}

	return OrganizationDeleteResult{
		OK:              true,
		DeletedUsers:    len(exclusiveUsers),
		CleanupWarnings: warnings,
	}, nil
}

func (repo Repository) cancelOrganizationAsaasBilling(ctx context.Context, organizationID string) error {
	var customerID string
	var subscriptionID string
	err := repo.db.Pool().QueryRow(ctx, `
		select
			coalesce(asaas_customer_id, ''),
			coalesce(asaas_subscription_id, '')
		from public.organizations
		where id = $1::uuid
	`, organizationID).Scan(&customerID, &subscriptionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}

	paymentRows, err := repo.db.Pool().Query(ctx, `
		select asaas_payment_id
		from public.asaas_payments
		where organization_id = $1::uuid
		  and nullif(btrim(asaas_payment_id), '') is not null
		  and upper(coalesce(status, '')) in ('PENDING', 'OVERDUE', 'AWAITING_RISK_ANALYSIS')
		order by created_at, asaas_payment_id
	`, organizationID)
	if err != nil {
		return err
	}
	defer paymentRows.Close()

	paymentIDs := make([]string, 0)
	for paymentRows.Next() {
		var paymentID string
		if err := paymentRows.Scan(&paymentID); err != nil {
			return err
		}
		paymentIDs = append(paymentIDs, strings.TrimSpace(paymentID))
	}
	if err := paymentRows.Err(); err != nil {
		return err
	}

	customerID = strings.TrimSpace(customerID)
	subscriptionID = strings.TrimSpace(subscriptionID)
	if customerID == "" && subscriptionID == "" && len(paymentIDs) == 0 {
		return nil
	}
	if repo.asaasURL == "" || repo.asaasAPIKey == "" {
		return fmt.Errorf("Asaas cleanup is not configured")
	}

	if subscriptionID != "" {
		if err := repo.deleteAsaasResource(ctx, "subscriptions", subscriptionID); err != nil {
			return err
		}
	}
	for _, paymentID := range paymentIDs {
		if err := repo.deleteAsaasResource(ctx, "payments", paymentID); err != nil {
			return err
		}
	}
	if customerID != "" {
		if err := repo.deleteAsaasResource(ctx, "customers", customerID); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) deleteAsaasResource(ctx context.Context, resource string, resourceID string) error {
	endpoint := repo.asaasURL + "/" + url.PathEscape(resource) + "/" + url.PathEscape(resourceID)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("access_token", repo.asaasAPIKey)
	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("Asaas %s cleanup failed: %w", resource, err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if (response.StatusCode >= 200 && response.StatusCode < 300) ||
		response.StatusCode == http.StatusNotFound ||
		response.StatusCode == http.StatusGone {
		return nil
	}
	return fmt.Errorf("Asaas %s cleanup returned HTTP %d", resource, response.StatusCode)
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

func (repo Repository) listExclusiveOrganizationUsers(
	ctx context.Context,
	organizationID string,
	currentSuperAdminID string,
) ([]organizationUserCleanup, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select u.id::text, coalesce(u.avatar_url, '')
		from public.users u
		where coalesce(u.role, '') <> 'super_admin'
		  and ($2 = '' or u.id <> $2::uuid)
		  and (
			u.organization_id = $1::uuid
			or exists (
				select 1
				from public.organization_members target_membership
				where target_membership.user_id = u.id
				  and target_membership.organization_id = $1::uuid
			)
		  )
		  and (u.organization_id is null or u.organization_id = $1::uuid)
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
		order by u.id
	`, organizationID, strings.TrimSpace(currentSuperAdminID))
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := make([]organizationUserCleanup, 0)
	for rows.Next() {
		var user organizationUserCleanup
		if err := rows.Scan(&user.ID, &user.AvatarURL); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
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

		tokenToRevoke := firstNonEmpty(connection.RefreshToken, connection.AccessToken)
		if tokenToRevoke != "" {
			if err := repo.revokeGoogleToken(ctx, tokenToRevoke); err != nil {
				return err
			}
		}

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
				connection.RefreshToken = deletionStringFromAny(parsed["refresh_token"])
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
	// Expired/revoked credentials and already-stopped channels do not leave a
	// usable Vimob connection behind. Rate limiting and server errors are
	// retriable, so those keep the tenant purge blocked.
	if response.StatusCode >= 400 && response.StatusCode < 500 && response.StatusCode != http.StatusTooManyRequests {
		return nil
	}
	return fmt.Errorf("Google Agenda channel stop returned HTTP %d", response.StatusCode)
}

func (repo Repository) revokeGoogleToken(ctx context.Context, token string) error {
	form := url.Values{}
	form.Set("token", token)
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://oauth2.googleapis.com/revoke",
		strings.NewReader(form.Encode()),
	)
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	response, err := repo.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("Google Agenda token revoke failed: %w", err)
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))

	if response.StatusCode >= 200 && response.StatusCode < 300 {
		return nil
	}
	// Google returns 400 when a token is already invalid or revoked.
	if response.StatusCode == http.StatusBadRequest {
		return nil
	}
	return fmt.Errorf("Google Agenda token revoke returned HTTP %d", response.StatusCode)
}

func (repo Repository) deleteOrganizationEvolutionInstances(ctx context.Context, organizationID string) error {
	sessions, err := repo.listEvolutionSessionsForDeletion(ctx, organizationID)
	if err != nil {
		return err
	}
	for _, session := range sessions {
		if strings.EqualFold(session.Status, "deleted") {
			continue
		}
		instanceKey := evolutionInstanceKeyForDeletion(session)
		if instanceKey == "" {
			if strings.EqualFold(session.Status, "disconnected") || strings.EqualFold(session.Status, "disabled") {
				continue
			}
			return fmt.Errorf("WhatsApp session %s has no provider instance identifier", session.ID)
		}
		if repo.evolutionGoURL == "" || repo.evolutionGoAPIKey == "" {
			return fmt.Errorf("Evolution Go cleanup is not configured")
		}

		endpoint := repo.evolutionGoURL + "/instance/delete/" + url.PathEscape(instanceKey)
		request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
		if err != nil {
			return err
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("apikey", repo.evolutionGoAPIKey)
		response, err := repo.httpClient.Do(request)
		if err != nil {
			return fmt.Errorf("Evolution Go instance cleanup failed: %w", err)
		}
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
		response.Body.Close()
		if (response.StatusCode < 200 || response.StatusCode >= 300) &&
			response.StatusCode != http.StatusNotFound &&
			response.StatusCode != http.StatusGone {
			return fmt.Errorf("Evolution Go instance cleanup returned HTTP %d", response.StatusCode)
		}
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
	exclusiveUsers []organizationUserCleanup,
) error {
	objects, err := repo.listOrganizationStorageObjects(ctx, organizationID, exclusiveUsers)
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
			if err := repo.deleteStorageObjectBatch(ctx, bucket, paths[start:end]); err != nil {
				return err
			}
		}
	}
	return nil
}

func (repo Repository) listOrganizationStorageObjects(
	ctx context.Context,
	organizationID string,
	exclusiveUsers []organizationUserCleanup,
) ([]organizationStorageObject, error) {
	patterns := []string{
		organizationID + "/%",
		"orgs/" + organizationID + "/%",
		"organization/" + organizationID + "/%",
		"organizations/" + organizationID + "/%",
	}
	for _, user := range exclusiveUsers {
		patterns = append(patterns,
			user.ID+"/%",
			user.ID+"-%",
			"avatars/"+user.ID+"%",
		)
	}

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

	assetURLs, err := repo.listOrganizationAssetURLs(ctx, organizationID, exclusiveUsers)
	if err != nil {
		return nil, err
	}
	for _, assetURL := range assetURLs {
		object, ok := storageObjectFromURL(repo.projectURL, assetURL)
		if !ok {
			continue
		}
		if !storageObjectHasTenantPrefix(object, organizationID, exclusiveUsers) {
			referencedElsewhere, err := repo.assetURLReferencedByOtherOrganization(ctx, organizationID, assetURL)
			if err != nil {
				return nil, err
			}
			if referencedElsewhere {
				continue
			}
		}
		key := object.Bucket + "\x00" + object.Name
		if !seen[key] {
			seen[key] = true
			objects = append(objects, object)
		}
	}
	return objects, nil
}

func (repo Repository) listOrganizationAssetURLs(
	ctx context.Context,
	organizationID string,
	exclusiveUsers []organizationUserCleanup,
) ([]string, error) {
	rows, err := repo.queryJSONRows(ctx, `
		select to_jsonb(organization_row)
		from public.organizations organization_row
		where organization_row.id = $1::uuid
		union all
		select to_jsonb(site_row)
		from public.organization_sites site_row
		where site_row.organization_id = $1::uuid
		union all
		select to_jsonb(team_row)
		from public.teams team_row
		where team_row.organization_id = $1::uuid
		union all
		select to_jsonb(property_row)
		from public.properties property_row
		where property_row.organization_id = $1::uuid
	`, organizationID)
	if err != nil {
		return nil, err
	}

	assetKeys := map[string]bool{
		"about_image_url":    true,
		"avatar_url":         true,
		"banner_url":         true,
		"document_url":       true,
		"favicon_url":        true,
		"hero_image_url":     true,
		"image_url":          true,
		"image_urls":         true,
		"images":             true,
		"logo_url":           true,
		"page_banner_url":    true,
		"photo_url":          true,
		"photos":             true,
		"watermark_logo_url": true,
	}
	values := make([]string, 0)
	for _, row := range rows {
		for key, value := range row {
			if assetKeys[key] {
				appendStringValues(&values, value)
			}
		}
	}
	for _, user := range exclusiveUsers {
		if user.AvatarURL != "" {
			values = append(values, user.AvatarURL)
		}
	}
	return values, nil
}

func (repo Repository) assetURLReferencedByOtherOrganization(
	ctx context.Context,
	organizationID string,
	assetURL string,
) (bool, error) {
	var referenced bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.organizations other_organization
			where other_organization.id <> $1::uuid
			  and strpos(to_jsonb(other_organization)::text, to_jsonb($2::text)::text) > 0
			union all
			select 1
			from public.organization_sites other_site
			where other_site.organization_id <> $1::uuid
			  and strpos(to_jsonb(other_site)::text, to_jsonb($2::text)::text) > 0
			union all
			select 1
			from public.teams other_team
			where other_team.organization_id <> $1::uuid
			  and strpos(to_jsonb(other_team)::text, to_jsonb($2::text)::text) > 0
			union all
			select 1
			from public.properties other_property
			where other_property.organization_id <> $1::uuid
			  and strpos(to_jsonb(other_property)::text, to_jsonb($2::text)::text) > 0
		)
	`, organizationID, strings.TrimSpace(assetURL)).Scan(&referenced)
	return referenced, err
}

func storageObjectHasTenantPrefix(
	object organizationStorageObject,
	organizationID string,
	exclusiveUsers []organizationUserCleanup,
) bool {
	name := strings.TrimLeft(object.Name, "/")
	prefixes := []string{
		organizationID + "/",
		"orgs/" + organizationID + "/",
		"organization/" + organizationID + "/",
		"organizations/" + organizationID + "/",
	}
	for _, user := range exclusiveUsers {
		prefixes = append(prefixes,
			user.ID+"/",
			user.ID+"-",
			"avatars/"+user.ID,
		)
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}

func appendStringValues(target *[]string, value any) {
	switch typed := value.(type) {
	case string:
		if strings.TrimSpace(typed) != "" {
			*target = append(*target, strings.TrimSpace(typed))
		}
	case []any:
		for _, item := range typed {
			appendStringValues(target, item)
		}
	case map[string]any:
		for _, item := range typed {
			appendStringValues(target, item)
		}
	}
}

func storageObjectFromURL(projectURL string, rawValue string) (organizationStorageObject, bool) {
	project, err := url.Parse(strings.TrimSpace(projectURL))
	if err != nil || project.Host == "" {
		return organizationStorageObject{}, false
	}
	asset, err := url.Parse(strings.TrimSpace(rawValue))
	if err != nil || asset.Host == "" || !strings.EqualFold(project.Host, asset.Host) {
		return organizationStorageObject{}, false
	}

	const marker = "/storage/v1/object/"
	index := strings.Index(asset.EscapedPath(), marker)
	if index < 0 {
		return organizationStorageObject{}, false
	}
	remainder := strings.TrimPrefix(asset.EscapedPath()[index+len(marker):], "/")
	for _, visibility := range []string{"public/", "authenticated/", "sign/"} {
		remainder = strings.TrimPrefix(remainder, visibility)
	}
	parts := strings.SplitN(remainder, "/", 2)
	if len(parts) != 2 {
		return organizationStorageObject{}, false
	}
	bucket, err := url.PathUnescape(parts[0])
	if err != nil {
		return organizationStorageObject{}, false
	}
	name, err := url.PathUnescape(parts[1])
	if err != nil || strings.TrimSpace(bucket) == "" || strings.TrimSpace(name) == "" {
		return organizationStorageObject{}, false
	}
	return organizationStorageObject{Bucket: bucket, Name: strings.Trim(name, "/")}, true
}

func (repo Repository) deleteStorageObjectBatch(ctx context.Context, bucket string, objectPaths []string) error {
	payload, _ := json.Marshal(map[string]any{"prefixes": objectPaths})
	endpoint := repo.projectURL + "/storage/v1/object/" + url.PathEscape(bucket)
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("apikey", repo.apiKey)
	request.Header.Set("Authorization", "Bearer "+repo.apiKey)
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

func (repo Repository) purgeOrganizationDatabase(
	ctx context.Context,
	organizationID string,
	exclusiveUsers []organizationUserCleanup,
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

	tag, err := tx.Exec(ctx, `delete from public.organizations where id = $1::uuid`, organizationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}

	userIDs := make([]string, 0, len(exclusiveUsers))
	for _, user := range exclusiveUsers {
		userIDs = append(userIDs, user.ID)
	}
	if len(userIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			delete from public.users
			where id = any($1::uuid[])
			  and coalesce(role, '') <> 'super_admin'
		`, userIDs); err != nil {
			return err
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

func (repo Repository) deleteOrganizationAuthUser(ctx context.Context, userID string) error {
	if repo.projectURL == "" || repo.apiKey == "" {
		return fmt.Errorf("Supabase Auth cleanup is not configured")
	}
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		request, err := http.NewRequestWithContext(
			ctx,
			http.MethodDelete,
			repo.projectURL+"/auth/v1/admin/users/"+url.PathEscape(strings.TrimSpace(userID)),
			nil,
		)
		if err != nil {
			return err
		}
		request.Header.Set("apikey", repo.apiKey)
		request.Header.Set("Authorization", "Bearer "+repo.apiKey)
		response, err := repo.httpClient.Do(request)
		if err != nil {
			lastErr = err
		} else {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			response.Body.Close()
			if (response.StatusCode >= 200 && response.StatusCode < 300) || response.StatusCode == http.StatusNotFound {
				return nil
			}
			lastErr = fmt.Errorf("Supabase Auth cleanup returned HTTP %d", response.StatusCode)
		}
		if attempt == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(150 * time.Millisecond):
			}
		}
	}
	return lastErr
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
