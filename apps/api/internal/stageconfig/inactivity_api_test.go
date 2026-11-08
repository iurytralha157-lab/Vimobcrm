package stageconfig

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func inactivityAPIRequestForTest(create bool) StageInactivityRequest {
	days, enabled, revision := 2, false, int64(0)
	request := StageInactivityRequest{
		TriggerDays: &days, IsEnabled: &enabled, AlertMessage: "  Revise este lead  ",
		Clock: InactivityClockLastInteraction, StartMode: InactivityStartAtActivation,
	}
	if create {
		request.StageID = "10000000-0000-4000-8000-000000000001"
	} else {
		request.ExpectedUpdatedAt = "2026-10-13T10:00:00.123456Z"
		request.ExpectedPolicyRevision = &revision
	}
	return request
}

func TestInactivityAPIRejectsAmbiguousWrites(t *testing.T) {
	for _, scenario := range []struct {
		name   string
		create bool
		change func(*StageInactivityRequest)
	}{
		{"missing days", true, func(r *StageInactivityRequest) { r.TriggerDays = nil }},
		{"zero days", true, func(r *StageInactivityRequest) { n := 0; r.TriggerDays = &n }},
		{"negative days", true, func(r *StageInactivityRequest) { n := -1; r.TriggerDays = &n }},
		{"excessive days", true, func(r *StageInactivityRequest) { n := 3651; r.TriggerDays = &n }},
		{"implicit enable", true, func(r *StageInactivityRequest) { r.IsEnabled = nil }},
		{"oversized message", true, func(r *StageInactivityRequest) { r.AlertMessage = strings.Repeat("á", 1001) }},
		{"unsupported clock", true, func(r *StageInactivityRequest) { r.Clock = InactivityClockStageEntry }},
		{"retroactive start", true, func(r *StageInactivityRequest) { r.StartMode = InactivityIncludeOverdue }},
		{"unknown start mode", true, func(r *StageInactivityRequest) { r.StartMode = "old_leads_now" }},
		{"missing stage", true, func(r *StageInactivityRequest) { r.StageID = "" }},
		{"invalid stage", true, func(r *StageInactivityRequest) { r.StageID = "other-stage" }},
		{"create with timestamp", true, func(r *StageInactivityRequest) { r.ExpectedUpdatedAt = "2026-10-13T10:00:00Z" }},
		{"create with policy revision", true, func(r *StageInactivityRequest) { n := int64(0); r.ExpectedPolicyRevision = &n }},
		{"update moves stage", false, func(r *StageInactivityRequest) { r.StageID = "10000000-0000-4000-8000-000000000002" }},
		{"update without policy revision", false, func(r *StageInactivityRequest) { r.ExpectedPolicyRevision = nil }},
		{"update with negative revision", false, func(r *StageInactivityRequest) { n := int64(-1); r.ExpectedPolicyRevision = &n }},
		{"update without timestamp", false, func(r *StageInactivityRequest) { r.ExpectedUpdatedAt = "" }},
		{"update with invalid timestamp", false, func(r *StageInactivityRequest) { r.ExpectedUpdatedAt = "yesterday" }},
		{"update with zero timestamp", false, func(r *StageInactivityRequest) { r.ExpectedUpdatedAt = "0001-01-01T00:00:00Z" }},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			request := inactivityAPIRequestForTest(scenario.create)
			scenario.change(&request)
			if _, err := request.Validate(scenario.create); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("ambiguous write accepted: %v", err)
			}
		})
	}
	for _, create := range []bool{true, false} {
		request := inactivityAPIRequestForTest(create)
		request.AlertMessage = strings.Repeat("á", 1000)
		input, err := request.Validate(create)
		if err != nil || len([]rune(input.Message)) != 1000 || input.Enabled || input.Days != 2 {
			t.Fatalf("valid explicit disabled request rejected: %#v %v", input, err)
		}
	}
}

func TestInactivityAPIValidatesAndPreservesEntryScope(t *testing.T) {
	now := time.Now().UTC()
	request := inactivityAPIRequestForTest(true)
	request.StartMode = InactivityNewStageEntries
	input, err := request.Validate(true)
	if err != nil || input.StartMode != InactivityNewStageEntries {
		t.Fatalf("entry scope was rejected: %#v %v", input, err)
	}
	current := nextInactivityPolicy(nil, time.Time{}, false, now, "first", input)
	current.Enabled, current.AutomationUpdatedAt = true, now

	request = inactivityAPIRequestForTest(false)
	request.StartMode = ""
	input, err = request.Validate(false)
	if err != nil {
		t.Fatal(err)
	}
	input.Enabled = true
	later := now.Add(time.Hour)
	policy := nextInactivityPolicy(&current, now, true, later, "second", input)
	if policy.StartMode != InactivityNewStageEntries || policy.Epoch != current.Epoch || !policy.ActivatedAt.Equal(now) {
		t.Fatalf("omitted scope changed the active policy: %#v", policy)
	}
	input.StartMode = InactivityStartAtActivation
	policy = nextInactivityPolicy(&current, now, true, later, "second", input)
	if policy.StartMode != InactivityStartAtActivation || policy.Epoch != "second" || !policy.ActivatedAt.Equal(later) {
		t.Fatalf("expanded scope did not start a full new clock: %#v", policy)
	}
}

