package publications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	config  Config
	storage publicationStorageClient
}

func NewRepository(db *dbpkg.Postgres, config Config) Repository {
	config.PublicBaseURL = strings.TrimRight(strings.TrimSpace(config.PublicBaseURL), "/")
	config.AppURL = strings.TrimRight(strings.TrimSpace(config.AppURL), "/")
	config.Worker = config.Worker.normalized()
	return Repository{
		db: db, config: config,
		storage: newPublicationStorageClient(config.StorageURL, config.StorageAPIKey),
	}
}

type publicationQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func (repo Repository) GetOverview(ctx context.Context, tenantContext tenant.Context, propertyID string) (OverviewResponse, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return OverviewResponse{}, ErrPropertyNotFound
	}
	return repo.getOverviewWithQueryer(ctx, repo.db.Pool(), tenantContext, propertyID)
}

func (repo Repository) getOverviewWithQueryer(
	ctx context.Context,
	queryer publicationQueryer,
	tenantContext tenant.Context,
	propertyID string,
) (OverviewResponse, error) {
	source, err := repo.loadPublicationSource(ctx, queryer, tenantContext, propertyID, false)
	if err != nil {
		return OverviewResponse{}, err
	}
	scopes := []publicationScope{
		sitePublicationScope(),
		grupoOLXPublicationScope(source.GrupoOLXIntegrationID),
	}
	publicationsByScope := make(map[string]*publicationRecord, len(scopes))
	for _, scope := range scopes {
		if scope.Channel == GrupoOLXChannel && source.GrupoOLXIntegrationID == "" {
			continue
		}
		publication, publicationErr := repo.getPublication(
			ctx, queryer, tenantContext.OrganizationID, propertyID, scope, false,
		)
		if publicationErr != nil && !errors.Is(publicationErr, ErrPublicationNotFound) {
			return OverviewResponse{}, publicationErr
		}
		if publicationErr == nil {
			publicationsByScope[publicationScopeKey(scope)] = publication
		}
	}
	return repo.buildOverview(ctx, queryer, tenantContext, source, scopes, publicationsByScope)
}

func (repo Repository) Publish(ctx context.Context, tenantContext tenant.Context, propertyID string, input PublishInput, idempotencyKey string) (commandResult, error) {
	if err := input.Validate(); err != nil {
		return commandResult{}, err
	}
	return repo.executeCommand(ctx, tenantContext, propertyID, SiteChannel, ActionPublish, input.ExpectedPropertyUpdatedAt, idempotencyKey)
}

func (repo Repository) Unpublish(ctx context.Context, tenantContext tenant.Context, propertyID string, input PublicationRevisionInput, idempotencyKey string) (commandResult, error) {
	if err := input.Validate(); err != nil {
		return commandResult{}, err
	}
	return repo.executeCommand(ctx, tenantContext, propertyID, SiteChannel, ActionUnpublish, input.ExpectedPublicationUpdatedAt, idempotencyKey)
}

func (repo Repository) Retry(ctx context.Context, tenantContext tenant.Context, propertyID string, input PublicationRevisionInput, idempotencyKey string) (commandResult, error) {
	if err := input.Validate(); err != nil {
		return commandResult{}, err
	}
	return repo.executeCommand(ctx, tenantContext, propertyID, SiteChannel, ActionRevalidate, input.ExpectedPublicationUpdatedAt, idempotencyKey)
}

func (repo Repository) PublishGrupoOLX(ctx context.Context, tenantContext tenant.Context, propertyID string, input PublishInput, idempotencyKey string) (commandResult, error) {
	if err := input.Validate(); err != nil {
		return commandResult{}, err
	}
	return repo.executeCommand(ctx, tenantContext, propertyID, GrupoOLXChannel, ActionPublish, input.ExpectedPropertyUpdatedAt, idempotencyKey)
}

func (repo Repository) UnpublishGrupoOLX(ctx context.Context, tenantContext tenant.Context, propertyID string, input PublicationRevisionInput, idempotencyKey string) (commandResult, error) {
	if err := input.Validate(); err != nil {
		return commandResult{}, err
	}
	return repo.executeCommand(ctx, tenantContext, propertyID, GrupoOLXChannel, ActionUnpublish, input.ExpectedPublicationUpdatedAt, idempotencyKey)
}

func (repo Repository) RetryGrupoOLX(ctx context.Context, tenantContext tenant.Context, propertyID string, input PublicationRevisionInput, idempotencyKey string) (commandResult, error) {
	if err := input.Validate(); err != nil {
		return commandResult{}, err
	}
	return repo.executeCommand(ctx, tenantContext, propertyID, GrupoOLXChannel, ActionRevalidate, input.ExpectedPublicationUpdatedAt, idempotencyKey)
}

