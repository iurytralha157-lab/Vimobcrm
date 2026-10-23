package whatsapp

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const whatsappCIFixtureMarker = "vimob-whatsapp-ci-v1"

type whatsappCIRuntime struct {
	Kind, Marker, Root, Database, Nonce string
	CreatedAt                           time.Time
	Actual                              struct {
		SystemIdentifier, DataDirectory, Port, ListenAddresses, ServerAddress, Fsync, SynchronousCommit string
	}
}

// CI is a separate test-only admission path. It never relaxes the historical
// Windows target, and a URL/marker alone is never proof of the actual cluster.
func validWhatsAppCIRuntime(raw []byte, root string, now time.Time) (whatsappCIRuntime, bool) {
	var runtime whatsappCIRuntime
	if len(raw) > 65536 || json.Unmarshal(raw, &runtime) != nil || !filepath.IsAbs(root) || filepath.Base(root) != "vimob-whatsapp-ci" {
		return runtime, false
	}
	age := now.Sub(runtime.CreatedAt)
	valid := runtime.Kind == whatsappCIFixtureMarker && runtime.Marker == whatsappCIFixtureMarker &&
		runtime.Database == "vimob_whatsapp_clone" && filepath.Clean(runtime.Root) == filepath.Clean(root) &&
		regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(runtime.Nonce) && age >= 0 && age <= 6*time.Hour &&
		regexp.MustCompile(`^[0-9]{16,20}$`).MatchString(runtime.Actual.SystemIdentifier) &&
		filepath.Clean(runtime.Actual.DataDirectory) == filepath.Join(root, "data") &&
		runtime.Actual.Port == "57924" && runtime.Actual.ListenAddresses == "127.0.0.1" &&
		runtime.Actual.ServerAddress == "127.0.0.1" && runtime.Actual.Fsync == "on" && runtime.Actual.SynchronousCommit == "on"
	return runtime, valid
}

func readWhatsAppCIRuntime() (whatsappCIRuntime, bool) {
	root := strings.TrimSpace(os.Getenv("VIMOB_WHATSAPP_CI_ROOT"))
	file := strings.TrimSpace(os.Getenv("VIMOB_WHATSAPP_CI_RUNTIME"))
	if !filepath.IsAbs(root) || filepath.Clean(file) != filepath.Join(root, "runtime.json") {
		return whatsappCIRuntime{}, false
	}
	info, err := os.Lstat(file)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return whatsappCIRuntime{}, false
	}
	raw, err := os.ReadFile(file)
	if err != nil {
		return whatsappCIRuntime{}, false
	}
	return validWhatsAppCIRuntime(raw, root, time.Now())
}

func validWhatsAppCITarget(value string) bool {
	u, err := url.Parse(value)
	if err != nil || u.User == nil || u.User.Username() != "postgres" ||
		(u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() != "127.0.0.1" ||
		u.Port() != "57924" || u.Path != "/vimob_whatsapp_clone" || u.Fragment != "" {
		return false
	}
	query, err := url.ParseQuery(u.RawQuery)
	return err == nil && len(query) == 1 && len(query["sslmode"]) == 1 && query.Get("sslmode") == "disable"
}

func verifiedWhatsAppCITarget() string {
	if os.Getenv("VIMOB_RUN_WHATSAPP_CI") != "LOCAL_WRITE_TEST" || os.Getenv("VIMOB_RUN_WHATSAPP_SEND_DB_TESTS") != "LOCAL_WRITE_TEST" ||
		os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") != whatsappCIFixtureMarker {
		return ""
	}
	if _, valid := readWhatsAppCIRuntime(); !valid {
		return ""
	}
	value := strings.TrimSpace(os.Getenv("WHATSAPP_EPOCH1_TEST_DATABASE_URL"))
	if !validWhatsAppCITarget(value) {
		return ""
	}
	return value
}

