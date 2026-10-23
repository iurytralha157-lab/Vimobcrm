package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type localTagCatalogTenantResolver struct {
	repository tenant.Repository
	calls      int
}

func (resolver *localTagCatalogTenantResolver) Resolve(ctx context.Context, userID, organizationID string) (tenant.Context, error) {
	resolver.calls++
	return resolver.repository.Resolve(ctx, userID, organizationID)
}

// Signed synthetic JWT + actual route registration, session SQL, tenant SQL
// and tag SQL. This never contacts a real Supabase Auth service or production.
func TestLocalTagCatalogWithRealActiveSession(t *testing.T) {
	database := openLocalTagCatalogDatabase(t)
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	suffix := fmt.Sprintf("wa-tags-session-%d", time.Now().UnixNano())
	var organizationID, userID, sessionID, tagID string
	if err := database.Pool().QueryRow(ctx, `select gen_random_uuid()::text,gen_random_uuid()::text,gen_random_uuid()::text`).Scan(&organizationID, &userID, &sessionID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, done := context.WithTimeout(context.Background(), 10*time.Second)
		defer done()
		if _, err := database.Pool().Exec(cleanup, `
			delete from public.tags where organization_id=$1::uuid;
			delete from public.organization_members where organization_id=$1::uuid;
			delete from public.users where id=$2::uuid;
			delete from auth.users where id=$2::uuid;
			delete from public.organizations where id=$1::uuid`, organizationID, userID); err != nil {
			t.Errorf("cleanup synthetic tag session fixture: %v", err)
		}
	})
	if _, err := database.Pool().Exec(ctx, `
		insert into public.organizations(id,name,slug,is_active,subscription_type,subscription_status)
		values($1::uuid,$3,$3,true,'free','active');
		insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,
		 raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
		values($2::uuid,'authenticated','authenticated',$4,'',now(),'{}'::jsonb,'{}'::jsonb,now(),now());
		insert into public.users(id,organization_id,name,email,role,is_active)
		values($2::uuid,$1::uuid,'Synthetic tag member',$4,'user',true)
		on conflict(id) do update set organization_id=excluded.organization_id,
		 name=excluded.name,email=excluded.email,role=excluded.role,is_active=true;
		insert into public.organization_members(organization_id,user_id,role,is_active)
		values($1::uuid,$2::uuid,'user',true)
		on conflict(user_id,organization_id) do update set role='user',is_active=true,deleted_at=null;
		insert into auth.sessions(id,user_id,created_at,updated_at) values($5::uuid,$2::uuid,now(),now())`,
		organizationID, userID, suffix, suffix+"@example.invalid", sessionID); err != nil {
		t.Fatal(err)
	}
	if err := database.Pool().QueryRow(ctx, `insert into public.tags(organization_id,name,color)
		values($1::uuid,'Synthetic catalogue','#22c55e') returning id::text`, organizationID).Scan(&tagID); err != nil {
		t.Fatal(err)
	}
	resolver := &localTagCatalogTenantResolver{repository: tenant.NewRepository(database)}
	member, err := resolver.repository.Resolve(ctx, userID, organizationID)
	if err != nil {
		t.Fatal(err)
	}
	if member.UserID != userID || member.OrganizationID != organizationID || member.HasPermission(permissions.TagManage) {
		t.Fatal("fixture must resolve a real active member without tag_manage")
	}
	verifier, err := authpkg.NewVerifier(ctx, authpkg.Config{ProjectURL: "https://example.supabase.co", JWTSecret: routeGuardTestSecret})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(verifier.Close)
	mux := http.NewServeMux()
	registerRoutes(mux, routeDependencies{
		authVerifier: verifier, activeSessionChecker: postgresActiveSessionChecker{database: database},
		tenantRepository: resolver, leadsHandler: leads.NewHandler(leads.NewRepository(database, nil)),
		metaOAuthCallbackHandler: func(http.ResponseWriter, *http.Request) {},
	})
	token := leadReadCanaryToken(t, userID, sessionID, "password")
	beforeResolve := resolver.calls
	response := tagCatalogRouteRequest(mux, http.MethodGet, "/v1/tags?view=catalog", token, organizationID)
	var catalogue struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if response.Code != http.StatusOK || resolver.calls != beforeResolve+1 || json.Unmarshal(response.Body.Bytes(), &catalogue) != nil ||
		len(catalogue.Data) != 1 || catalogue.Data[0].ID != tagID {
		t.Fatalf("real active-session catalogue status=%d tenant calls=%d body=%s", response.Code, resolver.calls-beforeResolve, response.Body.String())
	}
	deniedWrite := tagCatalogRouteRequest(mux, http.MethodPost, "/v1/tags", token, organizationID)
	if deniedWrite.Code != http.StatusForbidden || !strings.Contains(deniedWrite.Body.String(), `"code":"permission_denied"`) {
		t.Fatalf("member without tag_manage write status=%d body=%s", deniedWrite.Code, deniedWrite.Body.String())
	}
	if _, err := database.Pool().Exec(ctx, `delete from auth.sessions where id=$1::uuid and user_id=$2::uuid`, sessionID, userID); err != nil {
		t.Fatal(err)
	}
	beforeResolve = resolver.calls
	for _, method := range []string{http.MethodGet, http.MethodHead} {
		response := tagCatalogRouteRequest(mux, method, "/v1/tags?view=catalog", token, organizationID)
		if response.Code != http.StatusUnauthorized || resolver.calls != beforeResolve ||
			!strings.Contains(response.Body.String(), `"code":"session_revoked"`) || strings.Contains(response.Body.String(), tagID) {
			t.Fatalf("revoked real session status=%d tenant calls=%d body=%s", response.Code, resolver.calls-beforeResolve, response.Body.String())
		}
	}
	var tags, associations, outbox int
	if err := database.Pool().QueryRow(ctx, `select
		(select count(*) from public.tags where organization_id=$1::uuid),
		(select count(*) from public.lead_tags where organization_id=$1::uuid),
		(select count(*) from public.whatsapp_outbox where organization_id=$1::uuid)`, organizationID).Scan(&tags, &associations, &outbox); err != nil {
		t.Fatal(err)
	}
	if tags != 1 || associations != 0 || outbox != 0 {
		t.Fatalf("catalogue/revoked requests changed fixture state: tags=%d associations=%d outbox=%d", tags, associations, outbox)
	}
}