func TestInactivityAPIRevisionRetainsDatabasePrecision(t *testing.T) {
	want := time.Date(2026, 10, 13, 10, 0, 0, 123456000, time.UTC)
	for _, raw := range []string{"2026-10-13T10:00:00.123456Z", "2026-10-13 07:00:00.123456-03:00", "2026-10-13 07:00:00.123456-03"} {
		got, err := parseInactivityRevision(raw)
		if err != nil || !got.Equal(want) {
			t.Fatalf("revision precision lost: %q %v %v", raw, got, err)
		}
	}
	request := inactivityAPIRequestForTest(false)
	input, err := request.Validate(false)
	if err != nil || !input.ExpectedUpdatedAt.Equal(want) || input.ExpectedPolicyRevision != 0 || input.Message != "Revise este lead" {
		t.Fatalf("validated CAS revision/message differs: %#v %v", input, err)
	}
}

func TestInactivityAPIPolicyRevisionConflictsFailClosed(t *testing.T) {
	if err := validateInactivityPolicyCAS(nil, 0); err != nil {
		t.Fatal(err)
	}
	policy := &StageInactivityPolicy{Revision: 7}
	if err := validateInactivityPolicyCAS(policy, 7); err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []struct {
		policy   *StageInactivityPolicy
		revision int64
	}{
		{nil, 1}, {policy, 0}, {policy, 6}, {policy, 8},
	} {
		if err := validateInactivityPolicyCAS(scenario.policy, scenario.revision); !errors.Is(err, ErrInactivityConfigurationChanged) {
			t.Fatalf("stale CAS accepted: %v", err)
		}
	}
}

func TestInactivityAPIViewRequiresEnabledEffectiveAndAvailable(t *testing.T) {
	for _, enabled := range []bool{false, true} {
		for _, effective := range []bool{false, true} {
			for _, available := range []bool{false, true} {
				policy := StageInactivityPolicy{Enabled: enabled, Revision: 4}
				view := inactivityPolicyView(policy, effective, available)
				if view.IsEnabled != enabled || view.RuntimeAvailable != available || view.EffectiveEnabled != (enabled && effective && available) || view.Revision != 4 {
					t.Fatalf("view conflates saved configuration with runtime: %#v", view)
				}
			}
		}
	}
}

func TestInactivityAPIContinuousEditsPreserveEpisodeAndReactivationResetsIt(t *testing.T) {
	now := time.Date(2026, 10, 13, 10, 0, 0, 0, time.UTC)
	activation, version := now.Add(-time.Hour), now.Add(-time.Minute)
	current := StageInactivityPolicy{Enabled: true, Epoch: "existing-epoch", Revision: 7,
		Clock: InactivityClockLastInteraction, StartMode: InactivityStartAtActivation,
		ActivatedAt: activation, InteractionCoverageFrom: &activation, AutomationUpdatedAt: version}
	input := stageInactivityInput{Enabled: true, Days: 3, Message: "Updated threshold"}
	continuous := nextInactivityPolicy(&current, version, true, now, "new-epoch", input)
	if continuous.Epoch != current.Epoch || !continuous.ActivatedAt.Equal(activation) || continuous.InteractionCoverageFrom != current.InteractionCoverageFrom || continuous.Revision != 8 || continuous.Days != 3 {
		t.Fatalf("continuous edit repeated episode: %#v", continuous)
	}
	for _, scenario := range []struct {
		name     string
		current  StageInactivityPolicy
		previous time.Time
		active   bool
	}{
		{"disabled externally", current, version, false},
		{"changed externally", current, version.Add(time.Second), true},
		{"policy disabled", func() StageInactivityPolicy { p := current; p.Enabled = false; return p }(), version, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			got := nextInactivityPolicy(&scenario.current, scenario.previous, scenario.active, now, "new-epoch", input)
			if got.Epoch != "new-epoch" || !got.ActivatedAt.Equal(now) || got.InteractionCoverageFrom == nil || !got.InteractionCoverageFrom.Equal(now) {
				t.Fatalf("reactivation retained old coverage: %#v", got)
			}
		})
	}
}

