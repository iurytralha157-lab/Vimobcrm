package whatsapp

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type recordingUnlinkedMediaGCTx struct {
	canDelete bool
	terminal  bool
	commitErr error
	events    []string
}

type unlinkedMediaGCBooleanRow struct {
	value bool
}

func (row unlinkedMediaGCBooleanRow) Scan(dest ...any) error {
	*dest[0].(*bool) = row.value
	return nil
}

func (tx *recordingUnlinkedMediaGCTx) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "whatsapp_unlinked_media_gc_can_delete") {
		tx.events = append(tx.events, "can_delete")
		return unlinkedMediaGCBooleanRow{value: tx.canDelete}
	}
	if strings.Contains(sql, "complete_whatsapp_unlinked_media_gc") {
		reason, _ := args[3].(string)
		if args[2] == true {
			tx.events = append(tx.events, "complete_deleted")
		} else {
			tx.events = append(tx.events, "complete_"+reason)
		}
		return unlinkedMediaGCBooleanRow{value: true}
	}
	if strings.Contains(sql, "from private.whatsapp_unlinked_media_gc") {
		tx.events = append(tx.events, "read_terminal")
		return unlinkedMediaGCBooleanRow{value: tx.terminal}
	}
	panic("unexpected GC query")
}

func (tx *recordingUnlinkedMediaGCTx) Commit(context.Context) error {
	tx.events = append(tx.events, "commit")
	return tx.commitErr
}

func (tx *recordingUnlinkedMediaGCTx) Rollback(context.Context) error {
	tx.events = append(tx.events, "rollback")
	return nil
}

func TestUnlinkedMediaGCPathStaysInsideOrganization(t *testing.T) {
	const orgID = "20000000-0000-0000-0000-000000000001"
	for _, test := range []struct {
		path string
		want bool
	}{
		{"orgs/" + orgID + "/assets/v2/file.png", true},
		{"orgs/20000000-0000-0000-0000-000000000002/assets/v2/file.png", false},
		{"orgs/" + orgID + "/../other/file.png", false},
		{"orgs/" + orgID + "/%2e%2e/file.png", false},
		{"orgs/" + orgID + "/assets/v2/file.png?x=1", false},
		{orgID + "/legacy/file.png", false},
	} {
		if got := validUnlinkedMediaGCPath(orgID, test.path); got != test.want {
			t.Fatalf("validUnlinkedMediaGCPath(%q) = %t, want %t", test.path, got, test.want)
		}
	}
}