func openLocalTagCatalogDatabase(t *testing.T) *dbpkg.Postgres {
	t.Helper()
	const root = "D:/Vimob/tmp/whatsapp-db-validation-20261013"
	const marker = "whatsapp-native-20261013:57922:vimob_whatsapp_clone"
	if os.Getenv("VIMOB_RUN_WHATSAPP_SEND_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("explicit dedicated local database fixture opt-in is absent")
	}
	if os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") != marker ||
		filepath.Clean(os.Getenv("VIMOB_LOCAL_WHATSAPP_NATIVE_RUNTIME")) != filepath.Clean(root+"/native-runtime.json") {
		t.Fatal("dedicated native database proof is missing")
	}
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_EPOCH1_TEST_DATABASE_URL"))
	u, err := url.Parse(databaseURL)
	if err != nil || u.User == nil || u.User.Username() != "postgres" ||
		(u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() != "127.0.0.1" ||
		u.Port() != "57922" || u.Path != "/vimob_whatsapp_clone" || u.Fragment != "" {
		t.Fatal("dedicated local database URL is invalid")
	}
	query, err := url.ParseQuery(u.RawQuery)
	if err != nil || len(query) != 1 || len(query["sslmode"]) != 1 || query.Get("sslmode") != "disable" {
		t.Fatal("connection override parameters are forbidden")
	}
	var proof struct {
		Kind, Marker, Database string
		Actual                 struct {
			SystemIdentifier, DataDirectory, Port, ListenAddresses, ServerAddress, Fsync, SynchronousCommit string
		}
	}
	encoded, err := os.ReadFile(root + "/native-runtime.json")
	if err != nil || len(encoded) > 65536 || json.Unmarshal(encoded, &proof) != nil ||
		proof.Kind != "vimob-whatsapp-native-test" || proof.Marker != marker || proof.Database != "vimob_whatsapp_clone" ||
		proof.Actual.SystemIdentifier != "7696313589555176164" || filepath.Clean(proof.Actual.DataDirectory) != filepath.Clean(root+"/data") ||
		proof.Actual.Port != "57922" || proof.Actual.ListenAddresses != "127.0.0.1" || proof.Actual.Fsync != "on" || proof.Actual.SynchronousCommit != "on" {
		t.Fatal("dedicated native runtime manifest is invalid")
	}
	ctx, cancel := context.WithTimeout(t.Context(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	var systemID, directory, address, port, fsync, synchronous, listen string
	if err := database.Pool().QueryRow(ctx, `select system_identifier::text,current_setting('data_directory'),
		host(inet_server_addr()),inet_server_port()::text,current_setting('fsync'),current_setting('synchronous_commit'),
		current_setting('listen_addresses') from pg_control_system()`).Scan(&systemID, &directory, &address, &port, &fsync, &synchronous, &listen); err != nil ||
		systemID != proof.Actual.SystemIdentifier || filepath.Clean(directory) != filepath.Clean(root+"/data") || address != "127.0.0.1" ||
		port != "57922" || listen != "127.0.0.1" || fsync != "on" || synchronous != "on" {
		t.Fatal("connected cluster does not match the dedicated native runtime")
	}
	return database
}
