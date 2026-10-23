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

	"github.com/jackc/pgx/v5/pgxpool"
)

const nativeOutboundMarker = "whatsapp-native-20261013:57922:vimob_whatsapp_clone"
const nativeOutboundRoot = "D:/Vimob/tmp/whatsapp-db-validation-20261013"

type nativeOutboundRuntime struct {
	Kind     string `json:"kind"`
	Marker   string `json:"marker"`
	Database string `json:"database"`
	Actual   struct {
		SystemIdentifier  string `json:"systemIdentifier"`
		DataDirectory     string `json:"dataDirectory"`
		Port              string `json:"port"`
		ListenAddresses   string `json:"listenAddresses"`
		ServerAddress     string `json:"serverAddress"`
		Fsync             string `json:"fsync"`
		SynchronousCommit string `json:"synchronousCommit"`
	} `json:"actual"`
}

func validNativeOutboundRuntime(raw []byte) (nativeOutboundRuntime, bool) {
	var runtime nativeOutboundRuntime
	if len(raw) > 65536 || json.Unmarshal(raw, &runtime) != nil {
		return runtime, false
	}
	valid := runtime.Kind == "vimob-whatsapp-native-test" && runtime.Marker == nativeOutboundMarker &&
		runtime.Database == "vimob_whatsapp_clone" && regexp.MustCompile(`^[0-9]{16,20}$`).MatchString(runtime.Actual.SystemIdentifier) &&
		filepath.Clean(runtime.Actual.DataDirectory) == filepath.Clean(nativeOutboundRoot+"/data") &&
		runtime.Actual.Port == "57922" && runtime.Actual.ListenAddresses == "127.0.0.1" &&
		(runtime.Actual.ServerAddress == "127.0.0.1" || runtime.Actual.ServerAddress == "127.0.0.1/32") &&
		runtime.Actual.Fsync == "on" && runtime.Actual.SynchronousCommit == "on"
	return runtime, valid
}

func readNativeOutboundRuntime() (nativeOutboundRuntime, bool) {
	path := strings.TrimSpace(os.Getenv("VIMOB_LOCAL_WHATSAPP_NATIVE_RUNTIME"))
	if filepath.Clean(path) != filepath.Clean(nativeOutboundRoot+"/native-runtime.json") {
		return nativeOutboundRuntime{}, false
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nativeOutboundRuntime{}, false
	}
	return validNativeOutboundRuntime(raw)
}

func validOutboundTargetURL(value string) bool {
	u, err := url.Parse(value)
	if err != nil || u.User == nil || u.User.Username() != "postgres" ||
		(u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Hostname() != "127.0.0.1" ||
		u.Port() != "57922" || u.Path != "/vimob_whatsapp_clone" || u.Fragment != "" {
		return false
	}
	// pgx supports query parameters overriding host, port, dbname and user.
	// Never let a URL that merely appears local override the verified target.
	query, err := url.ParseQuery(u.RawQuery)
	return err == nil && len(query) == 1 && len(query["sslmode"]) == 1 && query.Get("sslmode") == "disable"
}

func verifiedLocalOutboundTargetURL() string {
	if os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") == whatsappCIFixtureMarker {
		return verifiedWhatsAppCITarget()
	}
	if os.Getenv("VIMOB_RUN_WHATSAPP_SEND_DB_TESTS") != "LOCAL_WRITE_TEST" {
		return ""
	}
	marker := os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED")
	switch marker {
	case "whatsapp-20261011:57922:vimob_whatsapp_clone":
		// The historical wrapper verifies Docker label/binding before opt-in.
	case nativeOutboundMarker:
		if _, valid := readNativeOutboundRuntime(); !valid {
			return ""
		}
	default:
		return ""
	}
	value := strings.TrimSpace(os.Getenv("WHATSAPP_EPOCH1_TEST_DATABASE_URL"))
	if !validOutboundTargetURL(value) {
		return ""
	}
	return value
}

func verifyNativeOutboundCluster(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	if os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") == whatsappCIFixtureMarker {
		verifyWhatsAppCICluster(t, ctx, pool)
		return
	}
	if os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") != nativeOutboundMarker {
		return
	}
	runtime, valid := readNativeOutboundRuntime()
	if !valid {
		t.Fatal("native fixture runtime proof is missing or invalid")
	}
	var systemID, dataDirectory, address, port, fsync, synchronousCommit, listen string
	err := pool.QueryRow(ctx, `select system_identifier::text,current_setting('data_directory'),
 host(inet_server_addr()),inet_server_port()::text,current_setting('fsync'),
 current_setting('synchronous_commit'),current_setting('listen_addresses') from pg_control_system()`).Scan(
		&systemID, &dataDirectory, &address, &port, &fsync, &synchronousCommit, &listen)
	if err != nil || systemID != runtime.Actual.SystemIdentifier || filepath.Clean(dataDirectory) != filepath.Clean(runtime.Actual.DataDirectory) ||
		address != "127.0.0.1" || port != "57922" || listen != "127.0.0.1" || fsync != "on" || synchronousCommit != "on" {
		t.Fatalf("native fixture actual cluster identity does not match the dedicated manifest: %v", err)
	}
}

func TestLocalOutboundTargetURLRejectsConnectionOverrides(t *testing.T) {
	good := "postgresql://postgres:synthetic@127.0.0.1:57922/vimob_whatsapp_clone?sslmode=disable"
	if !validOutboundTargetURL(good) {
		t.Fatal("exact synthetic local target rejected")
	}
	for _, value := range []string{good + "&host=remote.invalid", good + "&port=55432", good + "&dbname=postgres", good + "&user=service_role", good + "&sslmode=disable", strings.Replace(good, "57922", "55432", 1), strings.Replace(good, "127.0.0.1", "remote.invalid", 1)} {
		if validOutboundTargetURL(value) {
			t.Fatalf("connection override accepted: %s", value)
		}
	}
}

func TestNativeOutboundRuntimeRejectsWrongIdentity(t *testing.T) {
	raw := []byte(`{"kind":"vimob-whatsapp-native-test","marker":"whatsapp-native-20261013:57922:vimob_whatsapp_clone","database":"vimob_whatsapp_clone","actual":{"systemIdentifier":"7696313589555176164","dataDirectory":"D:/Vimob/tmp/whatsapp-db-validation-20261013/data","port":"57922","listenAddresses":"127.0.0.1","serverAddress":"127.0.0.1/32","fsync":"on","synchronousCommit":"on"}}`)
	if _, valid := validNativeOutboundRuntime(raw); !valid {
		t.Fatal("dedicated native fixture rejected")
	}
	for _, replacements := range [][2]string{{"57922", "55432"}, {"127.0.0.1", "0.0.0.0"}, {"\"on\"", "\"off\""}, {"/data", "/other"}, {"7696313589555176164", "unknown"}, {"vimob-whatsapp-native-test", "regular-db"}} {
		changed := strings.ReplaceAll(string(raw), replacements[0], replacements[1])
		if _, valid := validNativeOutboundRuntime([]byte(changed)); valid {
			t.Fatalf("wrong runtime accepted: %v", replacements)
		}
	}
}