func (repo Repository) ResolvePublicMedia(ctx context.Context, publicationID string, version int64, assetID string) (string, error) {
	publicationID, publicationOK := normalizeUUID(publicationID)
	assetID, assetOK := normalizeUUID(assetID)
	if !publicationOK || !assetOK || version < 1 {
		return "", ErrMediaNotFound
	}
	var target publicMediaTarget
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(asset.storage_path, ''), coalesce(asset.external_url, '')
		from public.property_channel_publications as publication
		join public.property_channel_publication_versions as version
		  on version.publication_id = publication.id
		 and version.organization_id = publication.organization_id
		 and version.property_id = publication.property_id
		 and version.channel = publication.channel
		 and version.channel_account_key = publication.channel_account_key
		join public.property_assets as asset
		  on asset.organization_id = publication.organization_id
		 and asset.property_id = publication.property_id
		where publication.id = $1::uuid
		  and (
		    (publication.channel = 'site' and publication.channel_account_key = 'default')
		    or publication.channel = 'grupo_olx'
		  )
		  and publication.desired_state = 'published'
		  and (
		    publication.published_version = version.version
		    or exists (
		      select 1
		      from public.property_channel_publication_jobs delivered_job
		      where delivered_job.publication_id = publication.id
		        and delivered_job.organization_id = publication.organization_id
		        and delivered_job.version_id = version.id
			    and delivered_job.action in ('publish', 'update', 'revalidate')
		        and delivered_job.status = 'succeeded'
		    )
		  )
		  and version.version = $2
		  and asset.id = $3::uuid
		  and asset.visibility = 'public'
		  and exists (
		    select 1
		    from jsonb_array_elements(coalesce(version.payload->'media', '[]'::jsonb)) as media
		    where media->>'asset_id' = asset.id::text
		      and media->>'source_hash' = coalesce(
		        lower(nullif(btrim(asset.checksum_sha256), '')),
		        encode(extensions.digest(
		          case
		            when nullif(btrim(coalesce(asset.storage_path, '')), '') is not null
		              then 'storage:' || trim(both '/' from btrim(asset.storage_path))
		            else 'external:' || btrim(coalesce(asset.external_url, ''))
		          end,
		          'sha256'
		        ), 'hex')
		      )
		  )
		limit 1
	`, publicationID, version, assetID).Scan(&target.StoragePath, &target.ExternalURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrMediaNotFound
	}
	if err != nil {
		return "", err
	}
	if target.StoragePath != "" {
		return repo.storage.signedURL(ctx, target.StoragePath, time.Minute)
	}
	if externalURL, ok := safeExternalMediaURL(target.ExternalURL); ok {
		return externalURL, nil
	}
	return "", ErrMediaNotFound
}

func (repo Repository) executeCommand(
	ctx context.Context,
	tenantContext tenant.Context,
	propertyID string,
	channel string,
	action string,
	expectedRevision string,
	idempotencyKey string,
) (commandResult, error) {
	if !tenantContext.HasPermission(permissions.PropertyManage) || !tenantContext.HasModule("properties") {
		return commandResult{}, tenant.ErrOrganizationAccessDenied
	}
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return commandResult{}, ErrPropertyNotFound
	}
	idempotencyKey, err := normalizeIdempotencyKey(idempotencyKey)
	if err != nil {
		return commandResult{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return commandResult{}, err
	}
	defer tx.Rollback(ctx)

	source, err := repo.loadPublicationSource(ctx, tx, tenantContext, propertyID, true)
	if err != nil {
		return commandResult{}, err
	}
	scope, err := publicationScopeForChannel(channel, source)
	if err != nil {
		return commandResult{}, err
	}
	requestHash := canonicalRequestHash(scope, action, propertyID, expectedRevision)

	if existingHash, found, findErr := findExistingCommand(ctx, tx, tenantContext.OrganizationID, idempotencyKey); findErr != nil {
		return commandResult{}, findErr
	} else if found {
		if existingHash != requestHash {
			return commandResult{}, ErrIdempotencyConflict
		}
		response, overviewErr := repo.getOverviewWithQueryer(ctx, tx, tenantContext, propertyID)
		if overviewErr != nil {
			return commandResult{}, overviewErr
		}
		if err := tx.Commit(ctx); err != nil {
			return commandResult{}, err
		}
		return commandResult{Response: response, Replay: true}, nil
	}

	publication, publicationErr := repo.getPublication(ctx, tx, tenantContext.OrganizationID, propertyID, scope, true)
	if publicationErr != nil && !errors.Is(publicationErr, ErrPublicationNotFound) {
		return commandResult{}, publicationErr
	}
	if errors.Is(publicationErr, ErrPublicationNotFound) {
		publication = nil
	}

	var versionID *string
	jobAction := action
	providerListingID := providerListingIDForScope(scope, source)
	switch action {
	case ActionPublish:
		if !timestampMatchesRevision(source.UpdatedAt, expectedRevision) {
			return commandResult{}, ErrPublicationConflict
		}
		if err := ensurePublicationAvailable(scope, source, tenantContext); err != nil {
			return commandResult{}, err
		}
		checks, _, readinessState := evaluatePublicationReadiness(scope, source)
		if readinessState != ReadinessReady {
			return commandResult{}, fmt.Errorf("%w: %s", ErrPublicationNotReady, firstCheckMessage(checks))
		}
		if err := ensureGrupoOLXListingIDAvailable(ctx, tx, tenantContext.OrganizationID, propertyID, scope, providerListingID); err != nil {
			return commandResult{}, err
		}
		if publication == nil {
			publication, err = repo.createPublication(ctx, tx, tenantContext, propertyID, scope, providerListingID)
			if err != nil {
				return commandResult{}, err
			}
		}
		if publication.PublishedVersion != nil {
			jobAction = ActionUpdate
		}
		if err := ensureProviderConfigurationStable(scope, publication, providerListingID, source.GrupoOLXPublicationType); err != nil {
			return commandResult{}, err
		}
		versionID, err = repo.createVersion(ctx, tx, tenantContext, source, *publication, scope, checks)
		if err != nil {
			return commandResult{}, err
		}
		if err := repo.markPublicationRequested(ctx, tx, tenantContext, publication.ID, DesiredPublished, ObservedQueued, ReadinessReady, publication.CurrentVersion+1, checks, providerListingID); err != nil {
			return commandResult{}, err
		}
	case ActionUnpublish:
		if publication == nil {
			return commandResult{}, ErrPublicationNotFound
		}
		if !timestampMatchesRevision(publication.UpdatedAt, expectedRevision) {
			return commandResult{}, ErrPublicationConflict
		}
		versionID, err = repo.currentVersionID(ctx, tx, *publication)
		if err != nil {
			return commandResult{}, err
		}
		if err := repo.markPublicationRequested(ctx, tx, tenantContext, publication.ID, DesiredUnpublished, ObservedQueued, publication.ReadinessState, publication.CurrentVersion, publication.ValidationErrors, publication.ProviderListingID); err != nil {
			return commandResult{}, err
		}
	case ActionRevalidate:
		if publication == nil {
			return commandResult{}, ErrPublicationNotFound
		}
		if !timestampMatchesRevision(publication.UpdatedAt, expectedRevision) {
			return commandResult{}, ErrPublicationConflict
		}
		if publication.DesiredState == DesiredUnpublished {
			jobAction = ActionUnpublish
			versionID, err = repo.currentVersionID(ctx, tx, *publication)
			if err != nil {
				return commandResult{}, err
			}
			if err := repo.markPublicationRequested(ctx, tx, tenantContext, publication.ID, DesiredUnpublished, ObservedQueued, publication.ReadinessState, publication.CurrentVersion, publication.ValidationErrors, publication.ProviderListingID); err != nil {
				return commandResult{}, err
			}
		} else {
			if err := ensurePublicationAvailable(scope, source, tenantContext); err != nil {
				return commandResult{}, err
			}
			checks, _, readinessState := evaluatePublicationReadiness(scope, source)
			if readinessState != ReadinessReady {
				return commandResult{}, fmt.Errorf("%w: %s", ErrPublicationNotReady, firstCheckMessage(checks))
			}
			if err := ensureGrupoOLXListingIDAvailable(ctx, tx, tenantContext.OrganizationID, propertyID, scope, providerListingID); err != nil {
				return commandResult{}, err
			}
			if err := ensureProviderConfigurationStable(scope, publication, providerListingID, source.GrupoOLXPublicationType); err != nil {
				return commandResult{}, err
			}
			versionID, err = repo.createVersion(ctx, tx, tenantContext, source, *publication, scope, checks)
			if err != nil {
				return commandResult{}, err
			}
			if err := repo.markPublicationRequested(ctx, tx, tenantContext, publication.ID, DesiredPublished, ObservedQueued, ReadinessReady, publication.CurrentVersion+1, checks, providerListingID); err != nil {
				return commandResult{}, err
			}
		}
	default:
		return commandResult{}, ErrInvalidInput
	}

	inserted, existingHash, err := repo.enqueueJob(
		ctx, tx, tenantContext, publication.ID, versionID, propertyID, scope, jobAction, idempotencyKey, requestHash,
	)
	if err != nil {
		return commandResult{}, err
	}
	if !inserted {
		if existingHash != requestHash {
			return commandResult{}, ErrIdempotencyConflict
		}
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			return commandResult{}, err
		}
		response, overviewErr := repo.GetOverview(ctx, tenantContext, propertyID)
		return commandResult{Response: response, Replay: true}, overviewErr
	}

	response, overviewErr := repo.getOverviewWithQueryer(ctx, tx, tenantContext, propertyID)
	if overviewErr != nil {
		return commandResult{}, overviewErr
	}
	if err := tx.Commit(ctx); err != nil {
		return commandResult{}, err
	}
	wakePublicationWorker()
	return commandResult{Response: response}, nil
}

func publicationScopeForChannel(channel string, source publicationSource) (publicationScope, error) {
	switch strings.TrimSpace(channel) {
	case SiteChannel:
		return sitePublicationScope(), nil
	case GrupoOLXChannel:
		if strings.TrimSpace(source.GrupoOLXIntegrationID) == "" {
			return publicationScope{}, ErrGrupoOLXUnavailable
		}
		return grupoOLXPublicationScope(source.GrupoOLXIntegrationID), nil
	default:
		return publicationScope{}, ErrInvalidInput
	}
}

func publicationScopeKey(scope publicationScope) string {
	return scope.Channel + "\x00" + scope.AccountKey
}

func ensurePublicationAvailable(scope publicationScope, source publicationSource, tenantContext tenant.Context) error {
	switch scope.Channel {
	case SiteChannel:
		if !source.SiteActive || !source.SiteModuleActive || !tenantContext.HasModule("site") {
			return ErrSiteUnavailable
		}
	case GrupoOLXChannel:
		if !source.GrupoOLXActive || normalizedASCII(source.GrupoOLXStatus) == "paused" || !source.GrupoOLXModuleActive || !tenantContext.HasModule("portals") {
			return ErrGrupoOLXUnavailable
		}
	default:
		return ErrInvalidInput
	}
	return nil
}

func providerListingIDForScope(scope publicationScope, source publicationSource) *string {
	if scope.Channel != GrupoOLXChannel {
		return nil
	}
	return stringPointer(source.GrupoOLXClientListingID)
}

func ensureProviderConfigurationStable(
	scope publicationScope,
	publication *publicationRecord,
	providerListingID *string,
	publicationType string,
) error {
	if scope.Channel != GrupoOLXChannel || publication == nil {
		return nil
	}
	current := pointerText(publication.ProviderListingID)
	next := pointerText(providerListingID)
	if current != "" && next != "" && current != next {
		return fmt.Errorf(
			"%w: Grupo OLX ListingID is immutable after the canonical publication is created",
			ErrPublicationNotReady,
		)
	}
	fullyUnpublished := publication.DesiredState == DesiredUnpublished &&
		publication.ObservedState == ObservedUnpublished && publication.PublishedVersion == nil
	currentProduct := normalizeGrupoOLXPublicationType(publication.ProviderPublicationType)
	nextProduct := normalizeGrupoOLXPublicationType(publicationType)
	if currentProduct != "" && nextProduct != "" && currentProduct != nextProduct && !fullyUnpublished {
		return fmt.Errorf(
			"%w: Grupo OLX publication product can change only after the listing is fully unpublished",
			ErrPublicationNotReady,
		)
	}
	return nil
}

func ensureGrupoOLXListingIDAvailable(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
	scope publicationScope,
	providerListingID *string,
) error {
	listingID := pointerText(providerListingID)
	if scope.Channel != GrupoOLXChannel || listingID == "" {
		return nil
	}
	lockKey := "grupo_olx_listing_id:" + organizationID + ":" + scope.AccountKey + ":" + listingID
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, lockKey); err != nil {
		return err
	}
	var conflict bool
	if err := tx.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.portal_listing_publications legacy
		  where legacy.organization_id = $1::uuid
		    and legacy.integration_id = $2::uuid
		    and legacy.client_listing_id = $3
		    and legacy.property_id <> $4::uuid
		)
	`, organizationID, scope.AccountKey, listingID, propertyID).Scan(&conflict); err != nil {
		return err
	}
	if conflict {
		return fmt.Errorf(
			"%w: Grupo OLX ListingID is already used by another property in this account",
			ErrPublicationNotReady,
		)
	}
	return nil
}

