package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/whatsapp"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

type localWhatsAppRouteSessionChecker struct {
	checker postgresActiveSessionChecker
	calls   int
}

func (checker *localWhatsAppRouteSessionChecker) IsActive(ctx context.Context, userID, sessionID string) (bool, error) {
	checker.calls++
	return checker.checker.IsActive(ctx, userID, sessionID)
}

// Reuse the existing exact-loopback, manifest and actual-cluster identity
// guard. Signed JWT, active-session SQL, tenant SQL and conversation SQL are
// real; all fixture identities are synthetic. No Storage/provider call occurs.
func TestLocalWhatsAppRoutesWithRealActiveSession(t *testing.T) {
	database := openLocalTagCatalogDatabase(t)
	ctx, cancel := context.WithTimeout(t.Context(), 45*time.Second)
	defer cancel()
	suffix := fmt.Sprintf("wa-route-session-%d", time.Now().UnixNano())
	var organizationA, organizationB, userA, userB, sessionA, sessionB string
	if err := database.Pool().QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text,
	 gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text`).
		Scan(&organizationA, &organizationB, &userA, &userB, &sessionA, &sessionB); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, err := database.Pool().Exec(cleanup, `
		 delete from public.organization_modules where organization_id in ($1::uuid,$2::uuid);
		 delete from public.organization_members where organization_id in ($1::uuid,$2::uuid);
		 delete from public.users where id in ($3::uuid,$4::uuid);
		 delete from auth.users where id in ($3::uuid,$4::uuid);
		 delete from public.organizations where id in ($1::uuid,$2::uuid)`, organizationA, organizationB, userA, userB); err != nil {
			t.Errorf("cleanup synthetic WhatsApp session fixture: %v", err)
		}
	})
	for _, actor := range []struct {
		organization, user, session, name string
	}{{organizationA, userA, sessionA, suffix + "-a"}, {organizationB, userB, sessionB, suffix + "-b"}} {
		if _, err := database.Pool().Exec(ctx, `
		 insert into public.organizations(id,name,slug,is_active,subscription_type,subscription_status)
		 values($1::uuid,$4,$4,true,'free','active');
		 insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
		 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		 values($2::uuid,'authenticated','authenticated',$5,'',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
		 insert into public.users(id,organization_id,name,email,role,is_active)
		 values($2::uuid,$1::uuid,$4,$5,'admin',true)
		 on conflict(id) do update set organization_id=excluded.organization_id,
		 name=excluded.name,email=excluded.email,role='admin',is_active=true;
		 insert into public.organization_members(organization_id,user_id,role,is_active)
		 values($1::uuid,$2::uuid,'admin',true)
		 on conflict(user_id,organization_id) do update set role='admin',is_active=true,deleted_at=null;
		 insert into public.organization_modules(organization_id,module_name,is_enabled)
		 values($1::uuid,'whatsapp',true)
		 on conflict(organization_id,module_name) do update set is_enabled=true;
		 insert into auth.sessions(id,user_id,created_at,updated_at)
		 values($3::uuid,$2::uuid,now(),now())`, actor.organization, actor.user, actor.session, actor.name, actor.name+"@example.invalid"); err != nil {
			t.Fatal(err)
		}
	}
	resolver := &localTagCatalogTenantResolver{repository: tenant.NewRepository(database)}
	for _, actor := range []struct{ user, organization string }{{userA, organizationA}, {userB, organizationB}} {
		member, err := resolver.repository.Resolve(ctx, actor.user, actor.organization)
		if err != nil || member.UserID != actor.user || member.OrganizationID != actor.organization ||
			!member.HasModule("whatsapp") || !member.HasPermission(permissions.WhatsAppView) {
			t.Fatalf("fixture must resolve real authorized WhatsApp member: member=%+v err=%v", member, err)
		}
	}
	verifier, err := authpkg.NewVerifier(ctx, authpkg.Config{ProjectURL: "https://example.supabase.co", JWTSecret: routeGuardTestSecret})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(verifier.Close)
	checker := &localWhatsAppRouteSessionChecker{checker: postgresActiveSessionChecker{database: database}}
	mux := http.NewServeMux()
	registerRoutes(mux, routeDependencies{
		authVerifier: verifier, activeSessionChecker: checker, tenantRepository: resolver,
		whatsappHandler:          whatsapp.NewHandler(whatsapp.NewRepository(database, nil, whatsapp.StorageConfig{})),
		metaOAuthCallbackHandler: func(http.ResponseWriter, *http.Request) {},
	})
	tokenA, tokenB := leadReadCanaryToken(t, userA, sessionA, "password"), leadReadCanaryToken(t, userB, sessionB, "password")
	for _, actor := range []struct{ name, token, organization string }{{"A", tokenA, organizationA}, {"B", tokenB, organizationB}} {
		t.Run("active "+actor.name+" reaches canonical conversation SQL", func(t *testing.T) {
			beforeChecks, beforeResolves := checker.calls, resolver.calls
			// Real list parsing needs a valid limit rather than the deliberately
			// invalid limit used by the early-boundary request helper.
			request := tagCatalogRouteRequest(mux, http.MethodGet, "/v1/whatsapp/conversations?includeMediaURLs=true&limit=10", actor.token, actor.organization)
			var response struct {
				Data []json.RawMessage `json:"data"`
			}
			if request.Code != http.StatusOK || checker.calls-beforeChecks != 1 || resolver.calls-beforeResolves != 1 ||
				json.Unmarshal(request.Body.Bytes(), &response) != nil || len(response.Data) != 0 {
				t.Fatalf("real active list status=%d checks=%d tenant calls=%d body=%s", request.Code, checker.calls-beforeChecks, resolver.calls-beforeResolves, request.Body.String())
			}
		})
		t.Run("active "+actor.name+" reaches media UUID guard", func(t *testing.T) {
			response := whatsappSessionRouteRequest(mux, whatsappSessionRoute{http.MethodGet, "/v1/whatsapp/messages/not-a-uuid/media-url"}, actor.token, actor.organization)
			if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"code":"whatsapp_message_not_found"`) {
				t.Fatalf("real active media UUID guard status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
	for _, scenario := range []struct{ name, token, organization string }{
		{"A cannot request B", tokenA, organizationB}, {"B cannot request A", tokenB, organizationA},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			response := whatsappSessionRouteRequest(mux, whatsappSessionRoute{http.MethodGet, "/v1/whatsapp/conversations"}, scenario.token, scenario.organization)
			if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"organization_access_denied"`) {
				t.Fatalf("real original membership guard status=%d body=%s", response.Code, response.Body.String())
			}
		})
	}
	wrongSubject := leadReadCanaryToken(t, userB, sessionA, "password")
	beforeResolves := resolver.calls
	response := whatsappSessionRouteRequest(mux, whatsappSessionRoute{http.MethodGet, "/v1/whatsapp/conversations"}, wrongSubject, organizationB)
	if response.Code != http.StatusUnauthorized || resolver.calls != beforeResolves || !strings.Contains(response.Body.String(), `"code":"session_revoked"`) {
		t.Fatalf("real SID belonged to another user: status=%d tenant calls=%d body=%s", response.Code, resolver.calls-beforeResolves, response.Body.String())
	}
	if result, err := database.Pool().Exec(ctx, `delete from auth.sessions where id=$1::uuid and user_id=$2::uuid`, sessionA, userA); err != nil || result.RowsAffected() != 1 {
		t.Fatalf("revoke exactly the fixture session: rows=%d err=%v", result.RowsAffected(), err)
	}
	for _, route := range whatsappJWTSessionRoutes(t, true) {
		t.Run("revoked real SID "+route.method+" "+route.path, func(t *testing.T) {
			beforeChecks, beforeResolves := checker.calls, resolver.calls
			response := whatsappSessionRouteRequest(mux, route, tokenA, organizationA)
			if response.Code != http.StatusUnauthorized || checker.calls-beforeChecks != 1 || resolver.calls != beforeResolves ||
				!strings.Contains(response.Body.String(), `"code":"session_revoked"`) || strings.Contains(response.Body.String(), `"data"`) {
				t.Fatalf("revoked real SID status=%d checks=%d tenant calls=%d body=%s", response.Code, checker.calls-beforeChecks, resolver.calls-beforeResolves, response.Body.String())
			}
		})
	}
	var outbox, messages, waSessions, remainingAuthSessions int
	if err := database.Pool().QueryRow(ctx, `select
	 (select count(*) from public.whatsapp_outbox where organization_id in ($1::uuid,$2::uuid)),
	 (select count(*) from public.whatsapp_messages where organization_id in ($1::uuid,$2::uuid)),
	 (select count(*) from public.whatsapp_sessions where organization_id in ($1::uuid,$2::uuid)),
	 (select count(*) from auth.sessions where user_id in ($3::uuid,$4::uuid))`, organizationA, organizationB, userA, userB).
		Scan(&outbox, &messages, &waSessions, &remainingAuthSessions); err != nil {
		t.Fatal(err)
	}
	if outbox != 0 || messages != 0 || waSessions != 0 || remainingAuthSessions != 1 {
		t.Fatalf("rejected API routes changed fixture state: outbox=%d messages=%d WA sessions=%d remaining auth sessions=%d", outbox, messages, waSessions, remainingAuthSessions)
	}
}
