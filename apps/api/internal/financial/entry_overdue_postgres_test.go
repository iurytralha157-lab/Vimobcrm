package financial

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestFinancialOverduePostgres(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 with a disposable local DATABASE_URL")
	}
	config, err := pgx.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil || !financialOverduePostgresTargetAllowed(config) {
		t.Fatal("requires an isolated vetter_financial_qa_ database with loopback-only connection targets")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: os.Getenv("DATABASE_URL"), MaxConns: 1, HealthTimeout: 5 * time.Second})
	if err != nil {
		t.Fatal("connect disposable PostgreSQL")
	}
	defer database.Close()
	_, err = database.Pool().Exec(ctx, `
		create table public.financial_entries (
			id uuid primary key, organization_id uuid not null, type text, status text,
			amount numeric, paid_amount numeric, paid_value numeric, due_date date,
			paid_date date, created_at timestamptz default now(), contract_id uuid
		);
		create table public.commissions (organization_id uuid, status text, amount numeric, calculated_value numeric);
		create table public.contracts (id uuid, organization_id uuid, property_id uuid, contract_number text, status text, value numeric, commission_value numeric);
		create table public.leads (id uuid, organization_id uuid, deal_status text, valor_interesse numeric);
		create table public.properties (id uuid, organization_id uuid, code text, title text, responsible_user_id uuid, created_by uuid);
		create table public.team_members (organization_id uuid, team_id uuid, user_id uuid, is_active bool, is_leader bool, membership_generation bigint);
		create table public.organization_members (organization_id uuid, user_id uuid, is_active bool, deleted_at timestamptz, membership_generation bigint);
	`)
	if err != nil {
		t.Fatalf("prepare isolated fixture: %v", err)
	}
	var today string
	if err := database.Pool().QueryRow(ctx, "select ("+financialOverdueTodaySQL+")::text").Scan(&today); err != nil {
		t.Fatal(err)
	}
	civilToday, _ := time.Parse("2006-01-02", today)
	yesterday := civilToday.AddDate(0, 0, -1).Format("2006-01-02")
	tomorrow := civilToday.AddDate(0, 0, 1).Format("2006-01-02")
	orgA, orgB := "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	fixtures := []struct {
		kind                          string
		status                        any
		amount, paidAmount, paidValue float64
		due                           any
	}{
		{"receivable", "pending", 100, 0, 0, yesterday},
		{"receivable", "partial", 200, 40, 40, yesterday},
		{"receivable", "overdue", 300, 50, 100, yesterday},
		{"receivable", " PENDENTE ", 50, 0, 0, yesterday},
		{"receivable", "parcial", 80, 10, 0, yesterday},
		{"receivable", "vencido", 90, 0, 0, yesterday},
		{"receivable", "partial", 110, 150, 150, yesterday},
		{"receivable", "paid", 100, 0, 0, yesterday},
		{"receivable", "paga", 50, 50, 50, yesterday},
		{"receivable", "cancelled", 400, 0, 0, yesterday},
		{"receivable", "cancelada", 500, 0, 0, yesterday},
		{"receivable", "pending", 260, 0, 0, today},
		{"receivable", "overdue", 250, 0, 0, tomorrow},
		{"receivable", "overdue", 270, 0, 0, nil},
		{"payable", "pending", 100, 25, 25, yesterday},
		{"payable", "partial", 200, 100, 100, yesterday},
		{"payable", "vencido", 25, 0, 0, yesterday},
		{"payable", "paid", 50, 0, 0, yesterday},
		{"payable", "overdue", 60, 0, 0, tomorrow},
		{"receivable", "unknown", 99999, 0, 0, yesterday},
		{"receivable", "", 99999, 0, 0, yesterday},
		{"receivable", nil, 99999, 0, 0, yesterday},
	}
	for i, fixture := range fixtures {
		_, err := database.Pool().Exec(ctx, `insert into public.financial_entries
			(id, organization_id, type, status, amount, paid_amount, paid_value, due_date)
			values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8::date)`,
			fmt.Sprintf("00000000-0000-4000-8000-%012d", i+1), orgA,
			fixture.kind, fixture.status, fixture.amount, fixture.paidAmount, fixture.paidValue, fixture.due)
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err = database.Pool().Exec(ctx, `insert into public.financial_entries
		(id, organization_id, type, status, amount, due_date)
		values ('00000000-0000-4000-8000-000000000099', $1::uuid, 'receivable', 'pending', 9999, $2::date)`, orgB, yesterday)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Pool().Exec(ctx, `insert into public.financial_entries
		(id, organization_id, type, status, amount, due_date)
		values ('00000000-0000-4000-8000-000000000098', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'receivable', 'unknown', 99999, $1::date)`, yesterday)
	if err != nil {
		t.Fatal(err)
	}
	var before string
	if err := database.Pool().QueryRow(ctx, "select jsonb_agg(to_jsonb(e) || jsonb_build_object('created_at', extract(epoch from created_at)) order by id)::text from public.financial_entries e").Scan(&before); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(database, StorageConfig{})
	actor := tenant.Context{OrganizationID: orgA, UserID: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", Permissions: []string{"financial_view"}}

	t.Run("dashboard balances rate and unchanged forecast", func(t *testing.T) {
		data, err := repo.Dashboard(ctx, actor)
		if err != nil {
			t.Fatal(err)
		}
		for field, want := range map[string]float64{
			"overdueReceivables": 670, "overduePayables": 200,
			"defaultRate":  670.0 / 1080 * 100,
			"receivable30": 260, "totalPayable": 100,
		} {
			if got, ok := data[field].(float64); !ok || math.Abs(got-want) > 0.000001 {
				t.Fatalf("%s=%v want %v", field, data[field], want)
			}
		}
	})
	t.Run("overdue filter uses the same positive balances and preserves stored status", func(t *testing.T) {
		rows, err := repo.ListEntries(ctx, actor, url.Values{"status": {"overdue"}})
		if err != nil {
			t.Fatal(err)
		}
		if len(rows) != 9 {
			t.Fatalf("rows=%d want 9", len(rows))
		}
		var balance float64
		for _, row := range rows {
			if row["organization_id"] != orgA || row["due_date"] != yesterday {
				t.Fatalf("unexpected row: %v", row["id"])
			}
			paid := math.Max(numberField(row, "paid_amount"), numberField(row, "paid_value"))
			balance += math.Max(numberField(row, "amount")-paid, 0)
		}
		if balance != 870 {
			t.Fatalf("balance=%v want 870", balance)
		}
		filtered, err := repo.ListEntries(ctx, actor, url.Values{"status": {"vencido"}, "type": {"receivable"}, "startDate": {yesterday}, "endDate": {yesterday}})
		if err != nil || len(filtered) != 6 {
			t.Fatalf("receivables=%d err=%v", len(filtered), err)
		}
		future, err := repo.ListEntries(ctx, actor, url.Values{"status": {"overdue"}, "startDate": {today}})
		if err != nil || len(future) != 0 {
			t.Fatalf("future=%d err=%v", len(future), err)
		}
	})
	t.Run("two organizations and zero denominator", func(t *testing.T) {
		other := actor
		other.OrganizationID = orgB
		data, err := repo.Dashboard(ctx, other)
		if err != nil || data["overdueReceivables"] != float64(9999) || data["defaultRate"] != float64(100) {
			t.Fatalf("other organization data=%v err=%v", data, err)
		}
		rows, err := repo.ListEntries(ctx, other, url.Values{"status": {"overdue"}})
		if err != nil || len(rows) != 1 {
			t.Fatalf("other rows=%d err=%v", len(rows), err)
		}
		other.OrganizationID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
		data, err = repo.Dashboard(ctx, other)
		if err != nil || data["defaultRate"] != float64(0) {
			t.Fatalf("empty data=%v err=%v", data, err)
		}
	})
	t.Run("Brasilia midnight is independent of database session timezone", func(t *testing.T) {
		for _, zone := range []string{"UTC", "Pacific/Auckland"} {
			if _, err := database.Pool().Exec(ctx, "select set_config('TimeZone', $1, false)", zone); err != nil {
				t.Fatal(err)
			}
			for _, scenario := range []struct {
				instant string
				want    bool
			}{{"2026-11-15T02:59:59Z", false}, {"2026-11-15T03:00:00Z", true}} {
				clock := strings.Replace(financialOverdueTodaySQL, "statement_timestamp()", "$1::timestamptz", 1)
				query := "select " + financialOverdueSQL("e", clock) + ` from (values ('receivable', 'overdue', 100::numeric, 25::numeric, 25::numeric, date '2026-11-14')) as e(type,status,amount,paid_amount,paid_value,due_date)`
				var got bool
				if err := database.Pool().QueryRow(ctx, query, scenario.instant).Scan(&got); err != nil || got != scenario.want {
					t.Fatalf("zone=%s instant=%s got=%v err=%v", zone, scenario.instant, got, err)
				}
			}
		}
	})
	var after string
	if err := database.Pool().QueryRow(ctx, "select jsonb_agg(to_jsonb(e) || jsonb_build_object('created_at', extract(epoch from created_at)) order by id)::text from public.financial_entries e").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("financial reads changed persisted entries")
	}
}