func verifyWhatsAppCICluster(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	runtime, valid := readWhatsAppCIRuntime()
	if !valid || verifiedWhatsAppCITarget() == "" {
		t.Fatal("CI fixture runtime/opt-in is missing or invalid")
	}
	var systemID, dataDirectory, address, port, fsync, synchronousCommit, listen, database, nonce string
	err := pool.QueryRow(ctx, `select system_identifier::text,current_setting('data_directory'),
 host(inet_server_addr()),inet_server_port()::text,current_setting('fsync'),current_setting('synchronous_commit'),
 current_setting('listen_addresses'),current_database(),
 (select nonce from vimob_ci_fixture.identity where marker=$1) from pg_control_system()`, whatsappCIFixtureMarker).Scan(
		&systemID, &dataDirectory, &address, &port, &fsync, &synchronousCommit, &listen, &database, &nonce)
	if err != nil || systemID != runtime.Actual.SystemIdentifier || filepath.Clean(dataDirectory) != filepath.Clean(runtime.Actual.DataDirectory) ||
		address != "127.0.0.1" || port != "57924" || listen != "127.0.0.1" || fsync != "on" || synchronousCommit != "on" ||
		database != runtime.Database || nonce != runtime.Nonce {
		t.Fatalf("actual CI cluster identity/marker mismatches the owned manifest: %v", err)
	}
}

func TestWhatsAppCITargetRejectsAllConnectionOverrides(t *testing.T) {
	good := "postgresql://postgres:synthetic@127.0.0.1:57924/vimob_whatsapp_clone?sslmode=disable"
	if !validWhatsAppCITarget(good) {
		t.Fatal("valid CI target rejected")
	}
	for _, value := range []string{good + "&host=remote.invalid", good + "&hostaddr=203.0.113.1", good + "&port=5432", good + "&dbname=postgres", good + "&service=remote", good + "&sslmode=disable", strings.Replace(good, "57924", "57922", 1), strings.Replace(good, "127.0.0.1", "localhost", 1)} {
		if validWhatsAppCITarget(value) {
			t.Fatalf("CI target override admitted: %s", value)
		}
	}
}

func TestWhatsAppCIRuntimeRejectsWrongIdentityAndExpiredProof(t *testing.T) {
	root := filepath.Join(t.TempDir(), "vimob-whatsapp-ci")
	now := time.Now()
	runtime := whatsappCIRuntime{Kind: whatsappCIFixtureMarker, Marker: whatsappCIFixtureMarker, Root: root,
		Database: "vimob_whatsapp_clone", Nonce: strings.Repeat("a", 64), CreatedAt: now}
	runtime.Actual.SystemIdentifier = "7696313589555176164"
	runtime.Actual.DataDirectory = filepath.Join(root, "data")
	runtime.Actual.Port = "57924"
	runtime.Actual.ListenAddresses, runtime.Actual.ServerAddress = "127.0.0.1", "127.0.0.1"
	runtime.Actual.Fsync, runtime.Actual.SynchronousCommit = "on", "on"
	raw, _ := json.Marshal(runtime)
	if _, valid := validWhatsAppCIRuntime(raw, root, now); !valid {
		t.Fatal("valid dedicated CI fixture rejected")
	}
	for _, mutate := range []func(*whatsappCIRuntime){func(m *whatsappCIRuntime) { m.Actual.SystemIdentifier = "unknown" },
		func(m *whatsappCIRuntime) { m.Actual.Port = "5432" }, func(m *whatsappCIRuntime) { m.Actual.DataDirectory = filepath.Dir(root) },
		func(m *whatsappCIRuntime) { m.Nonce = "wrong" }, func(m *whatsappCIRuntime) { m.Actual.ListenAddresses = "*" },
		func(m *whatsappCIRuntime) { m.Actual.Fsync = "off" }, func(m *whatsappCIRuntime) { m.CreatedAt = now.Add(-7 * time.Hour) },
		func(m *whatsappCIRuntime) { m.CreatedAt = now.Add(time.Minute) }} {
		changed := runtime
		mutate(&changed)
		raw, _ := json.Marshal(changed)
		if _, valid := validWhatsAppCIRuntime(raw, root, now); valid {
			t.Fatal("wrong/stale CI identity accepted")
		}
	}
}