func TestStorageDeleteUnlinkedMediaUsesAuthenticatedAPIAndAccepts404(t *testing.T) {
	const orgID = "20000000-0000-0000-0000-000000000001"
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		if r.Method != http.MethodDelete || !strings.HasPrefix(r.URL.Path, "/storage/v1/object/whatsapp-media/orgs/"+orgID+"/assets/v2/") {
			t.Errorf("unexpected Storage delete: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("apikey") != "service-role-test-key" || r.Header.Get("Authorization") != "" {
			t.Error("Storage delete omitted service authentication")
		}
		if strings.HasSuffix(r.URL.Path, "/missing.png") {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(r.URL.Path, "/legacy-missing.png") {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"statusCode":"404","error":"not_found","message":"Object not found"}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/invalid.png") {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"statusCode":"400","error":"invalid_request","message":"Object not found"}`))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/error.png") {
			http.Error(w, "sensitive-path-must-not-propagate", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer server.Close()

	client := storageClient{projectURL: server.URL, apiKey: "service-role-test-key", httpClient: server.Client()}
	for _, name := range []string{"exists.png", "missing.png", "legacy-missing.png"} {
		if err := client.deleteUnlinkedMediaObject(context.Background(), orgID, "orgs/"+orgID+"/assets/v2/"+name); err != nil {
			t.Fatalf("delete %s: %v", name, err)
		}
	}
	if err := client.deleteUnlinkedMediaObject(context.Background(), "20000000-0000-0000-0000-000000000002", "orgs/"+orgID+"/assets/v2/exists.png"); err == nil {
		t.Fatal("foreign organization path was accepted")
	}
	if requests != 3 {
		t.Fatalf("Storage requests = %d, want 3", requests)
	}
	err := client.deleteUnlinkedMediaObject(context.Background(), orgID, "orgs/"+orgID+"/assets/v2/invalid.png")
	var statusErr storageDeleteHTTPError
	if !errors.As(err, &statusErr) || statusErr.statusCode != http.StatusBadRequest {
		t.Fatalf("generic Storage 400 = %v, want typed status", err)
	}

	err = client.deleteUnlinkedMediaObject(context.Background(), orgID, "orgs/"+orgID+"/assets/v2/error.png")
	if !errors.As(err, &statusErr) || statusErr.statusCode != http.StatusServiceUnavailable {
		t.Fatalf("Storage 503 = %v, want typed status", err)
	}
	if strings.Contains(err.Error(), "sensitive-path-must-not-propagate") {
		t.Fatal("Storage error body leaked through delete error")
	}
}

func TestUnlinkedRetentionWorkerDefaultsDisabled(t *testing.T) {
	if DefaultWorkerConfig().UnlinkedRetentionWorkerEnabled {
		t.Fatal("unlinked retention worker must start disabled")
	}
}

func TestUnlinkedMediaGCRechecksAndCompletesInsideDeleteTransaction(t *testing.T) {
	const orgID = "20000000-0000-0000-0000-000000000001"
	job := unlinkedMediaGCJob{
		ID: "30000000-0000-0000-0000-000000000001", OrganizationID: orgID,
		Bucket: whatsappMediaBucket, ObjectPath: "orgs/" + orgID + "/assets/v2/file.png",
	}
	for _, test := range []struct {
		name       string
		canDelete  bool
		terminal   bool
		deleteErr  error
		wantEvents []string
		wantDelete bool
		wantErr    bool
	}{
		{"safe delete", true, false, nil, []string{"can_delete", "delete", "complete_deleted", "commit"}, true, false},
		{"live reference", false, false, nil, []string{"can_delete", "complete_live_reference", "commit"}, false, false},
		{"storage retry", true, false, storageDeleteHTTPError{statusCode: 503}, []string{"can_delete", "delete", "complete_storage_http_503", "read_terminal", "commit"}, false, true},
		{"storage terminal", true, true, storageDeleteHTTPError{statusCode: 503}, []string{"can_delete", "delete", "complete_storage_http_503", "read_terminal", "commit"}, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			tx := &recordingUnlinkedMediaGCTx{canDelete: test.canDelete, terminal: test.terminal}
			deleted, err := processUnlinkedMediaGCJobInTx(context.Background(), tx, job, func(_ context.Context, gotOrgID, gotPath string) error {
				if gotOrgID != orgID || gotPath != job.ObjectPath {
					t.Fatalf("delete target = (%q,%q)", gotOrgID, gotPath)
				}
				tx.events = append(tx.events, "delete")
				return test.deleteErr
			})
			if deleted != test.wantDelete || (err != nil) != test.wantErr {
				t.Fatalf("result = (%t,%v), want (%t,error=%t)", deleted, err, test.wantDelete, test.wantErr)
			}
			if strings.Join(tx.events, ",") != strings.Join(test.wantEvents, ",") {
				t.Fatalf("events = %v, want %v", tx.events, test.wantEvents)
			}
			var terminalErr unlinkedMediaGCTerminalError
			if errors.As(err, &terminalErr) != test.terminal {
				t.Fatalf("terminal result = %v, want %t", err, test.terminal)
			}
		})
	}
}

func TestUnlinkedMediaGCTerminalEmitsOneSanitizedEvent(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	err := unlinkedRetentionWorkerError{
		stage: "gc_process",
		err:   unlinkedMediaGCTerminalError{reason: "storage_http_503"},
	}
	logUnlinkedRetentionWorkerError(logger, err)
	if strings.Count(output.String(), "whatsapp unlinked media GC terminal") != 1 ||
		strings.Count(output.String(), "\n") != 1 ||
		!strings.Contains(output.String(), `"reason":"storage_http_503"`) ||
		strings.Contains(output.String(), "gc_process") {
		t.Fatalf("terminal log did not emit one sanitized event: %s", output.String())
	}
}

func TestUnlinkedMediaGCDoesNotReportTerminalBeforeCommit(t *testing.T) {
	const orgID = "20000000-0000-0000-0000-000000000001"
	tx := &recordingUnlinkedMediaGCTx{
		canDelete: true, terminal: true, commitErr: errors.New("commit failed"),
	}
	_, err := processUnlinkedMediaGCJobInTx(context.Background(), tx, unlinkedMediaGCJob{
		ID: "30000000-0000-0000-0000-000000000001", OrganizationID: orgID,
		Bucket: whatsappMediaBucket, ObjectPath: "orgs/" + orgID + "/assets/v2/file.png",
	}, func(context.Context, string, string) error {
		return storageDeleteHTTPError{statusCode: 503}
	})
	var terminalErr unlinkedMediaGCTerminalError
	if !errors.Is(err, tx.commitErr) || errors.As(err, &terminalErr) {
		t.Fatalf("failed commit reported terminal transition: %v", err)
	}
}

func TestUnlinkedMediaGCInvalidPathReportsTerminalOnlyAfterCommit(t *testing.T) {
	const orgID = "20000000-0000-0000-0000-000000000001"
	job := unlinkedMediaGCJob{
		ID: "30000000-0000-0000-0000-000000000001", OrganizationID: orgID,
		Bucket:     whatsappMediaBucket,
		ObjectPath: "orgs/20000000-0000-0000-0000-000000000002/assets/v2/file.png",
	}
	for _, test := range []struct {
		name       string
		commitErr  error
		isTerminal bool
	}{
		{"committed", nil, true},
		{"commit failed", errors.New("commit failed"), false},
	} {
		t.Run(test.name, func(t *testing.T) {
			tx := &recordingUnlinkedMediaGCTx{commitErr: test.commitErr}
			_, err := processUnlinkedMediaGCJobInTx(context.Background(), tx, job,
				func(context.Context, string, string) error {
					t.Fatal("invalid path reached Storage DELETE")
					return nil
				})
			var terminalErr unlinkedMediaGCTerminalError
			if errors.As(err, &terminalErr) != test.isTerminal ||
				(test.isTerminal && terminalErr.reason != "invalid_path") ||
				(!test.isTerminal && !errors.Is(err, test.commitErr)) {
				t.Fatalf("invalid path outcome = %v, want terminal=%t", err, test.isTerminal)
			}
			if strings.Join(tx.events, ",") != "complete_invalid_path,commit" {
				t.Fatalf("invalid path events = %v", tx.events)
			}
		})
	}
}
