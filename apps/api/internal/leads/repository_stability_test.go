package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type nullableRequiredTextRow struct {
	textIndexes []int
}

func (row nullableRequiredTextRow) Scan(destinations ...any) error {
	for _, index := range row.textIndexes {
		if index < 0 || index >= len(destinations) {
			return fmt.Errorf("nullable text destination %d is out of range", index)
		}
		if _, ok := destinations[index].(*pgtype.Text); !ok {
			return fmt.Errorf("destination %d has type %T, want *pgtype.Text", index, destinations[index])
		}
	}

	for index, destination := range destinations {
		value := reflect.ValueOf(destination)
		if value.Kind() != reflect.Pointer || value.IsNil() {
			return fmt.Errorf("destination %d has type %T, want non-nil pointer", index, destination)
		}
		value.Elem().Set(reflect.Zero(value.Elem().Type()))
	}
	return nil
}

func TestScanPipelineBoardLeadDefaultsNullableRequiredText(t *testing.T) {
	lead, _, err := scanPipelineBoardLead(nullableRequiredTextRow{
		textIndexes: []int{4, 18}, // source and deal_status
	}, false)
	if err != nil {
		t.Fatalf("scan pipeline board lead: %v", err)
	}
	if lead.Source != "manual" {
		t.Fatalf("source = %q, want manual", lead.Source)
	}
	if lead.DealStatus != "open" {
		t.Fatalf("deal status = %q, want open", lead.DealStatus)
	}
}

func TestScanLeadDefaultsNullableRequiredText(t *testing.T) {
	lead, err := scanLead(nullableRequiredTextRow{
		textIndexes: []int{5, 6, 7}, // source, status and deal_status
	})
	if err != nil {
		t.Fatalf("scan lead: %v", err)
	}
	if lead.Source != "manual" {
		t.Fatalf("source = %q, want manual", lead.Source)
	}
	if lead.Status != "new" {
		t.Fatalf("status = %q, want new", lead.Status)
	}
	if lead.DealStatus != "open" {
		t.Fatalf("deal status = %q, want open", lead.DealStatus)
	}
}

type leadAvatarRow struct {
	legacyURL   string
	storagePath string
	syncedAt    time.Time
}

func (row leadAvatarRow) Scan(destinations ...any) error {
	if len(destinations) < 9 {
		return fmt.Errorf("lead scan has %d destinations, want at least 9", len(destinations))
	}

	for index, destination := range destinations {
		value := reflect.ValueOf(destination)
		if value.Kind() != reflect.Pointer || value.IsNil() {
			return fmt.Errorf("destination %d has type %T, want non-nil pointer", index, destination)
		}
		value.Elem().Set(reflect.Zero(value.Elem().Type()))
	}

	legacyAvatarURL, ok := destinations[len(destinations)-10].(*pgtype.Text)
	if !ok {
		return fmt.Errorf("legacy avatar URL destination has type %T, want *pgtype.Text", destinations[len(destinations)-10])
	}
	avatarStoragePath, ok := destinations[len(destinations)-9].(*pgtype.Text)
	if !ok {
		return fmt.Errorf("avatar storage path destination has type %T, want *pgtype.Text", destinations[len(destinations)-9])
	}
	avatarSyncedAt, ok := destinations[len(destinations)-8].(*pgtype.Timestamptz)
	if !ok {
		return fmt.Errorf("avatar sync destination has type %T, want *pgtype.Timestamptz", destinations[len(destinations)-8])
	}
	*legacyAvatarURL = pgtype.Text{String: row.legacyURL, Valid: true}
	*avatarStoragePath = pgtype.Text{String: row.storagePath, Valid: true}
	*avatarSyncedAt = pgtype.Timestamptz{Time: row.syncedAt, Valid: true}
	if total, ok := destinations[0].(*int64); ok {
		*total = 1
	}

	return nil
}

