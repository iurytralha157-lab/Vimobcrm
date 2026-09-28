package leads

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This optional repository test exercises the actual board, pagination, lead
// list, and detail projections on an isolated local QA database. It never
// modifies the data and rejects remote database hosts.
func TestLeadOperationCapabilityReadOnlyIntegration(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("VIMOB_DASHBOARD_READONLY_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set VIMOB_DASHBOARD_READONLY_DATABASE_URL for the isolated read-only check")
	}
	parsedURL, err := url.Parse(databaseURL)
	if err != nil || (parsedURL.Hostname() != "127.0.0.1" && parsedURL.Hostname() != "localhost") {
		t.Fatal("lead capability integration requires a loopback QA database URL")
	}
	readID := func(name string) string {
		t.Helper()
		id, ok := normalizeUUID(strings.TrimSpace(os.Getenv(name)))
		if !ok {
			t.Fatalf("%s must be a UUID", name)
		}
		return id
	}
	organizationID := readID("VIMOB_DASHBOARD_AUDIT_ORGANIZATION_ID")
	pipelineID := readID("VIMOB_DASHBOARD_AUDIT_PIPELINE_ID")
	viewerIDs := map[string]string{
		"admin":  readID("VIMOB_DASHBOARD_AUDIT_ADMIN_ID"),
		"leader": readID("VIMOB_DASHBOARD_AUDIT_LEADER_ID"),
		"broker": readID("VIMOB_DASHBOARD_AUDIT_BROKER_ID"),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 1, ForceReadOnly: true, HealthTimeout: 8 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect read-only QA database: %v", err)
	}
	defer db.Close()
	var readOnly string
	if err := db.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil || readOnly != "on" {
		t.Fatalf("database session is not read-only: %v", err)
	}

	tenantRepo := tenant.NewRepository(db)
	repo := NewRepository(db, nil)
	for _, name := range []string{"admin", "leader", "broker"} {
		t.Run(name, func(t *testing.T) {
			viewer, err := tenantRepo.Resolve(ctx, viewerIDs[name], organizationID)
			if err != nil {
				t.Fatalf("resolve viewer: %v", err)
			}
			board, err := repo.GetPipelineBoard(ctx, viewer, PipelineBoardFilter{PipelineID: pipelineID, Limit: 12})
			if err != nil {
				t.Fatalf("initial board: %v", err)
			}
			listed, err := repo.List(ctx, viewer, ListFilter{Limit: 200})
			if err != nil {
				t.Fatalf("lead list: %v", err)
			}
			listCapabilities := make(map[string]bool, len(listed.Data))
			for _, lead := range listed.Data {
				if lead.CanOperate == nil {
					t.Fatal("list lead has no operation capability")
				}
				listCapabilities[lead.ID] = *lead.CanOperate
			}

			checked := 0
			for _, stage := range board {
				if len(stage.Leads) == 0 {
					continue
				}
				page, err := repo.ListPipelineStageLeads(ctx, viewer, PipelineBoardFilter{
					PipelineID: pipelineID, StageID: stage.ID, Limit: 12,
				})
				if err != nil {
					t.Fatalf("stage page: %v", err)
				}
				pageCapabilities := make(map[string]bool, len(page.Leads))
				for _, lead := range page.Leads {
					pageCapabilities[lead.ID] = lead.CanOperate
				}
				for _, card := range stage.Leads {
					detail, err := repo.Get(ctx, viewer, card.ID)
					if err != nil || detail.CanOperate == nil {
						t.Fatalf("lead detail %s missing capability: %v", card.ID, err)
					}
					if *detail.CanOperate != card.CanOperate {
						t.Fatalf("lead %s board/detail capability mismatch", card.ID)
					}
					if pageCapability, ok := pageCapabilities[card.ID]; !ok || pageCapability != card.CanOperate {
						t.Fatalf("lead %s initial/paginated board capability mismatch", card.ID)
					}
					if listCapability, ok := listCapabilities[card.ID]; !ok || listCapability != card.CanOperate {
						t.Fatalf("lead %s board/list capability mismatch", card.ID)
					}
					checked++
				}
			}
			if checked == 0 {
				t.Fatal("QA viewer has no board leads; capability projection was not exercised")
			}
			t.Logf("lead operation capability agrees across board, pagination, list, and detail for %d %s cards", checked, name)
		})
	}
}