func (repo Repository) buildOverview(
	ctx context.Context,
	queryer publicationQueryer,
	tenantContext tenant.Context,
	source publicationSource,
	scopes []publicationScope,
	publicationsByScope map[string]*publicationRecord,
) (OverviewResponse, error) {
	canManage := tenantContext.HasPermission(permissions.PropertyManage)
	views := make([]PublicationView, 0, len(scopes))
	for _, scope := range scopes {
		publication := publicationsByScope[publicationScopeKey(scope)]
		view, err := repo.buildPublicationView(ctx, queryer, tenantContext, source, scope, publication, canManage)
		if err != nil {
			return OverviewResponse{}, err
		}
		views = append(views, view)
	}

	return OverviewResponse{
		Data: OverviewData{
			PropertyID: sourcePropertyID(source.Property), PropertyUpdatedAt: formatTimestamp(source.UpdatedAt),
			Publications: views,
		},
		Meta: OverviewMeta{CanManage: canManage},
	}, nil
}

func (repo Repository) buildPublicationView(
	ctx context.Context,
	queryer publicationQueryer,
	tenantContext tenant.Context,
	source publicationSource,
	scope publicationScope,
	publication *publicationRecord,
	canManage bool,
) (PublicationView, error) {
	checks, score, readinessState := evaluatePublicationReadiness(scope, source)
	available := publicationScopeAvailable(scope, source, tenantContext)
	previewURL := source.SitePublicURL
	if scope.Channel == GrupoOLXChannel {
		previewURL = source.GrupoOLXPublicURL
	}
	view := PublicationView{
		Channel:           scope.Channel,
		ChannelAccountKey: scope.AccountKey,
		Label:             scope.Label,
		Available:         available,
		DesiredState:      DesiredUnpublished,
		ObservedState:     ObservedDraft,
		ReadinessState:    readinessState,
		ReadinessScore:    score,
		Checks:            checks,
		CurrentVersion:    0,
		Preview:           buildPreview(source.Property, previewURL),
		RecentJobs:        []RecentJob{},
	}

	var currentVersion *versionRecord
	if publication != nil {
		view.ID = &publication.ID
		view.DesiredState = publication.DesiredState
		view.ObservedState = publication.ObservedState
		view.CurrentVersion = publication.CurrentVersion
		view.PublishedVersion = publication.PublishedVersion
		view.PublicURL = publication.PublicURL
		view.LastRequestedAt = formatTimestampPointer(publication.LastRequestedAt)
		view.LastAttemptAt = formatTimestampPointer(publication.LastAttemptAt)
		view.LastSucceededAt = formatTimestampPointer(publication.LastSucceededAt)
		updatedAt := formatTimestamp(publication.UpdatedAt)
		view.UpdatedAt = &updatedAt
		if publication.LastErrorCode != nil || publication.LastErrorMessage != nil {
			view.LastError = &LastError{Code: pointerText(publication.LastErrorCode), Message: pointerText(publication.LastErrorMessage)}
		}
		if publication.CurrentVersion > 0 {
			version, err := repo.getVersion(ctx, queryer, publication.ID, publication.CurrentVersion)
			if err != nil && !errors.Is(err, ErrPublicationNotFound) {
				return PublicationView{}, err
			}
			if err == nil {
				currentVersion = &version
				if preview, ok := decodeSnapshotPreview(version.Payload); ok {
					view.Preview = preview
				}
				currentSnapshot := buildPublicationSnapshot(scope, source, repo.config.PublicBaseURL, publication.ID, version.Version)
				currentHash, hashErr := publicationSnapshotHash(currentSnapshot)
				if hashErr != nil {
					return PublicationView{}, hashErr
				}
				view.IsOutdated = currentHash != version.PayloadHash
			}
		}
		jobs, err := repo.listRecentJobs(ctx, queryer, publication.ID)
		if err != nil {
			return PublicationView{}, err
		}
		view.RecentJobs = jobs
		if scope.Channel == GrupoOLXChannel {
			feedback, err := repo.latestGrupoOLXProviderFeedback(
				ctx, queryer, publication.ChannelAccountKey, pointerText(publication.ProviderListingID),
			)
			if err != nil {
				return PublicationView{}, err
			}
			view.ProviderFeedback = feedback
		}
	}

	deliveryRetryable := publication != nil && publicationDeliveryError(publication.LastErrorCode) &&
		!hasActivePublicationJob(view.RecentJobs)
	view.Capabilities = Capabilities{
		CanPublish: canManage && available && readinessState == ReadinessReady && !publicationBusy(view.ObservedState) &&
			(publication == nil || view.ObservedState != ObservedPublished || view.IsOutdated),
		CanUnpublish: canManage && publication != nil &&
			(view.DesiredState != DesiredUnpublished || view.ObservedState == ObservedPublished) && !publicationBusy(view.ObservedState),
		CanRetry: canManage && deliveryRetryable &&
			(view.ObservedState == ObservedError ||
				(view.DesiredState == DesiredPublished && view.ObservedState == ObservedPublished)) &&
			(view.DesiredState == DesiredUnpublished ||
				(view.DesiredState == DesiredPublished && available && readinessState == ReadinessReady)),
		CanPreview: currentVersion != nil || previewHasContent(view.Preview),
	}
	return view, nil
}

