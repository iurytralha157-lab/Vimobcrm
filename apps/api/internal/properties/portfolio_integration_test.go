package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Runs against a disposable database holding the schema baseline plus the
// portfolio migration. Fixture ids are random, so reruns do not collide.
type portfolioFixture struct {
	ctx        context.Context
	postgres   *dbpkg.Postgres
	repository Repository
	orgA, orgB string
	userA      string
	userB      string
	broker     string
}

func newPortfolioFixture(t *testing.T, storageURL string) portfolioFixture {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("PROPERTY_PORTFOLIO_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set PROPERTY_PORTFOLIO_TEST_DATABASE_URL to run the PostgreSQL contract test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	t.Cleanup(cancel)
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, MaxConns: 8, MinConns: 0, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(postgres.Close)
	f := portfolioFixture{ctx: ctx, postgres: postgres}
	f.repository = NewRepository(postgres, StorageConfig{ProjectURL: storageURL, APIKey: "service-key"})
	pool := postgres.Pool()
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text, gen_random_uuid()::text`).
		Scan(&f.orgA, &f.orgB, &f.userA, &f.userB, &f.broker); err != nil {
		t.Fatal(err)
	}
	for _, statement := range []struct {
		sql  string
		args []any
	}{
		{`insert into public.organizations(id, name, property_owner_contact_visibility, property_edit_policy) values ($1::uuid,'Org A','hidden','everyone'),($2::uuid,'Org B','hidden','everyone')`, []any{f.orgA, f.orgB}},
		{`insert into auth.users(id, email) values ($1::uuid, $1 || '@example.com'), ($2::uuid, $2 || '@example.com'), ($3::uuid, $3 || '@example.com')`, []any{f.userA, f.userB, f.broker}},
		{`update public.users set name = 'Gestora Teste', is_active = true, organization_id = $2::uuid where id = $1::uuid`, []any{f.userA, f.orgA}},
		{`update public.users set name = 'Outra Org', is_active = true, organization_id = $2::uuid where id = $1::uuid`, []any{f.userB, f.orgB}},
		{`update public.users set name = 'Corretor Teste', is_active = true, organization_id = $2::uuid where id = $1::uuid`, []any{f.broker, f.orgA}},
		{`insert into public.organization_members(user_id, organization_id, role, is_active) values ($1::uuid,$3::uuid,'admin',true),($2::uuid,$3::uuid,'user',true),($4::uuid,$5::uuid,'admin',true)
		  on conflict (user_id, organization_id) do update set role = excluded.role, is_active = true`, []any{f.userA, f.broker, f.orgA, f.userB, f.orgB}},
	} {
		if _, err := pool.Exec(ctx, statement.sql, statement.args...); err != nil {
			t.Fatalf("fixture %q: %v", statement.sql, err)
		}
	}
	return f
}

func (f portfolioFixture) manager() tenant.Context {
	return tenant.Context{OrganizationID: f.orgA, UserID: f.userA, MemberRole: "admin"}
}

func (f portfolioFixture) brokerContext() tenant.Context {
	return tenant.Context{OrganizationID: f.orgA, UserID: f.broker, MemberRole: "user", Permissions: []string{"property_view", "property_view_all"}}
}

func (f portfolioFixture) create(t *testing.T, payload propertyRequest) Property {
	t.Helper()
	base := propertyRequest{"title": "Imovel teste", "tipo_de_imovel": "Apartamento", "tipo_de_negocio": "Venda"}
	for key, value := range payload {
		base[key] = value
	}
	input, err := base.ValidateCreate()
	if err != nil {
		t.Fatalf("validate create: %v", err)
	}
	property, err := f.repository.Create(f.ctx, f.manager(), input)
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	return property
}

func (f portfolioFixture) update(t *testing.T, context tenant.Context, property Property, payload propertyRequest) (Property, error) {
	t.Helper()
	request := propertyRequest{"expected_updated_at": anyString(property["updated_at"])}
	for key, value := range payload {
		request[key] = value
	}
	input, err := request.ValidateUpdate()
	if err != nil {
		return nil, err
	}
	return f.repository.Update(f.ctx, context, anyString(property["id"]), input)
}

func TestPortfolioFieldsPersistAndPartialUpdatesKeepThem(t *testing.T) {
	f := newPortfolioFixture(t, "")
	created := f.create(t, propertyRequest{
		"portfolio_type": "third_party", "third_party_kind": "partner",
		"partner_name": "Imobiliaria Parceira", "partner_contact": "61 99999-0000",
		"commission_split_percent": 40.5, "third_party_authorized_until": "2027-03-01",
	})
	if created["portfolio_type"] != "third_party" || created["partner_name"] != "Imobiliaria Parceira" {
		t.Fatalf("created = %#v", created)
	}

	// An existing client that knows nothing about these fields.
	updated, err := f.update(t, f.manager(), created, propertyRequest{"title": "Titulo novo"})
	if err != nil {
		t.Fatalf("partial update: %v", err)
	}
	for field, want := range map[string]any{
		"portfolio_type": "third_party", "third_party_kind": "partner", "partner_name": "Imobiliaria Parceira",
		"partner_contact": "61 99999-0000", "commission_split_percent": 40.5, "third_party_authorized_until": "2027-03-01",
	} {
		if updated[field] != want {
			t.Fatalf("%s = %#v, want %#v after a partial update", field, updated[field], want)
		}
	}

	// Removing the owner clears owner contacts, never the partner's.
	removedOwner, err := f.update(t, f.manager(), updated, propertyRequest{"owner_id": nil})
	if err == nil && removedOwner["partner_contact"] != "61 99999-0000" {
		t.Fatalf("clearing the owner erased the partner contact: %#v", removedOwner)
	}
}

func TestPortfolioValidationAgainstStoredRow(t *testing.T) {
	f := newPortfolioFixture(t, "")
	ready := f.create(t, propertyRequest{})
	if ready["portfolio_type"] != "ready" {
		t.Fatalf("default = %#v", ready["portfolio_type"])
	}
	for name, payload := range map[string]propertyRequest{
		"third party without kind":   {"portfolio_type": "third_party"},
		"partner without name":       {"portfolio_type": "third_party", "third_party_kind": "partner"},
		"split without third party":  {"commission_split_percent": 10},
		"private owner with partner": {"portfolio_type": "third_party", "third_party_kind": "private_owner", "partner_name": "X"},
		"launch without launch deal": {"portfolio_type": "launch"},
		"split above range":          {"portfolio_type": "third_party", "third_party_kind": "partner", "partner_name": "X", "commission_split_percent": 100.5},
		"unparseable date":           {"portfolio_type": "third_party", "third_party_kind": "private_owner", "third_party_authorized_until": "01/02/2027"},
		"unknown portfolio":          {"portfolio_type": "other"},
		"null portfolio":             {"portfolio_type": nil},
	} {
		if _, err := f.update(t, f.manager(), ready, payload); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("%s: err = %v, want invalid input", name, err)
		}
	}

	partner, err := f.update(t, f.manager(), ready, propertyRequest{
		"portfolio_type": "third_party", "third_party_kind": "partner", "partner_name": "Parceira", "partner_contact": "x@example.com",
	})
	if err != nil {
		t.Fatalf("to partner: %v", err)
	}
	// The stored name satisfies the rule on a later partial update.
	partner, err = f.update(t, f.manager(), partner, propertyRequest{"commission_split_percent": "12,5"})
	if err != nil || partner["commission_split_percent"] != 12.5 {
		t.Fatalf("partial third party update: %#v, %v", partner["commission_split_percent"], err)
	}
	if _, err := f.update(t, f.manager(), partner, propertyRequest{"partner_name": ""}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("clearing the required partner name: err = %v", err)
	}

	backToPrivate, err := f.update(t, f.manager(), partner, propertyRequest{"third_party_kind": "private_owner"})
	if err != nil || backToPrivate["partner_name"] != nil || backToPrivate["partner_contact"] != nil {
		t.Fatalf("private owner must not keep partner data: %#v, %v", backToPrivate, err)
	}
	backToReady, err := f.update(t, f.manager(), backToPrivate, propertyRequest{"portfolio_type": "ready"})
	if err != nil || backToReady["third_party_kind"] != nil || backToReady["commission_split_percent"] != nil {
		t.Fatalf("ready must not keep third party data: %#v, %v", backToReady, err)
	}

	// The database refuses what the API refuses, for writers that bypass it.
	if _, err := f.postgres.Pool().Exec(f.ctx, `update public.properties set third_party_kind = 'partner' where id = $1::uuid`, anyString(ready["id"])); err == nil {
		t.Fatal("database accepted a kind on a non third party row")
	}
	if _, err := f.postgres.Pool().Exec(f.ctx, `update public.properties set portfolio_type = 'third_party', third_party_kind = 'partner' where id = $1::uuid`, anyString(ready["id"])); err == nil {
		t.Fatal("database accepted a partner without a name")
	}
}

func TestLaunchClassificationFollowsDealTypeForWritersThatOmitIt(t *testing.T) {
	f := newPortfolioFixture(t, "")
	launch := f.create(t, propertyRequest{"tipo_de_negocio": "Lançamento"})
	if launch["portfolio_type"] != "launch" {
		t.Fatalf("launch deal stored as %#v", launch["portfolio_type"])
	}
	sale, err := f.update(t, f.manager(), launch, propertyRequest{"tipo_de_negocio": "Venda"})
	if err != nil || sale["portfolio_type"] != "ready" {
		t.Fatalf("leaving launch deal: %#v, %v", sale["portfolio_type"], err)
	}
	thirdParty := f.create(t, propertyRequest{"tipo_de_negocio": "Lançamento", "portfolio_type": "third_party", "third_party_kind": "private_owner"})
	if thirdParty["portfolio_type"] != "third_party" {
		t.Fatalf("trigger replaced an explicit third party: %#v", thirdParty["portfolio_type"])
	}
}

func TestPartnerContactFollowsOwnerContactRule(t *testing.T) {
	f := newPortfolioFixture(t, "")
	created := f.create(t, propertyRequest{
		"portfolio_type": "third_party", "third_party_kind": "partner", "partner_name": "Parceira",
		"partner_contact": "61 98888-0000", "commission_split_percent": 30.0,
		"responsible_user_id": f.broker,
	})
	id := anyString(created["id"])

	shown, err := f.repository.Get(f.ctx, f.brokerContext(), id)
	if err != nil {
		t.Fatalf("broker get: %v", err)
	}
	if _, leaked := shown["partner_contact"]; leaked {
		t.Fatalf("hidden organization exposed partner contact: %#v", shown)
	}
	if _, leaked := shown["commission_split_percent"]; leaked {
		t.Fatalf("broker received internal commission split: %#v", shown)
	}
	if shown["partner_name"] != "Parceira" || shown["portfolio_type"] != "third_party" {
		t.Fatalf("broker should see the classification: %#v", shown)
	}
	workspace, err := f.repository.GetWorkspace(f.ctx, f.brokerContext(), id)
	if err != nil {
		t.Fatalf("broker workspace: %v", err)
	}
	if _, leaked := workspace.Data.Property["partner_contact"]; leaked {
		t.Fatalf("workspace exposed partner contact: %#v", workspace.Data.Property)
	}
	list, err := f.repository.List(f.ctx, f.brokerContext(), ListFilter{Limit: 10, PortfolioType: "third_party"})
	if err != nil || len(list.Data) != 1 {
		t.Fatalf("broker list: %#v, %v", list, err)
	}
	if _, leaked := list.Data[0]["partner_contact"]; leaked {
		t.Fatalf("list exposed partner contact: %#v", list.Data[0])
	}

	// A silent no-op on the hidden field, and no way to erase what is hidden.
	updated, err := f.update(t, f.brokerContext(), shown, propertyRequest{"partner_contact": "trocado", "title": "Novo"})
	if err != nil {
		t.Fatalf("broker update: %v", err)
	}
	var stored string
	if err := f.postgres.Pool().QueryRow(f.ctx, `select partner_contact from public.properties where id = $1::uuid`, id).Scan(&stored); err != nil || stored != "61 98888-0000" {
		t.Fatalf("stored contact = %q, %v", stored, err)
	}
	if _, err := f.update(t, f.brokerContext(), updated, propertyRequest{"portfolio_type": "ready"}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("broker erased a hidden contact: err = %v", err)
	}

	if _, err := f.postgres.Pool().Exec(f.ctx, `update public.organizations set property_owner_contact_visibility = 'visible' where id = $1::uuid`, f.orgA); err != nil {
		t.Fatal(err)
	}
	visible, err := f.repository.Get(f.ctx, f.brokerContext(), id)
	if err != nil || visible["partner_contact"] != "61 98888-0000" {
		t.Fatalf("visible organization: %#v, %v", visible["partner_contact"], err)
	}
}

func TestBrokerCannotEraseManagerOnlyThirdPartyFields(t *testing.T) {
	f := newPortfolioFixture(t, "")
	if _, err := f.postgres.Pool().Exec(f.ctx, `update public.organizations set property_owner_contact_visibility = 'visible' where id = $1::uuid`, f.orgA); err != nil {
		t.Fatal(err)
	}
	stored := func(id string) (split *float64, until *string, portfolio string) {
		t.Helper()
		if err := f.postgres.Pool().QueryRow(f.ctx, `select commission_split_percent::float8, third_party_authorized_until::text, portfolio_type from public.properties where id = $1::uuid`, id).Scan(&split, &until, &portfolio); err != nil {
			t.Fatal(err)
		}
		return split, until, portfolio
	}

	for name, payload := range map[string]propertyRequest{
		"split":         {"commission_split_percent": 30.0},
		"authorization": {"third_party_authorized_until": "2027-03-01"},
	} {
		t.Run(name, func(t *testing.T) {
			create := propertyRequest{"portfolio_type": "third_party", "third_party_kind": "private_owner", "responsible_user_id": f.broker}
			for key, value := range payload {
				create[key] = value
			}
			created := f.create(t, create)
			id := anyString(created["id"])
			shown, err := f.repository.Get(f.ctx, f.brokerContext(), id)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := f.update(t, f.brokerContext(), shown, propertyRequest{"portfolio_type": "ready"}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
				t.Fatalf("broker reclassified over manager data: err = %v", err)
			}
			split, until, portfolio := stored(id)
			if portfolio != "third_party" || (split == nil && until == nil) {
				t.Fatalf("stored values changed: %v %v %q", split, until, portfolio)
			}
			// A manager may still reclassify, which clears both.
			if _, err := f.update(t, f.manager(), created, propertyRequest{"portfolio_type": "ready"}); err != nil {
				t.Fatalf("manager reclassify: %v", err)
			}
			split, until, portfolio = stored(id)
			if portfolio != "ready" || split != nil || until != nil {
				t.Fatalf("manager reclassify left: %v %v %q", split, until, portfolio)
			}
		})
	}

	t.Run("nothing protected stored", func(t *testing.T) {
		created := f.create(t, propertyRequest{"portfolio_type": "third_party", "third_party_kind": "private_owner", "responsible_user_id": f.broker})
		shown, err := f.repository.Get(f.ctx, f.brokerContext(), anyString(created["id"]))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.update(t, f.brokerContext(), shown, propertyRequest{"portfolio_type": "ready"}); err != nil {
			t.Fatalf("broker with nothing to erase: %v", err)
		}
	})
}

func TestPortfolioListFilterIsTenantScoped(t *testing.T) {
	f := newPortfolioFixture(t, "")
	created := f.create(t, propertyRequest{"portfolio_type": "third_party", "third_party_kind": "private_owner"})
	f.create(t, propertyRequest{})
	other, err := f.repository.List(f.ctx, tenant.Context{OrganizationID: f.orgB, UserID: f.userB, MemberRole: "admin"}, ListFilter{Limit: 10, PortfolioType: "third_party"})
	if err != nil || len(other.Data) != 0 {
		t.Fatalf("other organization: %#v, %v", other.Data, err)
	}
	mine, err := f.repository.List(f.ctx, f.manager(), ListFilter{Limit: 10, PortfolioType: "third_party"})
	if err != nil || len(mine.Data) != 1 || mine.Data[0]["id"] != created["id"] {
		t.Fatalf("own list: %#v, %v", mine.Data, err)
	}
	stats, err := f.repository.Stats(f.ctx, f.manager(), ListFilter{PortfolioType: "ready"})
	if err != nil || stats.Total != 1 {
		t.Fatalf("stats: %#v, %v", stats, err)
	}
}

func TestPortfolioSettingsRevisionAndIsolation(t *testing.T) {
	f := newPortfolioFixture(t, "")
	initial, err := f.repository.GetPortfolioSettings(f.ctx, f.manager())
	if err != nil || initial.Revision != 0 || initial.Settings["general"]["auto_code"] != true {
		t.Fatalf("defaults: %#v, %v", initial, err)
	}
	revision := func(value int64) *int64 { return &value }
	input := func(body string, rev int64) UpdatePortfolioSettingsInput {
		settings := map[string]any{}
		decoder := json.NewDecoder(strings.NewReader(body))
		decoder.UseNumber()
		if err := decoder.Decode(&settings); err != nil {
			t.Fatal(err)
		}
		return UpdatePortfolioSettingsInput{Settings: settings, Revision: revision(rev)}
	}

	first, err := f.repository.UpdatePortfolioSettings(f.ctx, f.manager(), input(`{"general":{"min_photos":5},"keys":{"locations":["Recepcao"," recepcao ","Cofre"]}}`, 0))
	if err != nil || first.Revision != 1 || first.Settings["general"]["min_photos"] != float64(5) && first.Settings["general"]["min_photos"] != int64(5) {
		t.Fatalf("first save: %#v, %v", first, err)
	}
	if first.UpdatedBy == nil || *first.UpdatedBy != f.userA || first.UpdatedAt == nil {
		t.Fatalf("audit columns: %#v", first)
	}
	if got := first.Settings["keys"]["locations"]; fmt.Sprint(got) != "[Recepcao Cofre]" {
		t.Fatalf("list normalization: %#v", got)
	}

	second, err := f.repository.UpdatePortfolioSettings(f.ctx, f.manager(), input(`{"third_party":{"default_split_pct":37.5}}`, 1))
	if err != nil || second.Revision != 2 {
		t.Fatalf("second save: %#v, %v", second, err)
	}
	if fmt.Sprint(second.Settings["general"]["min_photos"]) != "5" {
		t.Fatalf("merge lost a stored key: %#v", second.Settings["general"])
	}

	for name, stale := range map[string]int64{"older": 1, "zero with row": 0, "future": 9} {
		if _, err := f.repository.UpdatePortfolioSettings(f.ctx, f.manager(), input(`{"general":{"min_photos":1}}`, stale)); !errors.Is(err, ErrPropertySettingsConflict) {
			t.Errorf("%s revision: err = %v", name, err)
		}
	}
	for _, body := range []string{
		`{"general":{"unknown":1}}`, `{"unknown":{"a":1}}`, `{"general":{"auto_code":"sim"}}`,
		`{"general":{"min_photos":21}}`, `{"general":{"min_photos":1.5}}`, `{"ready":{"default_sale_commission_pct":101}}`,
		`{"rentals":{"adjustment_index":"SELIC"}}`, `{"general":{"min_photos":null}}`, `{"general":3}`,
	} {
		if _, err := f.repository.UpdatePortfolioSettings(f.ctx, f.manager(), input(body, 2)); !errors.Is(err, ErrInvalidInput) {
			t.Errorf("%s: err = %v, want invalid input", body, err)
		}
	}

	other := tenant.Context{OrganizationID: f.orgB, UserID: f.userB, MemberRole: "admin"}
	otherRead, err := f.repository.GetPortfolioSettings(f.ctx, other)
	if err != nil || otherRead.Revision != 0 || fmt.Sprint(otherRead.Settings["general"]["min_photos"]) != "0" {
		t.Fatalf("settings leaked across organizations: %#v, %v", otherRead, err)
	}
	if _, err := f.repository.UpdatePortfolioSettings(f.ctx, other, input(`{"general":{"min_photos":2}}`, 2)); !errors.Is(err, ErrPropertySettingsConflict) {
		t.Fatalf("another organization used this revision: %v", err)
	}
}

func TestKeyMovementsPaginationScopeAndPrivacy(t *testing.T) {
	f := newPortfolioFixture(t, "")
	created := f.create(t, propertyRequest{"responsible_user_id": f.broker})
	id := anyString(created["id"])
	var keyA, keyB string
	pool := f.postgres.Pool()
	for label, target := range map[string]*string{"Portaria": &keyA, "Cofre": &keyB} {
		if err := pool.QueryRow(f.ctx, `insert into public.property_keys(organization_id, property_id, label, created_by)
			values ($1::uuid,$2::uuid,$3,$4::uuid) returning id::text`, f.orgA, id, label, f.userA).Scan(target); err != nil {
			t.Fatal(err)
		}
	}
	base := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	for index := 0; index < 5; index++ {
		key := keyA
		if index%2 == 1 {
			key = keyB
		}
		if _, err := pool.Exec(f.ctx, `insert into public.property_key_movements(organization_id, property_key_id, movement_type, to_location, notes, metadata, occurred_at, created_by)
			values ($1::uuid,$2::uuid,'location_change','Sala',$3,'{"reason":"visita"}'::jsonb,$4,$5::uuid)`,
			f.orgA, key, fmt.Sprintf("nota %d", index), base.Add(time.Duration(index)*time.Hour), f.userA); err != nil {
			t.Fatal(err)
		}
	}
	// Two movements at one instant must still paginate without loss or repeats.
	for range 2 {
		if _, err := pool.Exec(f.ctx, `insert into public.property_key_movements(organization_id, property_key_id, movement_type, to_location, occurred_at, created_by)
			values ($1::uuid,$2::uuid,'location_change','Cofre',$3,$4::uuid)`, f.orgA, keyA, base.Add(10*time.Hour), f.userA); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(f.ctx, `insert into public.property_key_movements(organization_id, property_key_id, movement_type, holder_name, occurred_at, expected_return_at, created_by)
		values ($1::uuid,$2::uuid,'checkout','Maria Corretora',$3,$4,$5::uuid)`, f.orgA, keyA, base.Add(11*time.Hour), base.Add(35*time.Hour), f.userA); err != nil {
		t.Fatal(err)
	}

	seen := map[string]bool{}
	var pages int
	var cursor *keyMovementCursor
	var previous string
	for {
		page, err := f.repository.ListPropertyKeyMovements(f.ctx, f.manager(), id, propertyKeyMovementFilter{Limit: 3, Cursor: cursor})
		if err != nil {
			t.Fatalf("page: %v", err)
		}
		pages++
		for _, record := range page.Data {
			if seen[record.ID] {
				t.Fatalf("movement %s repeated across pages", record.ID)
			}
			seen[record.ID] = true
			if previous != "" && record.OccurredAt > previous {
				t.Fatalf("not newest first: %s after %s", record.OccurredAt, previous)
			}
			previous = record.OccurredAt
			if record.ActorName == nil || *record.ActorName != "Gestora Teste" || record.KeyName == "" {
				t.Fatalf("record = %#v", record)
			}
		}
		if page.NextCursor == nil {
			break
		}
		decoded, err := decodeKeyMovementCursor(*page.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
		cursor = &decoded
	}
	if len(seen) != 8 || pages != 3 {
		t.Fatalf("movements = %d in %d pages, want 8 in 3", len(seen), pages)
	}

	checkouts, err := f.repository.ListPropertyKeyMovements(f.ctx, f.manager(), id, propertyKeyMovementFilter{Limit: 10, Type: "checkout"})
	if err != nil || len(checkouts.Data) != 1 || *checkouts.Data[0].HolderName != "Maria Corretora" || checkouts.Data[0].ExpectedReturnAt == nil {
		t.Fatalf("type filter: %#v, %v", checkouts, err)
	}
	withReason, err := f.repository.ListPropertyKeyMovements(f.ctx, f.manager(), id, propertyKeyMovementFilter{Limit: 10, Type: "location_change"})
	if err != nil || len(withReason.Data) != 7 || withReason.Data[6].Reason == nil || *withReason.Data[6].Reason != "visita" {
		t.Fatalf("reason: %#v, %v", withReason.Data, err)
	}

	broker, err := f.repository.ListPropertyKeyMovements(f.ctx, f.brokerContext(), id, propertyKeyMovementFilter{Limit: 10})
	if err != nil || len(broker.Data) != 0 || broker.Meta.CanViewKeyCustody {
		t.Fatalf("broker saw physical custody: %#v, %v", broker, err)
	}
	if _, err := f.repository.ListPropertyKeyMovements(f.ctx, tenant.Context{OrganizationID: f.orgB, UserID: f.userB, MemberRole: "admin"}, id, propertyKeyMovementFilter{Limit: 10}); !errors.Is(err, ErrPropertyNotFound) {
		t.Fatalf("other organization: err = %v", err)
	}
}

func TestPortfolioSettingsHTTPContract(t *testing.T) {
	f := newPortfolioFixture(t, "")
	handler := NewHandler(f.repository)
	put := func(body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPut, "/v1/properties/settings/portfolio", strings.NewReader(body))
		request = request.WithContext(tenant.ContextWithTenant(request.Context(), f.manager()))
		response := httptest.NewRecorder()
		handler.UpdatePortfolioSettings(response, request)
		return response
	}
	if response := put(`{"settings":{"general":{"min_photos":3}},"revision":0}`); response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"revision":1`) {
		t.Fatalf("first save: %d %s", response.Code, response.Body.String())
	}
	stale := put(`{"settings":{"general":{"min_photos":4}},"revision":0}`)
	if stale.Code != http.StatusConflict || !strings.Contains(stale.Body.String(), "property_settings_conflict") {
		t.Fatalf("stale: %d %s", stale.Code, stale.Body.String())
	}
	for _, body := range []string{
		`{"settings":{"general":{"nope":1}},"revision":1}`,
		`{"settings":{"general":{"min_photos":3}}}`,
		`{"settings":{},"revision":1,"extra":true}`,
		`{"revision":1}`,
		`{"settings":{"general":{"min_photos":3}},"revision":1} trailing`,
	} {
		if response := put(body); response.Code != http.StatusBadRequest {
			t.Errorf("%s: status %d %s", body, response.Code, response.Body.String())
		}
	}
	request := httptest.NewRequest(http.MethodGet, "/v1/properties/settings/portfolio", nil)
	request = request.WithContext(tenant.ContextWithTenant(request.Context(), f.brokerContext()))
	response := httptest.NewRecorder()
	handler.ShowPortfolioSettings(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), `"min_photos":3`) || !strings.Contains(response.Body.String(), `"default_address_visibility":"full"`) {
		t.Fatalf("read: %d %s", response.Code, response.Body.String())
	}
}