func TestScanLeadWithTotalKeepsOnlyDurableWhatsAppAvatarReference(t *testing.T) {
	syncedAt := time.Date(2026, time.September, 20, 15, 30, 0, 0, time.UTC)
	storagePath := "orgs/22222222-2222-4222-8222-222222222222/profile-pictures/11111111-1111-4111-8111-111111111111/avatar.jpg"
	lead, total, err := scanLeadWithTotal(leadAvatarRow{
		legacyURL:   "https://pps.whatsapp.net/legacy.jpg",
		storagePath: storagePath,
		syncedAt:    syncedAt,
	})
	if err != nil {
		t.Fatalf("scan lead with avatar: %v", err)
	}
	if total != 1 {
		t.Fatalf("total = %d, want 1", total)
	}
	if lead.WhatsAppAvatarURL != nil {
		t.Fatalf("legacy avatar URL leaked from scanner: %#v", lead.WhatsAppAvatarURL)
	}
	if lead.WhatsAppAvatarStoragePath == nil || *lead.WhatsAppAvatarStoragePath != storagePath {
		t.Fatalf("avatar storage path = %#v, want %q", lead.WhatsAppAvatarStoragePath, storagePath)
	}
	if lead.WhatsAppAvatarSyncedAt == nil || !lead.WhatsAppAvatarSyncedAt.Equal(syncedAt) {
		t.Fatalf("avatar synced at = %#v, want %s", lead.WhatsAppAvatarSyncedAt, syncedAt)
	}

	payload, err := json.Marshal(lead)
	if err != nil {
		t.Fatalf("marshal lead: %v", err)
	}
	var response map[string]any
	if err := json.Unmarshal(payload, &response); err != nil {
		t.Fatalf("unmarshal lead response: %v", err)
	}
	if _, exists := response["whatsappAvatarUrl"]; exists {
		t.Fatalf("legacy avatar URL was serialized: %#v", response["whatsappAvatarUrl"])
	}
	if strings.Contains(string(payload), storagePath) || strings.Contains(string(payload), "whatsappAvatarStoragePath") {
		t.Fatalf("internal avatar storage path was serialized: %s", payload)
	}
	if response["whatsappAvatarSyncedAt"] != syncedAt.Format(time.RFC3339) {
		t.Fatalf("response avatar synced at = %#v, want %q", response["whatsappAvatarSyncedAt"], syncedAt.Format(time.RFC3339))
	}

	fields := leadSelectFields()
	if !strings.Contains(fields, "l.whatsapp_avatar_url") ||
		!strings.Contains(fields, "l.whatsapp_avatar_storage_path") ||
		!strings.Contains(fields, "l.whatsapp_avatar_synced_at") {
		t.Fatalf("lead select fields do not include the avatar read model columns: %s", fields)
	}
}

func TestTextValueWithDefaultRejectsBlankDatabaseValues(t *testing.T) {
	if got := textValueWithDefault(pgtype.Text{String: "   ", Valid: true}, "open"); got != "open" {
		t.Fatalf("blank value = %q, want open", got)
	}
	if got := textValueWithDefault(pgtype.Text{String: "won", Valid: true}, "open"); got != "won" {
		t.Fatalf("non-blank value = %q, want won", got)
	}
}

type assignmentValidationQueryer struct {
	exists  bool
	queries int
}

func (queryer *assignmentValidationQueryer) QueryRow(context.Context, string, ...any) pgx.Row {
	queryer.queries++
	return assignmentValidationBoolRow{value: queryer.exists}
}

type assignmentValidationBoolRow struct {
	value bool
}

func (row assignmentValidationBoolRow) Scan(destinations ...any) error {
	*(destinations[0].(*bool)) = row.value
	return nil
}

func TestAssignmentValidatorsUseProvidedQueryer(t *testing.T) {
	repository := Repository{} // A pool access would panic; only the supplied queryer is valid here.
	organizationID := "11111111-1111-4111-8111-111111111111"
	userID := "22222222-2222-4222-8222-222222222222"
	teamID := "33333333-3333-4333-8333-333333333333"
	queryer := &assignmentValidationQueryer{exists: true}

	if err := repository.validateAssignedUser(context.Background(), queryer, organizationID, &userID); err != nil {
		t.Fatalf("validate assigned user: %v", err)
	}
	if err := repository.validateLeadTeam(context.Background(), queryer, tenant.Context{
		OrganizationID: organizationID,
		IsSuperAdmin:   true,
	}, &teamID); err != nil {
		t.Fatalf("validate lead team: %v", err)
	}
	if queryer.queries != 2 {
		t.Fatalf("queries = %d, want 2", queryer.queries)
	}
}

func TestTransactionalAssignmentValidationUsesCurrentTransaction(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	source := string(raw)
	required := []string{
		"repo.validateAssignedUser(ctx, tx, tenantContext.OrganizationID, input.AssignedUserID.Value)",
		"repo.validateLeadTeam(ctx, tx, tenantContext, input.TeamID.Value)",
		"repo.validateAssignedUser(ctx, tx, tenantContext.OrganizationID, input.AssignedUserID)",
	}
	for _, call := range required {
		if !strings.Contains(source, call) {
			t.Fatalf("transactional validation call %q is missing", call)
		}
	}
}
