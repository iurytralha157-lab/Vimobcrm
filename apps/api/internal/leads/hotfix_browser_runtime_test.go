package leads_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/app"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/config"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type hotfixBrowserConfig struct {
	TargetConfigPath string `json:"targetConfigPath"`
	JWTSecret        string `json:"jwtSecret"`
	AuthURL          string `json:"authURL"`
	APIAddress       string `json:"apiAddress"`
	FrontendURL      string `json:"frontendURL"`
	ControlDir       string `json:"controlDir"`
}

type hotfixBrowserTarget struct {
	Kind, Host, Database, User, Password, RunID, Datadir string
	Port                                                 int
}

// TestHotfixBrowserRuntime serves the production App.Handler, with only a
// synthetic local auth issuer and disposable PostgreSQL. It never calls
// config.Load, reads .env files, starts providers or launches background jobs.
// An explicit file tick invokes the complete real redistribution worker.
func TestHotfixBrowserRuntime(t *testing.T) {
	file := os.Getenv("VIMOB_HOTFIX_BROWSER_CONFIG")
	if file == "" {
		t.Skip("VIMOB_HOTFIX_BROWSER_CONFIG is not set")
	}
	var settings hotfixBrowserConfig
	hotfixBrowserReadJSON(t, file, &settings)
	if settings.AuthURL != "http://127.0.0.1:38082" || settings.APIAddress != "127.0.0.1:38081" ||
		settings.FrontendURL != "http://127.0.0.1:3007" || len(settings.JWTSecret) < 32 ||
		!filepath.IsAbs(settings.ControlDir) || !filepath.IsAbs(settings.TargetConfigPath) {
		t.Fatal("refusing browser runtime outside the literal local contract")
	}
	workingDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	repositoryRoot := filepath.Clean(filepath.Join(workingDirectory, "../../../.."))
	for _, outside := range []string{file, settings.ControlDir, settings.TargetConfigPath} {
		if !strings.EqualFold(filepath.VolumeName(repositoryRoot), filepath.VolumeName(outside)) {
			continue // A different absolute Windows volume cannot be inside Git.
		}
		relative, err := filepath.Rel(repositoryRoot, outside)
		if err != nil || relative == "." || (!strings.HasPrefix(relative, ".."+string(filepath.Separator)) && relative != "..") {
			t.Fatal("browser runtime controls and credentials must remain outside Git")
		}
	}
	var target hotfixBrowserTarget
	hotfixBrowserReadJSON(t, settings.TargetConfigPath, &target)
	if target.Kind != "vimob-production-distribution-hotfix-postgres-v1" || target.Host != "127.0.0.1" || target.Port != 57533 ||
		!regexp.MustCompile(`^vimob_distribution_hotfix_[a-f0-9]{12}$`).MatchString(target.Database) ||
		!regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(target.RunID) || len(target.Password) < 24 {
		t.Fatal("refusing database outside the disposable sentinel contract")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 35*time.Minute)
	defer cancel()
	connectionURL := &url.URL{Scheme: "postgres", Host: "127.0.0.1:57533", Path: target.Database,
		User: url.UserPassword(target.User, target.Password), RawQuery: "sslmode=disable&application_name=vimob-hotfix-browser&statement_timeout=15000&lock_timeout=8000"}
	databaseConfig := dbpkg.Config{URL: connectionURL.String(), MaxConns: 8, HealthTimeout: 5 * time.Second}
	postgres, err := dbpkg.NewPostgres(ctx, databaseConfig)
	if err != nil {
		t.Fatal("open disposable browser database:", err)
	}
	defer postgres.Close()
	var database, dataDirectory string
	var sentinel int
	err = postgres.Pool().QueryRow(ctx, `select current_database(), current_setting('data_directory'),
		(select count(*) from public.production_distribution_hotfix_sentinel where run_id=$1)`, target.RunID).
		Scan(&database, &dataDirectory, &sentinel)
	if err != nil || database != target.Database || sentinel != 1 ||
		!strings.EqualFold(filepath.Clean(dataDirectory), filepath.Clean(target.Datadir)) {
		t.Fatal("browser database sentinel or data directory mismatch", err)
	}
	previousTransport := http.DefaultTransport
	// Keep the concrete *http.Transport type: provider constructors clone it.
	// Enforce the local destination on every cloned transport as well.
	localTransport := previousTransport.(*http.Transport).Clone()
	localTransport.Proxy = nil
	localTransport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, _, err := net.SplitHostPort(address)
		if err != nil || host != "127.0.0.1" {
			return nil, errors.New("browser homologation blocks non-loopback HTTP")
		}
		return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(ctx, network, address)
	}
	http.DefaultTransport = localTransport
	defer func() { http.DefaultTransport = previousTransport }()
	application, err := app.New(ctx, config.Config{
		Environment: "local-homologation", BackgroundWorkersEnabled: false, Database: databaseConfig,
		Auth:  authpkg.Config{ProjectURL: settings.AuthURL, Issuer: settings.AuthURL + "/auth/v1", Audience: "authenticated", JWTSecret: settings.JWTSecret},
		HTTP:  config.HTTPConfig{Host: "127.0.0.1", Port: "38081", CORSOrigins: []string{settings.FrontendURL}},
		Email: config.EmailConfig{AppURL: settings.FrontendURL},
	}, slog.New(slog.NewTextHandler(os.Stdout, nil)))
	if err != nil {
		t.Fatal("initialize local production App:", err)
	}
	defer application.Close()
	listener, err := net.Listen("tcp4", settings.APIAddress)
	if err != nil {
		t.Fatal(err)
	}
	server := &http.Server{Handler: application.Handler(), ReadHeaderTimeout: 5 * time.Second}
	serveResult := make(chan error, 1)
	go func() { serveResult <- server.Serve(listener) }()
	defer func() {
		shutdown, cancelShutdown := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancelShutdown()
		if err := server.Shutdown(shutdown); err != nil {
			t.Error("shutdown local browser API:", err)
		}
	}()
	if err := os.MkdirAll(settings.ControlDir, 0700); err != nil {
		t.Fatal(err)
	}
	hotfixBrowserWriteJSON(t, settings.ControlDir, "runtime-ready.json", map[string]any{
		"pid": os.Getpid(), "apiAddress": settings.APIAddress, "database": target.Database,
		"sentinelVerified": true, "backgroundWorkersEnabled": false, "providersConfigured": false,
		"workerMode": "explicit-file-ticks-only", "startedAt": time.Now().UTC(),
	})
	repository := leads.NewRepository(postgres, nil)
	timer := time.NewTicker(200 * time.Millisecond)
	defer timer.Stop()
	seen := map[string]bool{}
	for {
		select {
		case <-ctx.Done():
			t.Fatal("browser runtime exceeded its local time limit")
		case err := <-serveResult:
			if !errors.Is(err, http.ErrServerClosed) {
				t.Fatal("local browser API stopped:", err)
			}
			return
		case <-timer.C:
			if _, err := os.Stat(filepath.Join(settings.ControlDir, "stop.request")); err == nil {
				hotfixBrowserWriteJSON(t, settings.ControlDir, "runtime-stopped.json", map[string]any{"stoppedAt": time.Now().UTC(), "pid": os.Getpid()})
				return
			}
			requestFile := filepath.Join(settings.ControlDir, "worker-tick.request")
			if _, err := os.Stat(requestFile); errors.Is(err, os.ErrNotExist) {
				continue
			}
			var request struct {
				Nonce string `json:"nonce"`
			}
			hotfixBrowserReadJSON(t, requestFile, &request)
			if !regexp.MustCompile(`^[a-zA-Z0-9_-]{8,80}$`).MatchString(request.Nonce) {
				t.Fatal("invalid local worker tick nonce")
			}
			if seen[request.Nonce] {
				continue
			}
			tickContext, cancelTick := context.WithTimeout(ctx, 45*time.Second)
			err := repository.ProcessLeadRedistribution(tickContext)
			cancelTick()
			errText := ""
			if err != nil {
				errText = err.Error()
			}
			hotfixBrowserWriteJSON(t, settings.ControlDir, "worker-tick.result.json", map[string]any{
				"nonce": request.Nonce, "error": errText, "completedAt": time.Now().UTC(),
			})
			seen[request.Nonce] = true
		}
	}
}

func hotfixBrowserReadJSON(t *testing.T, file string, output any) {
	t.Helper()
	if !filepath.IsAbs(file) {
		t.Fatal("absolute local control path required")
	}
	info, err := os.Stat(file)
	if err != nil || info.Size() > 1024*1024 {
		t.Fatal("read bounded local control JSON:", err)
	}
	raw, err := os.ReadFile(file)
	if err != nil || json.Unmarshal(raw, output) != nil {
		t.Fatal("invalid local control JSON")
	}
}

func hotfixBrowserWriteJSON(t *testing.T, directory, filename string, value any) {
	t.Helper()
	raw, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	temporary, err := os.CreateTemp(directory, ".runtime-*.json")
	if err != nil {
		t.Fatal(err)
	}
	name := temporary.Name()
	defer os.Remove(name)
	if _, err := fmt.Fprintln(temporary, string(raw)); err != nil {
		t.Fatal(err)
	}
	if err := temporary.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(name, filepath.Join(directory, filename)); err != nil {
		t.Fatal(err)
	}
}