func (repo Repository) latestGrupoOLXProviderFeedback(
	ctx context.Context,
	queryer publicationQueryer,
	integrationID string,
	listingID string,
) (*ProviderFeedback, error) {
	integrationID, validIntegrationID := normalizeUUID(integrationID)
	listingID = strings.TrimSpace(listingID)
	if !validIntegrationID || listingID == "" {
		return nil, nil
	}
	var reportID, severity string
	var messagesJSON []byte
	var providerOccurredAt pgtype.Timestamptz
	var receivedAt time.Time
	err := queryer.QueryRow(ctx, `
		select report.report_id,
		       feedback->>'severity',
		       feedback->'messages',
		       report.provider_occurred_at,
		       report.created_at
		from public.portal_import_reports report
		cross join lateral jsonb_array_elements(
		  case
		    when jsonb_typeof(report.summary->'provider_feedback') = 'array'
		      then report.summary->'provider_feedback'
		    else '[]'::jsonb
		  end
		) feedback
		where report.integration_id = $1::uuid
		  and report.portal = 'grupo_olx'
		  and report.summary->'provider_feedback' @> jsonb_build_array(
		    jsonb_build_object('listing_id', $2::text)
		  )
		  and feedback->>'listing_id' = $2
		  and feedback->>'severity' in ('warning', 'error')
		  and jsonb_typeof(feedback->'messages') = 'array'
		order by coalesce(report.provider_occurred_at, report.created_at) desc,
		         report.created_at desc, report.id desc
		limit 1
	`, integrationID, listingID).Scan(&reportID, &severity, &messagesJSON, &providerOccurredAt, &receivedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	messages := []string{}
	if err := json.Unmarshal(messagesJSON, &messages); err != nil {
		return nil, err
	}
	cleaned := make([]string, 0, len(messages))
	seen := map[string]bool{}
	for _, message := range messages {
		message = strings.TrimSpace(message)
		if message == "" || seen[message] {
			continue
		}
		seen[message] = true
		cleaned = append(cleaned, message)
	}
	if len(cleaned) == 0 {
		return nil, nil
	}
	feedback := &ProviderFeedback{
		Scope: "listing_id", VersionBound: false, ListingID: listingID,
		ReportID: reportID, Severity: severity, Messages: cleaned,
		ReceivedAt: formatTimestamp(receivedAt),
	}
	if providerOccurredAt.Valid {
		value := formatTimestamp(providerOccurredAt.Time)
		feedback.ProviderOccurredAt = &value
	}
	return feedback, nil
}

func publicationScopeAvailable(scope publicationScope, source publicationSource, tenantContext tenant.Context) bool {
	return ensurePublicationAvailable(scope, source, tenantContext) == nil
}

func (repo Repository) loadPublicationSource(
	ctx context.Context,
	queryer publicationQueryer,
	tenantContext tenant.Context,
	propertyID string,
	lock bool,
) (publicationSource, error) {
	visibility := publicationVisibilitySQL("p", "$3", "$4", "$5")
	lockSQL := ""
	if lock {
		lockSQL = " for update of p"
	}
	var propertyJSON string
	var customDomain string
	var subdomain string
	var source publicationSource
	err := queryer.QueryRow(ctx, `
		select `+sitePublicPropertySQL("p")+`::text,
		       p.updated_at,
		       coalesce(p.status, ''),
		       (
		         p.owner_id is not null
		         or nullif(trim(coalesce(p.owner_name, '')), '') is not null
		         or exists (
		           select 1 from public.property_ownerships po
		           where po.organization_id = p.organization_id and po.property_id = p.id
		             and po.valid_from <= current_date
		             and (po.valid_to is null or current_date < po.valid_to)
		         )
		       ),
		       coalesce(p.responsible_user_id, p.created_by) is not null,
		       coalesce(site.is_active, false) and coalesce(org.is_active, false),
		       exists (
		         select 1 from public.organization_modules module
		         where module.organization_id = p.organization_id
		           and lower(trim(module.module_name)) = 'site'
		           and coalesce(module.is_enabled, false) = true
		       ),
		       case when coalesce(site.domain_verified, false) then coalesce(trim(site.custom_domain), '') else '' end,
		       coalesce(trim(site.subdomain), '')
		from public.properties p
		join public.organizations org on org.id = p.organization_id
		left join public.organization_sites site on site.organization_id = p.organization_id
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		  and `+visibility+`
		limit 1`+lockSQL,
		tenantContext.OrganizationID,
		propertyID,
		canViewAllProperties(tenantContext),
		tenantContext.UserID,
		canViewTeamProperties(tenantContext),
	).Scan(
		&propertyJSON,
		&source.UpdatedAt,
		&source.Status,
		&source.OwnerPresent,
		&source.ResponsiblePresent,
		&source.SiteActive,
		&source.SiteModuleActive,
		&customDomain,
		&subdomain,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return publicationSource{}, ErrPropertyNotFound
	}
	if err != nil {
		return publicationSource{}, err
	}
	if err := json.Unmarshal([]byte(propertyJSON), &source.Property); err != nil {
		return publicationSource{}, err
	}
	source.SitePublicURL = propertyPublicURL(repo.config.AppURL, customDomain, subdomain, text(source.Property["codigo"]))
	var grupoOLXSettingsJSON []byte
	err = queryer.QueryRow(ctx, `
		select coalesce(integration.id::text, ''),
		       coalesce(integration.status, ''),
		       coalesce(integration.is_active, false),
		       exists (
		         select 1
		         from public.organization_modules module
		         where module.organization_id = property.organization_id
		           and lower(trim(module.module_name)) = 'portals'
		           and coalesce(module.is_enabled, false) = true
		       ),
		       coalesce(integration.settings, '{}'::jsonb),
		       coalesce(
		         nullif(trim(canonical.provider_listing_id), ''),
		         nullif(trim(listing.client_listing_id), ''),
		         nullif(trim(property.code), ''),
		         property.id::text
		       ),
		       case
		         when canonical.id is not null
		          and not (
		            canonical.desired_state = 'unpublished'
		            and canonical.observed_state = 'unpublished'
		            and canonical.published_version is null
		          )
		           then coalesce(
		             nullif(trim(current_version.payload->'channel_config'->>'publication_type'), ''),
		             nullif(trim(listing.publication_type), ''),
		             nullif(trim(integration.settings->>'default_publication_type'), ''),
		             'STANDARD'
		           )
		         else coalesce(
		           nullif(trim(listing.publication_type), ''),
		           nullif(trim(current_version.payload->'channel_config'->>'publication_type'), ''),
		           nullif(trim(integration.settings->>'default_publication_type'), ''),
		           'STANDARD'
		         )
		       end
		from public.properties property
		left join public.portal_integrations integration
		  on integration.organization_id = property.organization_id
		 and integration.portal = 'grupo_olx'
		left join public.portal_listing_publications listing
		  on listing.integration_id = integration.id
		 and listing.organization_id = property.organization_id
		 and listing.property_id = property.id
		 and listing.portal = 'grupo_olx'
		left join public.property_channel_publications canonical
		  on canonical.organization_id = property.organization_id
		 and canonical.property_id = property.id
		 and canonical.channel = 'grupo_olx'
		 and canonical.channel_account_key = integration.id::text
		left join public.property_channel_publication_versions current_version
		  on current_version.publication_id = canonical.id
		 and current_version.version = canonical.current_version
		where property.organization_id = $1::uuid
		  and property.id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, propertyID).Scan(
		&source.GrupoOLXIntegrationID,
		&source.GrupoOLXStatus,
		&source.GrupoOLXActive,
		&source.GrupoOLXModuleActive,
		&grupoOLXSettingsJSON,
		&source.GrupoOLXClientListingID,
		&source.GrupoOLXPublicationType,
	)
	if err != nil {
		return publicationSource{}, err
	}
	source.GrupoOLXSettings = map[string]any{}
	if len(grupoOLXSettingsJSON) > 0 {
		if err := json.Unmarshal(grupoOLXSettingsJSON, &source.GrupoOLXSettings); err != nil {
			return publicationSource{}, err
		}
	}
	source.GrupoOLXClientListingID = normalizeGrupoOLXListingID(source.GrupoOLXClientListingID, text(source.Property["codigo"]))
	source.GrupoOLXPublicationType = normalizeGrupoOLXPublicationType(source.GrupoOLXPublicationType)
	source.GrupoOLXPublicURL = grupoOLXPropertyPublicURL(source.GrupoOLXSettings, text(source.Property["codigo"]))

	offerRows, err := queryer.Query(ctx, `
		select offer_type, status, coalesce(price, 0)::float8, currency, price_period
		from public.property_offers
		where organization_id = $1::uuid and property_id = $2::uuid
		order by offer_type, id
	`, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return publicationSource{}, err
	}
	defer offerRows.Close()
	for offerRows.Next() {
		var offer sourceOffer
		if err := offerRows.Scan(&offer.OfferType, &offer.Status, &offer.Price, &offer.Currency, &offer.PricePeriod); err != nil {
			return publicationSource{}, err
		}
		source.Offers = append(source.Offers, offer)
	}
	if err := offerRows.Err(); err != nil {
		return publicationSource{}, err
	}

	assetRows, err := queryer.Query(ctx, `
		select id::text, asset_type, visibility, coalesce(storage_path, ''), coalesce(external_url, ''),
		       sort_order, is_primary, coalesce(mime_type, ''), coalesce(file_name, ''), file_size_bytes,
		       coalesce(checksum_sha256, '')
		from public.property_assets
		where organization_id = $1::uuid and property_id = $2::uuid
		order by is_primary desc, sort_order, id
	`, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return publicationSource{}, err
	}
	defer assetRows.Close()
	for assetRows.Next() {
		var asset sourceAsset
		if err := assetRows.Scan(
			&asset.ID, &asset.AssetType, &asset.Visibility, &asset.StoragePath, &asset.ExternalURL,
			&asset.SortOrder, &asset.IsPrimary, &asset.MIMEType, &asset.FileName, &asset.FileSizeBytes, &asset.ChecksumSHA256,
		); err != nil {
			return publicationSource{}, err
		}
		source.Assets = append(source.Assets, asset)
	}
	return source, assetRows.Err()
}

func (repo Repository) createPublication(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	propertyID string,
	scope publicationScope,
	providerListingID *string,
) (*publicationRecord, error) {
	_, err := tx.Exec(ctx, `
		insert into public.property_channel_publications (
			organization_id, property_id, channel, channel_account_key,
			desired_state, observed_state, readiness_state, current_version,
			validation_errors, provider_listing_id, created_by, updated_by
		) values (
			$1::uuid, $2::uuid, $3, $4,
			'unpublished', 'draft', 'unknown', 0,
			'[]'::jsonb, $5, $6::uuid, $6::uuid
		)
		on conflict (organization_id, property_id, channel, channel_account_key) do nothing
	`, tenantContext.OrganizationID, propertyID, scope.Channel, scope.AccountKey, nullableString(providerListingID), tenantContext.UserID)
	if err != nil {
		return nil, normalizeDatabaseError(err)
	}
	return repo.getPublication(ctx, tx, tenantContext.OrganizationID, propertyID, scope, true)
}

func (repo Repository) getPublication(
	ctx context.Context,
	queryer publicationQueryer,
	organizationID string,
	propertyID string,
	scope publicationScope,
	lock bool,
) (*publicationRecord, error) {
	lockSQL := ""
	if lock {
		lockSQL = " for update"
	}
	var item publicationRecord
	var publishedVersion *int64
	var validationJSON []byte
	var providerListingID, publicURL, errorCode, errorMessage *string
	var lastRequestedAt, lastAttemptAt, lastSucceededAt pgtype.Timestamptz
	var publishedAt, unpublishedAt pgtype.Timestamptz
	err := queryer.QueryRow(ctx, `
		select id::text, organization_id::text, property_id::text, channel, channel_account_key,
		       desired_state, observed_state, readiness_state, current_version, published_version,
		       validation_errors, provider_listing_id,
		       coalesce((
		         select version.payload->'channel_config'->>'publication_type'
		         from public.property_channel_publication_versions version
		         where version.publication_id = property_channel_publications.id
		           and version.version = property_channel_publications.current_version
		         limit 1
		       ), ''),
		       public_url, last_error_code, last_error_message,
		       last_requested_at, last_attempt_at, last_succeeded_at,
		       published_at, unpublished_at, updated_at
		from public.property_channel_publications
		where organization_id = $1::uuid and property_id = $2::uuid
		  and channel = $3 and channel_account_key = $4
		limit 1`+lockSQL,
		organizationID, propertyID, scope.Channel, scope.AccountKey,
	).Scan(
		&item.ID, &item.OrganizationID, &item.PropertyID, &item.Channel, &item.ChannelAccountKey,
		&item.DesiredState, &item.ObservedState, &item.ReadinessState, &item.CurrentVersion, &publishedVersion,
		&validationJSON, &providerListingID, &item.ProviderPublicationType, &publicURL, &errorCode, &errorMessage,
		&lastRequestedAt, &lastAttemptAt, &lastSucceededAt,
		&publishedAt, &unpublishedAt, &item.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPublicationNotFound
	}
	if err != nil {
		return nil, err
	}
	item.PublishedVersion = publishedVersion
	item.ProviderListingID = providerListingID
	item.PublicURL = publicURL
	item.LastErrorCode = errorCode
	item.LastErrorMessage = errorMessage
	item.LastRequestedAt = timestamptzPointer(lastRequestedAt)
	item.LastAttemptAt = timestamptzPointer(lastAttemptAt)
	item.LastSucceededAt = timestamptzPointer(lastSucceededAt)
	item.PublishedAt = timestamptzPointer(publishedAt)
	item.UnpublishedAt = timestamptzPointer(unpublishedAt)
	if len(validationJSON) > 0 {
		_ = json.Unmarshal(validationJSON, &item.ValidationErrors)
	}
	return &item, nil
}

func (repo Repository) createVersion(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	source publicationSource,
	publication publicationRecord,
	scope publicationScope,
	checks []Check,
) (*string, error) {
	nextVersion := publication.CurrentVersion + 1
	snapshot := buildPublicationSnapshot(scope, source, repo.config.PublicBaseURL, publication.ID, nextVersion)
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return nil, err
	}
	readinessErrors, err := json.Marshal(unresolvedChecks(checks))
	if err != nil {
		return nil, err
	}
	var versionID string
	err = tx.QueryRow(ctx, `
		insert into public.property_channel_publication_versions (
			publication_id, organization_id, property_id, channel, channel_account_key,
			version, source_property_updated_at, payload_schema_version, payload,
			payload_hash, readiness_errors, created_by
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4, $5,
			$6, $7::timestamptz, $8, $9::jsonb,
			$10, $11::jsonb, $12::uuid
		)
		returning id::text
	`, publication.ID, tenantContext.OrganizationID, publication.PropertyID, scope.Channel, scope.AccountKey, nextVersion,
		source.UpdatedAt, PayloadSchemaVersion, string(payload), payloadHash(payload), string(readinessErrors), tenantContext.UserID,
	).Scan(&versionID)
	if err != nil {
		return nil, normalizeDatabaseError(err)
	}
	return &versionID, nil
}

func (repo Repository) markPublicationRequested(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	publicationID string,
	desiredState string,
	observedState string,
	readinessState string,
	currentVersion int64,
	checks []Check,
	providerListingID *string,
) error {
	validationErrors, err := json.Marshal(unresolvedChecks(checks))
	if err != nil {
		return err
	}
	command, err := tx.Exec(ctx, `
		update public.property_channel_publications
		set desired_state = $3,
		    observed_state = $4,
		    readiness_state = $5,
		    current_version = $6,
		    validation_errors = $7::jsonb,
		    provider_listing_id = $8,
		    last_error_code = null,
		    last_error_message = null,
		    last_requested_at = now(),
		    updated_by = $9::uuid,
		    updated_at = now()
		where id = $1::uuid and organization_id = $2::uuid
	`, publicationID, tenantContext.OrganizationID, desiredState, observedState,
		readinessState, currentVersion, string(validationErrors), nullableString(providerListingID), tenantContext.UserID)
	if err != nil {
		return normalizeDatabaseError(err)
	}
	if command.RowsAffected() != 1 {
		return ErrPublicationConflict
	}
	return nil
}

func (repo Repository) currentVersionID(ctx context.Context, tx pgx.Tx, publication publicationRecord) (*string, error) {
	if publication.CurrentVersion < 1 {
		return nil, nil
	}
	var id string
	err := tx.QueryRow(ctx, `
		select id::text
		from public.property_channel_publication_versions
		where publication_id = $1::uuid and version = $2
	`, publication.ID, publication.CurrentVersion).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPublicationConflict
	}
	if err != nil {
		return nil, err
	}
	return &id, nil
}

func (repo Repository) enqueueJob(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	publicationID string,
	versionID *string,
	propertyID string,
	scope publicationScope,
	action string,
	idempotencyKey string,
	requestHash string,
) (bool, string, error) {
	var jobID string
	err := tx.QueryRow(ctx, `
		insert into public.property_channel_publication_jobs (
			publication_id, version_id, organization_id, property_id,
			channel, channel_account_key, action, status,
			idempotency_key, request_hash, attempts, max_attempts,
			next_attempt_at, requested_by, created_at, updated_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $6, $7, 'pending',
			$8, $9, 0, $10,
			clock_timestamp(), $11::uuid, clock_timestamp(), clock_timestamp()
		)
		on conflict (organization_id, idempotency_key) do nothing
		returning id::text
	`, publicationID, nullableString(versionID), tenantContext.OrganizationID, propertyID,
		scope.Channel, scope.AccountKey, action, idempotencyKey, requestHash, repo.config.Worker.MaxAttempts, tenantContext.UserID,
	).Scan(&jobID)
	if err == nil {
		return true, requestHash, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return false, "", normalizeDatabaseError(err)
	}
	existingHash, found, err := findExistingCommand(ctx, tx, tenantContext.OrganizationID, idempotencyKey)
	if err != nil || !found {
		return false, "", err
	}
	return false, existingHash, nil
}

func findExistingCommand(ctx context.Context, queryer publicationQueryer, organizationID string, idempotencyKey string) (string, bool, error) {
	var requestHash string
	err := queryer.QueryRow(ctx, `
		select request_hash
		from public.property_channel_publication_jobs
		where organization_id = $1::uuid and idempotency_key = $2
		limit 1
	`, organizationID, idempotencyKey).Scan(&requestHash)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return requestHash, true, nil
}

func (repo Repository) getVersion(ctx context.Context, queryer publicationQueryer, publicationID string, version int64) (versionRecord, error) {
	var item versionRecord
	var payload []byte
	var readiness []byte
	err := queryer.QueryRow(ctx, `
		select id::text, publication_id::text, version, source_property_updated_at,
		       payload, payload_hash, readiness_errors
		from public.property_channel_publication_versions
		where publication_id = $1::uuid and version = $2
		limit 1
	`, publicationID, version).Scan(
		&item.ID, &item.PublicationID, &item.Version, &item.SourcePropertyUpdatedAt,
		&payload, &item.PayloadHash, &readiness,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return versionRecord{}, ErrPublicationNotFound
	}
	if err != nil {
		return versionRecord{}, err
	}
	if err := json.Unmarshal(payload, &item.Payload); err != nil {
		return versionRecord{}, err
	}
	_ = json.Unmarshal(readiness, &item.ReadinessErrors)
	return item, nil
}

func (repo Repository) listRecentJobs(ctx context.Context, queryer publicationQueryer, publicationID string) ([]RecentJob, error) {
	rows, err := queryer.Query(ctx, `
		select job.id::text, job.action, job.status, version.version, job.attempts, job.max_attempts,
		       job.next_attempt_at, job.last_error_code, job.last_error_message,
		       job.completed_at, job.created_at
		from public.property_channel_publication_jobs job
		left join public.property_channel_publication_versions version on version.id = job.version_id
		where job.publication_id = $1::uuid
		order by job.created_at desc, job.id desc
		limit 10
	`, publicationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := []RecentJob{}
	for rows.Next() {
		var job RecentJob
		var nextAttempt, completed pgtype.Timestamptz
		var createdAt time.Time
		var errorCode, errorMessage *string
		if err := rows.Scan(
			&job.ID, &job.Action, &job.Status, &job.Version, &job.Attempts, &job.MaxAttempts,
			&nextAttempt, &errorCode, &errorMessage, &completed, &createdAt,
		); err != nil {
			return nil, err
		}
		job.NextAttemptAt = formatTimestampPointer(timestamptzPointer(nextAttempt))
		job.CompletedAt = formatTimestampPointer(timestamptzPointer(completed))
		job.CreatedAt = formatTimestamp(createdAt)
		if errorCode != nil || errorMessage != nil {
			job.LastError = &LastError{Code: pointerText(errorCode), Message: pointerText(errorMessage)}
		}
		jobs = append(jobs, job)
	}
	return jobs, rows.Err()
}

func publicationVisibilitySQL(alias string, canViewAll string, userID string, canViewTeam string) string {
	return `(
		` + canViewAll + `::boolean
		or ` + alias + `.responsible_user_id = ` + userID + `::uuid
		or ` + alias + `.created_by = ` + userID + `::uuid
		or (
			` + canViewTeam + `::boolean
			and exists (
				select 1
				from public.team_members leader
				join public.team_members member
				  on member.organization_id = leader.organization_id
				 and member.team_id = leader.team_id
				 and member.is_active = true
				where leader.organization_id = ` + alias + `.organization_id
				  and leader.user_id = ` + userID + `::uuid
				  and leader.is_active = true
				  and leader.is_leader = true
				  and (member.user_id = ` + alias + `.responsible_user_id or member.user_id = ` + alias + `.created_by)
			)
		)
	)`
}

func canViewAllProperties(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.PropertyManage)
}

func canViewTeamProperties(tenantContext tenant.Context) bool {
	return tenantContext.IsTeamLeader || tenantContext.HasPermission(permissions.LeadViewTeam)
}

func decodeSnapshotPreview(payload map[string]any) (Preview, bool) {
	raw, exists := payload["preview"]
	if !exists {
		return Preview{}, false
	}
	encoded, err := json.Marshal(raw)
	if err != nil {
		return Preview{}, false
	}
	var preview Preview
	if err := json.Unmarshal(encoded, &preview); err != nil {
		return Preview{}, false
	}
	return preview, true
}

func sourcePropertyID(property map[string]any) string { return text(property["id"]) }

func publicationBusy(state string) bool {
	switch state {
	case ObservedQueued, ObservedPublishing, ObservedPausing, ObservedUnpublishing:
		return true
	default:
		return false
	}
}

func hasActivePublicationJob(jobs []RecentJob) bool {
	for _, job := range jobs {
		switch job.Status {
		case "pending", "processing", "retry":
			return true
		}
	}
	return false
}

func publicationDeliveryError(code *string) bool {
	value := strings.TrimSpace(pointerText(code))
	if value == "" {
		return false
	}
	return value != "grupo_olx_feed_validation" && !strings.HasPrefix(value, "grupo_olx_import_")
}

func previewHasContent(preview Preview) bool {
	return preview.Title != nil || preview.Description != nil || preview.PrimaryImageURL != nil
}

func pointerText(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func nullableString(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func timestampMatchesRevision(value time.Time, revision string) bool {
	revisionTime, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(revision))
	return err == nil && value.Equal(revisionTime)
}

func formatTimestamp(value time.Time) string {
	return value.UTC().Format(time.RFC3339Nano)
}

func formatTimestampPointer(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := formatTimestamp(*value)
	return &formatted
}

func timestamptzPointer(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}
	timestamp := value.Time
	return &timestamp
}

func firstCheckMessage(checks []Check) string {
	for _, check := range checks {
		if !check.Resolved && check.Message != nil {
			return *check.Message
		}
	}
	return "A publicação possui pendências."
}

func normalizeDatabaseError(err error) error {
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) {
		return err
	}
	switch databaseError.Code {
	case "23505":
		if databaseError.ConstraintName == "property_channel_publications_provider_uidx" {
			return fmt.Errorf(
				"%w: Grupo OLX ListingID is already used by another property in this account",
				ErrPublicationNotReady,
			)
		}
		return ErrPublicationConflict
	case "23502", "23503", "23514", "22P02", "22007", "22008":
		return fmt.Errorf("%w: publication data violates a business rule", ErrInvalidInput)
	default:
		return err
	}
}