func TestInactivityAPIHandlersRejectInvalidRequestsBeforeDatabase(t *testing.T) {
	actor := tenant.Context{OrganizationID: "10000000-0000-4000-8000-000000000001", UserID: "10000000-0000-4000-8000-000000000002", MemberRole: "admin", EnabledModules: []string{"automations"}}
	for _, scenario := range []struct {
		name  string
		body  string
		actor *tenant.Context
		want  int
	}{
		{"missing organization", "{}", nil, http.StatusForbidden},
		{"malformed JSON", "{", &actor, http.StatusBadRequest},
		{"unknown field", `{"unsafe_override":true}`, &actor, http.StatusBadRequest},
		{"multiple values", "{} {}", &actor, http.StatusBadRequest},
		{"oversized body", `{"alert_message":"` + strings.Repeat("x", 17000) + `"}`, &actor, http.StatusBadRequest},
		{"missing contract", "{}", &actor, http.StatusBadRequest},
	} {
		for _, handler := range []func(http.ResponseWriter, *http.Request){(Handler{}).CreateInactivityAutomation, (Handler{}).UpdateInactivityAutomation} {
			t.Run(scenario.name, func(t *testing.T) {
				request := httptest.NewRequest(http.MethodPost, "/stage-config/inactivity", strings.NewReader(scenario.body))
				if scenario.actor != nil {
					request = request.WithContext(tenant.ContextWithTenant(request.Context(), *scenario.actor))
				}
				response := httptest.NewRecorder()
				handler(response, request)
				if response.Code != scenario.want {
					t.Fatalf("invalid request reached database: %d %s", response.Code, response.Body.String())
				}
			})
		}
	}
}

func TestInactivityAPIRepositoryGuardsRequireModuleAndExplicitRuntime(t *testing.T) {
	actor := tenant.Context{OrganizationID: "10000000-0000-4000-8000-000000000001", UserID: "10000000-0000-4000-8000-000000000002", MemberRole: "admin", EnabledModules: []string{"automations"}}
	request := inactivityAPIRequestForTest(false)
	input, err := request.Validate(false)
	if err != nil {
		t.Fatal(err)
	}
	input.Enabled = true
	for _, scenario := range []struct {
		name  string
		actor tenant.Context
		id    string
		want  error
	}{
		{"create enabled", actor, "", ErrInvalidInput},
		{"runtime disabled", actor, "10000000-0000-4000-8000-000000000003", ErrInactivityRuntimeNotReady},
		{"module absent", func() tenant.Context { a := actor; a.EnabledModules = nil; return a }(), "", tenant.ErrOrganizationAccessDenied},
		{"permission absent", func() tenant.Context { a := actor; a.MemberRole = "broker"; return a }(), "", tenant.ErrOrganizationAccessDenied},
		{"invalid tenant", func() tenant.Context { a := actor; a.OrganizationID = "invalid"; return a }(), "", tenant.ErrOrganizationAccessDenied},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if _, err := (Repository{}).SaveInactivityAutomation(context.Background(), scenario.actor, scenario.id, input); !errors.Is(err, scenario.want) {
				t.Fatalf("guard accepted write without database: %v", err)
			}
		})
	}
	repo := Repository{}
	if available, err := repo.InactivityRuntimeAvailable(context.Background()); available || err != nil {
		t.Fatalf("default runtime is available: %v %v", available, err)
	}
	if repo.WithStageInactivityRuntime(true).inactivityRuntimeEnabled != true || repo.inactivityRuntimeEnabled {
		t.Fatal("runtime option mutated disabled original repository")
	}
}

func TestInactivityAPIErrorEnvelopePreservesConflictAndUnavailable(t *testing.T) {
	for _, scenario := range []struct {
		err    error
		status int
		code   string
	}{
		{ErrInactivityConfigurationChanged, http.StatusConflict, "stage_inactivity_changed"},
		{ErrInactivityRuntimeNotReady, http.StatusServiceUnavailable, "stage_inactivity_unavailable"},
	} {
		response := httptest.NewRecorder()
		writeStageConfigError(response, httptest.NewRequest(http.MethodPost, "/", nil), scenario.err)
		var body struct {
			Error struct {
				Code string `json:"code"`
			} `json:"error"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || response.Code != scenario.status || body.Error.Code != scenario.code {
			t.Fatalf("error contract changed: %d %s %v", response.Code, response.Body.String(), err)
		}
	}
}
