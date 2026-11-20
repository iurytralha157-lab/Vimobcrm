package properties

import (
	"context"
	"errors"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestPropertyDeletionPreservesLinkedLeadsAgainstLocalPostgres(t *testing.T) {
	dsn := os.Getenv("VIMOB_PROPERTY_DELETE_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires the named disposable local property deletion database")
	}
	parsed, err := url.Parse(dsn)
	if err != nil || parsed.Path != "/vimob_property_delete_local" || parsed.Hostname() != "127.0.0.1" {
		t.Fatal("refusing a database outside the disposable property deletion fixture")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: dsn, MaxConns: 3, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	pool := db.Pool()
	var fixtureMarker string
	if err := pool.QueryRow(ctx, `select marker from vimob_ci_fixture.identity`).Scan(&fixtureMarker); err != nil || fixtureMarker != "property-delete-local-v1" {
		t.Fatalf("disposable fixture identity not verified: %v", err)
	}
	newOrg := func() string {
		t.Helper()
		var org string
		if err := pool.QueryRow(ctx, `insert into public.organizations(name, slug)
			values ('Property delete fixture', 'property-delete-' || gen_random_uuid()::text) returning id::text`).Scan(&org); err != nil {
			t.Fatal(err)
		}
		return org
	}
	org, otherOrg := newOrg(), newOrg()
	actor := tenant.Context{OrganizationID: org, MemberRole: "admin"}
	otherActor := tenant.Context{OrganizationID: otherOrg, MemberRole: "admin"}
	newProperty := func() string {
		t.Helper()
		var id string
		if err := pool.QueryRow(ctx, `insert into public.properties(organization_id,code,title,tipo,tipo_de_imovel,status)
			values ($1::uuid,'DELETE-' || gen_random_uuid()::text,'Synthetic deletion fixture','Apartamento','Apartamento','active')
			returning id::text`, org).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	target, kept := newProperty(), newProperty()
	propertyVersion := func() string {
		t.Helper()
		var version time.Time
		if err := pool.QueryRow(ctx, `select updated_at from public.properties where id = $1::uuid`, target).Scan(&version); err != nil {
			t.Fatal(err)
		}
		return version.UTC().Format(time.RFC3339Nano)
	}
	newLead := func(organization, name, property, interest, status, interestsJSON string) string {
		t.Helper()
		var lead string
		if err := pool.QueryRow(ctx, `insert into public.leads(organization_id,name,source,property_id,interest_property_id,deal_status,metadata,property_code)
			values ($1::uuid,$2,'manual',nullif($3,'')::uuid,nullif($4,'')::uuid,$5,
			jsonb_build_object('interestPropertyIds',$6::jsonb,'retained',true),'synthetic-acquisition-code')
			returning id::text`, organization, name, property, interest, status, interestsJSON).Scan(&lead); err != nil {
			t.Fatal(err)
		}
		return lead
	}
	allLinks := newLead(org, "won with all link types", target, target, "won", `["`+target+`","`+kept+`"," `+strings.ToUpper(target)+` ",null,{"legacy":true}]`)
	secondary := newLead(org, "secondary interest", kept, kept, "open", `["`+kept+`","`+target+`"]`)
	interest := newLead(org, "primary interest alias", "", target, "open", `[]`)
	portal := newLead(org, "only portal interest", "", "", "open", `[]`)
	legacy := newLead(org, "malformed metadata", target, "", "open", `{"legacy":true}`)
	foreign := newLead(otherOrg, "legacy cross-tenant alias", "", "", "open", `["`+target+`"]`)
	// Simulate a row from before the tenant-reference trigger. Disable triggers
	// only in the transaction that creates this legacy fixture relationship.
	legacyWrite, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer legacyWrite.Rollback(ctx)
	if _, err := legacyWrite.Exec(ctx, `set local session_replication_role = replica`); err != nil {
		t.Fatal(err)
	}
	if _, err := legacyWrite.Exec(ctx, `update public.leads set interest_property_id = $2::uuid where id = $1::uuid`, foreign, target); err != nil {
		t.Fatal(err)
	}
	if err := legacyWrite.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `update public.leads set property_code = (select code from public.properties where id = $2::uuid)
		where id = $1::uuid`, allLinks, target); err != nil {
		t.Fatal(err)
	}
	var historicalActivity string
	if err := pool.QueryRow(ctx, `insert into public.activities(organization_id,lead_id,type,content,metadata)
		values ($1::uuid,$2::uuid,'property_selected','Historical property selection',jsonb_build_object('property_id',$3::uuid))
		returning id::text`, org, allLinks, target).Scan(&historicalActivity); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into public.lead_property_interests(lead_id,property_id)
		values ($1::uuid,$3::uuid),($2::uuid,$3::uuid),($2::uuid,$4::uuid)`, allLinks, portal, target, kept); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(db, StorageConfig{})
	impact, err := repo.DeletionImpact(ctx, actor, target)
	if err != nil || impact.LinkedLeadsCount != 5 {
		t.Fatalf("tenant-scoped distinct linked lead count: %+v, %v", impact, err)
	}
	if _, err := repo.DeletionImpact(ctx, otherActor, target); !errors.Is(err, ErrPropertyNotFound) {
		t.Fatalf("cross-tenant impact = %v", err)
	}
	viewer := tenant.Context{OrganizationID: org, MemberRole: "member"}
	if _, err := repo.DeletionImpact(ctx, viewer, target); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("unprivileged impact = %v", err)
	}
	count := impact.LinkedLeadsCount
	version := propertyVersion()
	confirmation := DeletePropertyInput{ExpectedUpdatedAt: version, ExpectedLinkedLeadsCount: &count}
	if err := repo.Delete(ctx, otherActor, target, confirmation); !errors.Is(err, ErrPropertyNotFound) {
		t.Fatalf("cross-tenant delete = %v", err)
	}
	if err := repo.Delete(ctx, actor, target, confirmation); !errors.Is(err, ErrPropertyHasDependencies) {
		t.Fatalf("cross-tenant relation must block cascading deletion: %v", err)
	}
	if _, err := pool.Exec(ctx, `update public.leads set interest_property_id = null where id = $1::uuid`, foreign); err != nil {
		t.Fatal(err)
	}
	version = propertyVersion()
	confirmation.ExpectedUpdatedAt = version
	if err := repo.Delete(ctx, actor, target, DeletePropertyInput{ExpectedUpdatedAt: version}); !errors.Is(err, ErrPropertyHasLinkedLeads) {
		t.Fatalf("unconfirmed legacy delete = %v", err)
	}
	count--
	if err := repo.Delete(ctx, actor, target, confirmation); !errors.Is(err, ErrPropertyDeleteImpactChanged) {
		t.Fatalf("stale count = %v", err)
	}
	count++
	lock, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback(ctx)
	if _, err := lock.Exec(ctx, `select id from public.leads where id = $1::uuid for no key update`, secondary); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, actor, target, confirmation); !errors.Is(err, ErrPropertyWorkspaceConflict) {
		t.Fatalf("busy linked lead should leave deletion retryable: %v", err)
	}
	if err := lock.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	// Use the same restrictive relationship as development units to exercise
	// rollback after lead rows have already been updated by the transaction.
	if _, err := pool.Exec(ctx, `create table vimob_ci_fixture.property_dependency (
		property_id uuid references public.properties(id) on delete restrict
	)`); err != nil {
		t.Fatal(err)
	}
	defer pool.Exec(ctx, `drop table vimob_ci_fixture.property_dependency`)
	if _, err := pool.Exec(ctx, `insert into vimob_ci_fixture.property_dependency values ($1::uuid)`, target); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, actor, target, confirmation); !errors.Is(err, ErrPropertyHasDependencies) {
		t.Fatalf("restricted property delete = %v", err)
	}
	if impact, err := repo.DeletionImpact(ctx, actor, target); err != nil || impact.LinkedLeadsCount != count {
		t.Fatalf("restriction did not roll back unlink: %+v, %v", impact, err)
	}
	if _, err := pool.Exec(ctx, `delete from vimob_ci_fixture.property_dependency where property_id = $1::uuid`, target); err != nil {
		t.Fatal(err)
	}
	if err := repo.Delete(ctx, actor, target, confirmation); err != nil {
		t.Fatalf("confirmed property delete = %v", err)
	}
	if _, err := repo.DeletionImpact(ctx, actor, target); !errors.Is(err, ErrPropertyNotFound) {
		t.Fatalf("post-delete property impact = %v", err)
	}
	const acquisitionCode = "synthetic-acquisition-code"
	for _, check := range []struct{ id, base, interest, status, metadata, code string }{
		{allLinks, "", "", "won", `["` + kept + `",null,{"legacy":true}]`, ""},
		{secondary, kept, kept, "open", `["` + kept + `"]`, acquisitionCode},
		{interest, "", "", "open", `[]`, acquisitionCode},
		{portal, "", "", "open", `[]`, acquisitionCode},
		{legacy, "", "", "open", `{"legacy":true}`, acquisitionCode},
		{foreign, "", "", "open", `["` + target + `"]`, acquisitionCode},
	} {
		var matches bool
		err := pool.QueryRow(ctx, `select property_id is not distinct from nullif($2,'')::uuid
			and interest_property_id is not distinct from nullif($3,'')::uuid
			and deal_status = $4 and coalesce(property_code, '') = $6
			and metadata->'interestPropertyIds' = $5::jsonb and metadata->'retained' = 'true'::jsonb
			from public.leads where id = $1::uuid`, check.id, check.base, check.interest, check.status, check.metadata, check.code).Scan(&matches)
		if err != nil || !matches {
			t.Fatalf("lead state was not preserved: %v", err)
		}
	}
	if impact, err := repo.DeletionImpact(ctx, actor, kept); err != nil || impact.LinkedLeadsCount != 3 {
		t.Fatalf("unrelated property's associations not preserved: %+v, %v", impact, err)
	}
	var activityPreserved bool
	if err := pool.QueryRow(ctx, `select lead_id = $2::uuid and metadata->>'property_id' = $3::uuid::text
		from public.activities where id = $1::uuid`, historicalActivity, allLinks, target).Scan(&activityPreserved); err != nil || !activityPreserved {
		t.Fatalf("lead property history was not preserved: %v", err)
	}
}
