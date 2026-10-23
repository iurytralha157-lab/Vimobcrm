package admin

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Exercise the same relational purge called by DeleteOrganization after its
// external cleanups. This fixture has no provider connections/files and makes
// no network calls outside the exact, label-verified disposable PostgreSQL.
func TestLocalOrganizationPurgePreservesAccountDeviceRegisteredInDeletedTenant(t *testing.T) {
	if os.Getenv("VIMOB_RUN_WHATSAPP_SEND_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("disposable local clone opt-in is required")
	}
	if os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") != "whatsapp-20261011:57922:vimob_whatsapp_clone" {
		t.Fatal("exact disposable Docker label verification is required")
	}
	dsn := os.Getenv("WHATSAPP_EPOCH1_TEST_DATABASE_URL")
	u, err := url.Parse(dsn)
	if err != nil || u.User == nil || u.User.Username() != "postgres" || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() != "127.0.0.1" || u.Port() != "57922" || u.Path != "/vimob_whatsapp_clone" {
		t.Fatal("organization fixture accepts only exact loopback clone57922")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: dsn, MaxConns: 4, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var database string
	if err := db.Pool().QueryRow(ctx, `select current_database()`).Scan(&database); err != nil || database != "vimob_whatsapp_clone" {
		t.Fatalf("wrong disposable database %q %v", database, err)
	}
	var originalOrg, registrationOrg, actor, device string
	suffix := fmt.Sprintf("org-device-%d", time.Now().UnixNano())
	if err := db.Pool().QueryRow(ctx, `insert into public.organizations(name,slug,is_active) values($1,$1,true) returning id::text`, suffix+"-original").Scan(&originalOrg); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.organizations(name,slug,is_active) values($1,$1,true) returning id::text`, suffix+"-registration").Scan(&registrationOrg); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := db.Pool().Exec(cleanup, `delete from public.push_tokens where id=nullif($1,'')::uuid;update public.users set organization_id=null where organization_id=any($2::uuid[]);delete from public.organizations where id=any($2::uuid[]);delete from public.users where id=nullif($3,'')::uuid;delete from auth.users where id=nullif($3,'')::uuid`, device, []string{originalOrg, registrationOrg}, actor); err != nil {
			t.Error(err)
		}
	}()
	if err := db.Pool().QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&actor); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Pool().Exec(ctx, `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values($1::uuid,'authenticated','authenticated',$2,'',now(),'{}','{}',now(),now());
 insert into public.users(id,organization_id,name,email,role,is_active) values($1::uuid,$3::uuid,'Synthetic account',$2,'user',true)
 on conflict(id) do update set organization_id=excluded.organization_id,role='user',is_active=true;
 insert into public.organization_members(organization_id,user_id,role,is_active) values($3::uuid,$1::uuid,'user',true),($4::uuid,$1::uuid,'user',true)`, actor, suffix+"@example.test", originalOrg, registrationOrg); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.push_tokens(organization_id,user_id,token,platform,is_active) values($1::uuid,$2::uuid,$3,'web',true) returning id::text`, registrationOrg, actor, suffix+"-device").Scan(&device); err != nil {
		t.Fatal(err)
	}
	repo := Repository{db: db}
	if err := repo.purgeOrganizationDatabase(ctx, registrationOrg); err != nil {
		t.Fatalf("real API database purge failed: %v", err)
	}
	var users, devices, membershipA, membershipB, remainingOrg int
	if err := db.Pool().QueryRow(ctx, `select
 (select count(*) from public.users where id=$1::uuid and organization_id=$2::uuid and is_active),
 (select count(*) from public.push_tokens where id=$3::uuid and user_id=$1::uuid and is_active and organization_id is null),
 (select count(*) from public.organization_members where user_id=$1::uuid and organization_id=$2::uuid and is_active),
 (select count(*) from public.organization_members where user_id=$1::uuid and organization_id=$4::uuid),
 (select count(*) from public.organizations where id=$4::uuid)`, actor, originalOrg, device, registrationOrg).Scan(&users, &devices, &membershipA, &membershipB, &remainingOrg); err != nil {
		t.Fatal(err)
	}
	if users != 1 || devices != 1 || membershipA != 1 || membershipB != 0 || remainingOrg != 0 {
		t.Fatalf("purge violated account ownership: users%d devices%d memberA%d memberB%d orgB%d", users, devices, membershipA, membershipB, remainingOrg)
	}
}