func TestPromotedUnitAndIdempotentCreateKeepPortfolio(t *testing.T) {
	f := newPortfolioFixture(t, "")
	tx, err := f.postgres.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(f.ctx)
	promoted, err := f.repository.CreateFromDevelopmentUnitTx(f.ctx, tx, f.manager(), DevelopmentUnitPropertyInput{
		Title: "Unidade 101", PropertyType: "Apartamento", DealType: "lancamento", Status: "active", Purpose: "Residencial", PublicAddressVisibility: "completo", Metadata: map[string]any{},
	})
	if err != nil {
		t.Fatalf("promote: %v", err)
	}
	if promoted["portfolio_type"] != "launch" {
		t.Fatalf("promoted unit classified as %#v", promoted["portfolio_type"])
	}
	if err := tx.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}

	request := func() propertyRequest {
		input, err := propertyRequest{
			"title": "Parceria", "tipo_de_imovel": "Casa", "tipo_de_negocio": "Venda",
			"portfolio_type": "third_party", "third_party_kind": "partner", "partner_name": "Parceira", "partner_contact": "contato",
		}.ValidateCreate()
		if err != nil {
			t.Fatal(err)
		}
		return input
	}
	var key string
	if err := f.postgres.Pool().QueryRow(f.ctx, `select gen_random_uuid()::text`).Scan(&key); err != nil {
		t.Fatal(err)
	}
	first, created, err := f.repository.CreateIdempotent(f.ctx, f.manager(), request(), key)
	if err != nil || !created || first["partner_contact"] != "contato" {
		t.Fatalf("first create: %#v, %v, %v", first, created, err)
	}
	replay, created, err := f.repository.CreateIdempotent(f.ctx, f.manager(), request(), key)
	if err != nil || created || replay["id"] != first["id"] || replay["portfolio_type"] != "third_party" {
		t.Fatalf("replay: %#v, %v, %v", replay, created, err)
	}
}
