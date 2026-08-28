package portals

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const (
	portalContractOrganizationID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	portalContractIntegrationID  = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
)

func TestPortalCanonicalQueriesCompileAgainstDatabase(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		t.Fatal("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 2, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect database: %v", err)
	}
	t.Cleanup(postgres.Close)
	repo := NewRepository(postgres)

	items, err := repo.ListPublications(ctx, tenant.Context{OrganizationID: portalContractOrganizationID})
	if err != nil {
		t.Fatalf("canonical-aware settings query: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("unknown tenant returned %d settings rows", len(items))
	}
	selection, err := repo.feedListings(ctx, publicIntegration{
		ID: portalContractIntegrationID, OrganizationID: portalContractOrganizationID,
	})
	if err != nil {
		t.Fatalf("canonical-first feed query: %v", err)
	}
	if len(selection.Listings) != 0 || len(selection.Invalid) != 0 {
		t.Fatalf("unknown integration returned feed data: %#v", selection)
	}

	tx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	propertyID, _, err := findPublicationProperty(ctx, tx, portalContractIntegrationID, "UNKNOWN")
	if err != nil && err != pgx.ErrNoRows {
		t.Fatalf("canonical-first lead identity query: %v", err)
	}
	if propertyID != nil {
		t.Fatalf("unknown provider listing resolved to %s", *propertyID)
	}

	var fixtureOrganizationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.organizations (name)
		values ('Portal ETag contract')
		returning id::text
	`).Scan(&fixtureOrganizationID); err != nil {
		t.Fatalf("create ETag organization fixture: %v", err)
	}
	defer func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.organizations where id = $1::uuid`, fixtureOrganizationID)
	}()

	var fixtureIntegrationID, feedToken, webhookToken string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.portal_integrations (
		  organization_id, portal, status, is_active, settings, created_at, updated_at
		)
		values (
		  $1::uuid, 'grupo_olx', 'paused', false,
		  '{"contact_name":"Vimob Test","contact_email":"portals@example.test"}'::jsonb,
		  '2026-01-01T12:00:00Z'::timestamptz,
		  '2026-01-01T12:00:00Z'::timestamptz
		)
		returning id::text, feed_token, webhook_token
	`, fixtureOrganizationID).Scan(&fixtureIntegrationID, &feedToken, &webhookToken); err != nil {
		t.Fatalf("create ETag integration fixture: %v", err)
	}
	firstFeed, err := repo.BuildGrupoOLXFeed(ctx, feedToken)
	if err != nil {
		t.Fatalf("build first ETag feed: %v", err)
	}
	secondFeed, err := repo.BuildGrupoOLXFeed(ctx, feedToken)
	if err != nil {
		t.Fatalf("build second ETag feed: %v", err)
	}
	if !bytes.Equal(firstFeed, secondFeed) {
		t.Fatal("feed access telemetry must not change the XML representation or its strong ETag")
	}

	var pipelineID, stageID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.pipelines (organization_id, name, position, is_active)
		values ($1::uuid, 'Grupo OLX ingress', 1, true)
		returning id::text
	`, fixtureOrganizationID).Scan(&pipelineID); err != nil {
		t.Fatalf("create lead pipeline fixture: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.stages (organization_id, pipeline_id, name, stage_key, position, is_active)
		values ($1::uuid, $2::uuid, 'Entrada', 'grupo-olx-entry', 1, true)
		returning id::text
	`, fixtureOrganizationID, pipelineID).Scan(&stageID); err != nil {
		t.Fatalf("create lead stage fixture: %v", err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.portal_integrations
		set default_pipeline_id = $2::uuid, default_stage_id = $3::uuid
		where id = $1::uuid
	`, fixtureIntegrationID, pipelineID, stageID); err != nil {
		t.Fatalf("configure lead destination fixture: %v", err)
	}

	propertyIDs := make([]string, 2)
	listingIDs := []string{"OLX-REENTRY-1", "OLX-REENTRY-2"}
	for index := range propertyIDs {
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.properties (organization_id, code, title, status)
			values ($1::uuid, $2, $3, 'active')
			returning id::text
		`, fixtureOrganizationID, listingIDs[index], "Imovel "+listingIDs[index]).Scan(&propertyIDs[index]); err != nil {
			t.Fatalf("create lead property %d: %v", index, err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			insert into public.portal_listing_publications (
			  integration_id, organization_id, portal, property_id,
			  client_listing_id, publication_type, is_enabled, status
			) values ($1::uuid, $2::uuid, 'grupo_olx', $3::uuid, $4, 'STANDARD', true, 'exported')
		`, fixtureIntegrationID, fixtureOrganizationID, propertyIDs[index], listingIDs[index]); err != nil {
			t.Fatalf("create lead listing %d: %v", index, err)
		}
	}

	const webhookSecret = "grupo-olx-integration-test-secret"
	authorization := "Basic " + base64.StdEncoding.EncodeToString([]byte("vivareal:"+webhookSecret))
	secureRepo := NewRepository(postgres, Config{WebhookSecret: webhookSecret})
	firstPayload, _ := json.Marshal(map[string]any{
		"originLeadId": "OLX-EVENT-1", "clientListingId": listingIDs[0],
		"name": "Joao Cliente", "ddd": "11", "phone": "999999999",
	})
	firstLead, err := secureRepo.ProcessGrupoOLXLead(ctx, webhookToken, authorization, firstPayload)
	if err != nil {
		t.Fatalf("process first Grupo OLX lead: %v", err)
	}
	secondPayload, _ := json.Marshal(map[string]any{
		"originLeadId": "OLX-EVENT-2", "clientListingId": listingIDs[1],
		"ddd": "11", "phone": "999999999",
	})
	secondLead, err := secureRepo.ProcessGrupoOLXLead(ctx, webhookToken, authorization, secondPayload)
	if err != nil {
		t.Fatalf("process Grupo OLX reentry: %v", err)
	}
	if firstLead.LeadID == nil || secondLead.LeadID == nil || *firstLead.LeadID != *secondLead.LeadID {
		t.Fatalf("same phone did not reuse one lead: first=%#v second=%#v", firstLead, secondLead)
	}
	var leadCount, entryCount, interestCount, processedWebhookCount int
	var persistedName string
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer, min(name)
		from public.leads
		where organization_id = $1::uuid and normalize_phone(phone) = normalize_phone('11999999999')
	`, fixtureOrganizationID).Scan(&leadCount, &persistedName); err != nil {
		t.Fatalf("read reentry lead: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.lead_entry_events
		where organization_id = $1::uuid and lead_id = $2::uuid
		  and provider = 'grupo_olx' and provider_event_id in ('OLX-EVENT-1', 'OLX-EVENT-2')
	`, fixtureOrganizationID, *firstLead.LeadID).Scan(&entryCount); err != nil {
		t.Fatalf("read reentry events: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.lead_property_interests
		where lead_id = $1::uuid and property_id = any($2::uuid[])
	`, *firstLead.LeadID, propertyIDs).Scan(&interestCount); err != nil {
		t.Fatalf("read property interests: %v", err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*)::integer
		from public.portal_webhook_events
		where integration_id = $1::uuid and event_key in ('OLX-EVENT-1', 'OLX-EVENT-2')
		  and processing_status = 'processed' and lead_id = $2::uuid
	`, fixtureIntegrationID, *firstLead.LeadID).Scan(&processedWebhookCount); err != nil {
		t.Fatalf("read processed webhook events: %v", err)
	}
	if leadCount != 1 || persistedName != "Joao Cliente" || entryCount != 2 || interestCount != 2 || processedWebhookCount != 2 {
		t.Fatalf("reentry persistence = leads:%d name:%q entries:%d interests:%d webhooks:%d", leadCount, persistedName, entryCount, interestCount, processedWebhookCount)
	}

	extremeReport := []byte(`{"id":"report\u0000unsafe","type":"FEEDS_INTEGRATION_REPORT","details":{"date":"2026-08-01T12:00:00Z","total":1e400,"created":0,"updated":0,"deleted":0,"unchanged":0,"error":0,"warning":0}}`)
	receipt, err := secureRepo.ReceiveGrupoOLXImportReport(ctx, webhookToken, authorization, extremeReport)
	if err != nil {
		t.Fatalf("durably receive extreme JSON report: %v", err)
	}
	reportID, _ := receipt["report_id"].(string)
	if reportID != payloadHash(extremeReport) {
		t.Fatalf("unsafe report id = %q, want payload hash", reportID)
	}
	var storedRaw []byte
	if err := postgres.Pool().QueryRow(ctx, `
		select raw_body from public.portal_import_reports
		where integration_id = $1::uuid and report_id = $2
	`, fixtureIntegrationID, reportID).Scan(&storedRaw); err != nil {
		t.Fatalf("read exact raw report body: %v", err)
	}
	if !bytes.Equal(storedRaw, extremeReport) {
		t.Fatal("raw report body was not preserved byte-for-byte")
	}
	processed, workerErr := secureRepo.processNextImportReport(ctx)
	if !processed || workerErr == nil {
		t.Fatalf("extreme report dead-letter = processed:%v error:%v", processed, workerErr)
	}
	var annotationStatus, annotationError string
	if err := postgres.Pool().QueryRow(ctx, `
		select annotation_status, annotation_last_error
		from public.portal_import_reports
		where integration_id = $1::uuid and report_id = $2
	`, fixtureIntegrationID, reportID).Scan(&annotationStatus, &annotationError); err != nil {
		t.Fatalf("read extreme report dead-letter: %v", err)
	}
	if annotationStatus != "dead" || annotationError != "invalid_report_schema" {
		t.Fatalf("extreme report annotation = %q/%q", annotationStatus, annotationError)
	}
}