func financialOverduePostgresTargetAllowed(config *pgx.ConnConfig) bool {
	if config == nil || !strings.HasPrefix(config.Database, "vetter_financial_qa_") {
		return false
	}
	loopback := func(host string) bool {
		return host == "127.0.0.1" || host == "localhost" || host == "::1"
	}
	if !loopback(config.Host) {
		return false
	}
	for _, fallback := range config.Fallbacks {
		if fallback == nil || !loopback(fallback.Host) {
			return false
		}
	}
	return true
}

func TestFinancialOverduePostgresTargetGuard(t *testing.T) {
	for _, scenario := range []struct {
		name string
		dsn  string
		want bool
	}{
		{"loopback", "host=127.0.0.1 port=57924 dbname=vetter_financial_qa_fixture sslmode=disable", true},
		{"local TLS fallback", "host=localhost port=57924 dbname=vetter_financial_qa_fixture sslmode=prefer", true},
		{"two loopback hosts", "host=127.0.0.1,::1 port=57924 dbname=vetter_financial_qa_fixture sslmode=disable", true},
		{"remote primary", "host=db.example port=5432 dbname=vetter_financial_qa_fixture sslmode=disable", false},
		{"remote fallback", "host=127.0.0.1,db.example port=57924,5432 dbname=vetter_financial_qa_fixture sslmode=disable", false},
		{"socket fallback", "host=127.0.0.1,/tmp port=57924,5432 dbname=vetter_financial_qa_fixture sslmode=disable", false},
		{"admin database", "host=127.0.0.1 port=57924 dbname=postgres sslmode=disable", false},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			config, err := pgx.ParseConfig(scenario.dsn)
			if err != nil {
				t.Fatal(err)
			}
			if got := financialOverduePostgresTargetAllowed(config); got != scenario.want {
				t.Fatalf("target allowed=%v, want %v", got, scenario.want)
			}
		})
	}
	if financialOverduePostgresTargetAllowed(nil) {
		t.Fatal("nil configuration must be rejected")
	}
}

func numberField(row map[string]any, field string) float64 {
	value, _ := row[field].(float64)
	return value
}
