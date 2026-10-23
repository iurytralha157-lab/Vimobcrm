// queue-homologation-runtime runs the real redistribution repository against
// one explicitly approved disposable cluster. It never loads application env.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const approvedProject = "queue-homolog-20261015"
const approvedRoot = "C:/Users/andre/Documents/Codex/2026-10-14/c/work/queue-homologation"

type localManifest struct {
	Kind        string `json:"kind"`
	RunID       string `json:"runId"`
	ProjectID   string `json:"projectId"`
	DatabaseURL string `json:"databaseURL"`
	SupabaseURL string `json:"supabaseURL"`
}

func validateLocalManifest(manifest localManifest) error {
	uuid := regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	if manifest.Kind != "vimob-queue-homologation-v1" || manifest.ProjectID != approvedProject || !uuid.MatchString(manifest.RunID) || strings.TrimRight(manifest.SupabaseURL, "/") != "http://127.0.0.1:57421" {
		return errors.New("unapproved local manifest")
	}
	target, err := url.Parse(manifest.DatabaseURL)
	if err != nil || (target.Scheme != "postgres" && target.Scheme != "postgresql") || target.Hostname() != "127.0.0.1" || target.Port() != "57422" || target.Path != "/postgres" || target.User == nil || target.User.Username() != "postgres" || target.Fragment != "" {
		return errors.New("database must be the approved loopback target")
	}
	if password, exists := target.User.Password(); !exists || password == "" {
		return errors.New("local database credential required")
	}
	for key, values := range target.Query() {
		if key != "sslmode" || len(values) != 1 || values[0] != "disable" {
			return errors.New("unapproved database connection option")
		}
	}
	return nil
}

func run(ctx context.Context, filename string, once, worker bool) error {
	if once && worker {
		return errors.New("choose either once or the production worker")
	}
	actual, err := filepath.Abs(filename)
	if err != nil || !strings.EqualFold(filepath.Clean(filepath.Dir(actual)), filepath.Clean(approvedRoot)) || filepath.Base(actual) != "manifest.json" {
		return errors.New("manifest must belong to the approved isolated runtime")
	}
	raw, err := os.ReadFile(actual)
	if err != nil {
		return errors.New("local manifest unavailable")
	}
	var manifest localManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return errors.New("invalid local manifest")
	}
	if err := validateLocalManifest(manifest); err != nil {
		return err
	}
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: manifest.DatabaseURL, MaxConns: 4, HealthTimeout: 5 * time.Second})
	if err != nil {
		return errors.New("disposable database connection failed")
	}
	defer postgres.Close()
	var database, runID, project string
	var activeCron int
	if err := postgres.Pool().QueryRow(ctx, `select current_database(),run_id::text,project_id,
		(select count(*)::int from cron.job where active) from private.queue_homologation_sentinel where singleton=true`).Scan(&database, &runID, &project, &activeCron); err != nil || database != "postgres" || runID != manifest.RunID || project != approvedProject || activeCron != 0 {
		return errors.New("disposable database sentinel or cron quarantine failed")
	}
	repository := leads.NewRepository(postgres, nil)
	if worker {
		logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{ReplaceAttr: safeRuntimeLogAttribute}))
		logger.Info("local queue runtime mode", "mode", "production_worker")
		// Use the real worker's scheduling, error recovery and repository state.
		// Do not reproduce its loop or change its budgets in this QA command.
		repository.StartRedistributionWorker(ctx, logger)
		<-ctx.Done()
		return nil
	}
	slog.Info("local queue runtime mode", "mode", "qa_fail_fast_cycles", "once", once)
	for cycle := 1; ; cycle++ {
		started := time.Now()
		err := repository.ProcessLeadRedistribution(ctx)
		slog.Info("local queue runtime cycle", "cycle", cycle, "failed", err != nil, "durationMillis", time.Since(started).Milliseconds())
		if err != nil {
			return fmt.Errorf("real redistribution cycle failed: %s", safeCycleError(err))
		}
		if once {
			return nil
		}
		select {
		case <-ctx.Done():
			return nil
		case <-time.After(30 * time.Second):
		}
	}
}

func safeRuntimeLogAttribute(_ []string, attribute slog.Attr) slog.Attr {
	if value, ok := attribute.Value.Any().(error); ok {
		return slog.String(attribute.Key, safeCycleError(value))
	}
	return attribute
}

// Emit only bounded server messages and stable timeout classes. Never print a
// connection URL, SQL arguments, DETAIL, credentials or the manifest content.
func safeCycleError(err error) string {
	var databaseError *pgconn.PgError
	if errors.As(err, &databaseError) {
		message := strings.ReplaceAll(strings.ReplaceAll(databaseError.Message, "\r", " "), "\n", " ")
		if strings.Contains(message, "://") || strings.Contains(strings.ToLower(message), "password") {
			message = "database message omitted"
		}
		if len(message) > 160 {
			message = message[:160]
		}
		return "SQLSTATE " + databaseError.Code + ": " + message
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "context_deadline_exceeded"
	}
	if errors.Is(err, context.Canceled) {
		return "context_canceled"
	}
	return fmt.Sprintf("error_type=%T", err)
}

func main() {
	manifest := flag.String("manifest", "", "absolute disposable manifest path")
	once := flag.Bool("once", false, "run exactly one actual redistribution cycle")
	worker := flag.Bool("worker", false, "run the actual production redistribution worker without changing its scheduling or error recovery")
	flag.Parse()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	if err := run(ctx, *manifest, *once, *worker); err != nil {
		fmt.Fprintln(os.Stderr, err.Error())
		os.Exit(1)
	}
}
