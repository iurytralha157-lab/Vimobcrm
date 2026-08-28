package financial

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type memoryMultipartFile struct {
	*bytes.Reader
}

func (memoryMultipartFile) Close() error { return nil }

type contractDocumentStorageStub struct {
	removeErr       error
	objectPresent   bool
	objectExistsErr error
	removeCalls     [][]string
	existsCalls     int
}

type contractDocumentRow struct {
	value []byte
	err   error
}

func (row contractDocumentRow) Scan(destinations ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(destinations) != 1 {
		return errors.New("unexpected document row destination count")
	}
	target, ok := destinations[0].(*[]byte)
	if !ok {
		return errors.New("unexpected document row destination")
	}
	*target = append((*target)[:0], row.value...)
	return nil
}

type contractDocumentExec struct {
	rows        []contractDocumentRow
	tags        []pgconn.CommandTag
	queries     []string
	queryArgs   [][]any
	execQueries []string
	execArgs    [][]any
}

func (exec *contractDocumentExec) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	exec.queries = append(exec.queries, query)
	exec.queryArgs = append(exec.queryArgs, args)
	if len(exec.rows) == 0 {
		return contractDocumentRow{err: errors.New("unexpected document query")}
	}
	row := exec.rows[0]
	exec.rows = exec.rows[1:]
	return row
}

func (exec *contractDocumentExec) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	exec.execQueries = append(exec.execQueries, query)
	exec.execArgs = append(exec.execArgs, args)
	if len(exec.tags) == 0 {
		return pgconn.NewCommandTag("UPDATE 1"), nil
	}
	tag := exec.tags[0]
	exec.tags = exec.tags[1:]
	return tag, nil
}

func (*contractDocumentStorageStub) upload(context.Context, string, string, string, io.Reader) error {
	return nil
}

func (storage *contractDocumentStorageStub) remove(_ context.Context, _ string, objectPaths []string) error {
	storage.removeCalls = append(storage.removeCalls, append([]string(nil), objectPaths...))
	return storage.removeErr
}

func (*contractDocumentStorageStub) signedURL(context.Context, string, string, int) (string, error) {
	return "", nil
}

func (storage *contractDocumentStorageStub) objectExists(context.Context, string, string) (bool, error) {
	storage.existsCalls++
	return storage.objectPresent, storage.objectExistsErr
}

func TestValidateContractDocumentUpload(t *testing.T) {
	tests := []struct {
		name        string
		fileName    string
		contentType string
		content     []byte
	}{
		{name: "pdf", fileName: "contrato.pdf", contentType: "application/pdf", content: []byte("%PDF-1.7")},
		{name: "jpeg", fileName: "vistoria.jpg", contentType: "image/jpeg", content: []byte{0xff, 0xd8, 0xff, 0xe0}},
		{name: "png", fileName: "planta.png", contentType: "image/png", content: []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}},
		{name: "webp", fileName: "fachada.webp", contentType: "image/webp", content: []byte("RIFF0000WEBP")},
		{name: "docx", fileName: "aditivo.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", content: []byte{'P', 'K', 0x03, 0x04}},
		{name: "xlsx", fileName: "parcelas.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content: []byte{'P', 'K', 0x03, 0x04}},
		{name: "doc", fileName: "minuta.doc", contentType: "application/msword", content: []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}},
		{name: "xls", fileName: "valores.xls", contentType: "application/vnd.ms-excel", content: []byte{0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			file := memoryMultipartFile{Reader: bytes.NewReader(test.content)}
			contentType, err := validateContractDocumentUpload(test.fileName, test.contentType, file)
			if err != nil {
				t.Fatalf("validateContractDocumentUpload() error = %v", err)
			}
			if contentType != test.contentType {
				t.Fatalf("validateContractDocumentUpload() content type = %q, want %q", contentType, test.contentType)
			}
			position, err := file.Seek(0, 1)
			if err != nil {
				t.Fatalf("file.Seek() error = %v", err)
			}
			if position != 0 {
				t.Fatalf("file position = %d, want 0", position)
			}
		})
	}
}

func TestValidateContractDocumentUploadRejectsSpoofedFiles(t *testing.T) {
	tests := []struct {
		name        string
		fileName    string
		contentType string
		content     []byte
	}{
		{name: "unsupported extension", fileName: "script.svg", contentType: "image/svg+xml", content: []byte("<svg")},
		{name: "mismatched mime", fileName: "contrato.pdf", contentType: "image/png", content: []byte("%PDF-1.7")},
		{name: "spoofed signature", fileName: "contrato.pdf", contentType: "application/pdf", content: []byte("not a pdf")},
		{name: "empty file", fileName: "contrato.pdf", contentType: "application/pdf", content: nil},
		{name: "control character in name", fileName: "contrato\n.pdf", contentType: "application/pdf", content: []byte("%PDF-1.7")},
		{name: "name too long", fileName: strings.Repeat("a", 256) + ".pdf", contentType: "application/pdf", content: []byte("%PDF-1.7")},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			file := memoryMultipartFile{Reader: bytes.NewReader(test.content)}
			if _, err := validateContractDocumentUpload(test.fileName, test.contentType, file); err == nil {
				t.Fatal("validateContractDocumentUpload() error = nil, want invalid input")
			}
		})
	}
}

func TestIsContractDocumentObjectPath(t *testing.T) {
	organizationID := "0f1c6daa-0601-4bd8-b130-c90c6a748db8"
	contractID := "bc799028-8b9f-4cf9-bd09-3b591ef3d448"
	validPath := organizationID + "/" + contractID + "/1720000000000_contrato.pdf"

	if !isContractDocumentObjectPath(organizationID, contractID, validPath) {
		t.Fatal("expected the tenant-scoped document path to be accepted")
	}

	invalidPaths := []string{
		"different-organization/" + contractID + "/1720000000000_contrato.pdf",
		organizationID + "/different-contract/1720000000000_contrato.pdf",
		organizationID + "/" + contractID + "/nested/contrato.pdf",
		organizationID + "/" + contractID + "/",
		organizationID + "/" + contractID + "/..",
	}
	for _, path := range invalidPaths {
		if isContractDocumentObjectPath(organizationID, contractID, path) {
			t.Fatalf("expected path %q to be rejected", path)
		}
	}
}

func TestContractDocumentPermissions(t *testing.T) {
	viewer := tenant.Context{MemberRole: "user", Permissions: []string{"financial_view"}}
	manager := tenant.Context{MemberRole: "user", Permissions: []string{"financial_manage"}}
	admin := tenant.Context{MemberRole: "admin"}

	if !canReadFinancial(viewer) {
		t.Fatal("financial viewer should be allowed to list and download contract documents")
	}
	if canManageFinancial(viewer) {
		t.Fatal("financial viewer should not be allowed to upload or delete contract documents")
	}
	if !canReadFinancial(manager) || !canManageFinancial(manager) {
		t.Fatal("financial manager should be allowed to read and manage contract documents")
	}
	if !canReadFinancial(admin) || !canManageFinancial(admin) {
		t.Fatal("organization admin should be allowed to read and manage contract documents")
	}
}

func TestAppendContractDocumentMetadataLocksTenantRowAndChecksRowsAffected(t *testing.T) {
	organizationID := "11111111-1111-4111-8111-111111111111"
	contractID := "22222222-2222-4222-8222-222222222222"
	objectPath := organizationID + "/" + contractID + "/document.pdf"
	document := json.RawMessage(`{"name":"document.pdf","path":"` + objectPath + `"}`)
	exec := &contractDocumentExec{
		rows: []contractDocumentRow{{value: []byte(`[]`)}},
		tags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 1")},
	}

	if err := appendContractDocumentMetadataWithExec(context.Background(), exec, organizationID, contractID, objectPath, document); err != nil {
		t.Fatalf("append metadata: %v", err)
	}
	if len(exec.queries) != 1 || !strings.Contains(strings.ToLower(exec.queries[0]), "for update") {
		t.Fatalf("contract row was not locked: %#v", exec.queries)
	}
	if len(exec.queryArgs) != 1 || exec.queryArgs[0][0] != organizationID || exec.queryArgs[0][1] != contractID {
		t.Fatalf("lock is not tenant scoped: %#v", exec.queryArgs)
	}
	if len(exec.execQueries) != 1 || !strings.Contains(exec.execQueries[0], "organization_id = $1::uuid") || !strings.Contains(exec.execQueries[0], "jsonb_build_array") {
		t.Fatalf("metadata update is not tenant scoped/array safe: %#v", exec.execQueries)
	}

	stale := &contractDocumentExec{
		rows: []contractDocumentRow{{value: []byte(`[]`)}},
		tags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 0")},
	}
	if err := appendContractDocumentMetadataWithExec(context.Background(), stale, organizationID, contractID, objectPath, document); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale append error = %v, want ErrConflict", err)
	}
}

func TestRemoveContractDocumentMetadataLocksAndPreservesExactRecord(t *testing.T) {
	organizationID := "11111111-1111-4111-8111-111111111111"
	contractID := "22222222-2222-4222-8222-222222222222"
	objectPath := organizationID + "/" + contractID + "/document.pdf"
	attachments := `[{"name":"document.pdf","path":"` + objectPath + `","size":10},{"name":"other.pdf","path":"other"}]`
	exec := &contractDocumentExec{
		rows: []contractDocumentRow{{value: []byte(attachments)}},
		tags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 1")},
	}

	document, err := removeContractDocumentMetadataWithExec(context.Background(), exec, organizationID, contractID, objectPath)
	if err != nil {
		t.Fatalf("remove metadata: %v", err)
	}
	var parsed struct {
		Path string `json:"path"`
		Size int    `json:"size"`
	}
	if err := json.Unmarshal(document, &parsed); err != nil {
		t.Fatalf("decode preserved document: %v", err)
	}
	if parsed.Path != objectPath || parsed.Size != 10 {
		t.Fatalf("preserved document = %#v", parsed)
	}
	if len(exec.queries) != 1 || !strings.Contains(strings.ToLower(exec.queries[0]), "for update") {
		t.Fatalf("contract row was not locked: %#v", exec.queries)
	}
	if len(exec.execQueries) != 1 || !strings.Contains(exec.execQueries[0], "organization_id = $1::uuid") || !strings.Contains(exec.execQueries[0], "with ordinality") {
		t.Fatalf("metadata removal is not tenant scoped/order preserving: %#v", exec.execQueries)
	}

	missing := &contractDocumentExec{rows: []contractDocumentRow{{value: []byte(`[]`)}}}
	if _, err := removeContractDocumentMetadataWithExec(context.Background(), missing, organizationID, contractID, objectPath); !errors.Is(err, ErrNotFound) {
		t.Fatalf("missing document error = %v, want ErrNotFound", err)
	}
	if len(missing.execQueries) != 0 {
		t.Fatalf("missing document performed writes: %#v", missing.execQueries)
	}

	stale := &contractDocumentExec{
		rows: []contractDocumentRow{{value: []byte(attachments)}},
		tags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 0")},
	}
	if _, err := removeContractDocumentMetadataWithExec(context.Background(), stale, organizationID, contractID, objectPath); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale metadata removal error = %v, want ErrConflict", err)
	}
}

func TestRestoreContractDocumentMetadataIsIdempotentAndChecksRowsAffected(t *testing.T) {
	organizationID := "11111111-1111-4111-8111-111111111111"
	contractID := "22222222-2222-4222-8222-222222222222"
	objectPath := organizationID + "/" + contractID + "/document.pdf"
	document := json.RawMessage(`{"name":"document.pdf","path":"` + objectPath + `"}`)

	existing := &contractDocumentExec{rows: []contractDocumentRow{{value: []byte(`[` + string(document) + `]`)}}}
	if err := restoreContractDocumentMetadataWithExec(context.Background(), existing, organizationID, contractID, objectPath, document); err != nil {
		t.Fatalf("idempotent restore: %v", err)
	}
	if len(existing.execQueries) != 0 {
		t.Fatalf("existing metadata was duplicated: %#v", existing.execQueries)
	}

	stale := &contractDocumentExec{
		rows: []contractDocumentRow{{value: []byte(`[]`)}},
		tags: []pgconn.CommandTag{pgconn.NewCommandTag("UPDATE 0")},
	}
	if err := restoreContractDocumentMetadataWithExec(context.Background(), stale, organizationID, contractID, objectPath, document); !errors.Is(err, ErrConflict) {
		t.Fatalf("stale restore error = %v, want ErrConflict", err)
	}
}

func TestContractDocumentStorageObjectExistsUsesAuthenticatedInfoEndpoint(t *testing.T) {
	for _, test := range []struct {
		name       string
		statusCode int
		want       bool
		wantErr    bool
	}{
		{name: "exists", statusCode: http.StatusOK, want: true},
		{name: "missing", statusCode: http.StatusNotFound, want: false},
		{name: "storage failure", statusCode: http.StatusServiceUnavailable, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				if request.Method != http.MethodHead {
					t.Fatalf("method = %s, want HEAD", request.Method)
				}
				if request.URL.Path != "/storage/v1/object/info/contract-documents/org/contract/document.pdf" {
					t.Fatalf("path = %s", request.URL.Path)
				}
				if request.Header.Get("apikey") != "service-key" {
					t.Fatalf("service authentication was not sent")
				}
				writer.WriteHeader(test.statusCode)
			}))
			defer server.Close()

			client := storageClient{projectURL: server.URL, apiKey: "service-key", httpClient: server.Client()}
			exists, err := client.objectExists(context.Background(), "contract-documents", "org/contract/document.pdf")
			if (err != nil) != test.wantErr {
				t.Fatalf("objectExists() error = %v, wantErr %v", err, test.wantErr)
			}
			if exists != test.want {
				t.Fatalf("objectExists() = %v, want %v", exists, test.want)
			}
		})
	}
}

func TestContractDocumentUploadCompensationRemovesOrphan(t *testing.T) {
	cause := errors.New("metadata write failed")
	storage := &contractDocumentStorageStub{}
	err := compensateContractDocumentUpload(context.Background(), storage, "org/contract/document.pdf", cause)
	if !errors.Is(err, cause) {
		t.Fatalf("compensation error = %v, want original cause", err)
	}
	if len(storage.removeCalls) != 1 || len(storage.removeCalls[0]) != 1 || storage.removeCalls[0][0] != "org/contract/document.pdf" {
		t.Fatalf("cleanup calls = %#v", storage.removeCalls)
	}

	cleanupErr := errors.New("cleanup failed")
	storage.removeErr = cleanupErr
	err = compensateContractDocumentUpload(context.Background(), storage, "org/contract/document.pdf", cause)
	if !errors.Is(err, cause) || !errors.Is(err, cleanupErr) {
		t.Fatalf("joined compensation error = %v", err)
	}
}

func TestReconcileContractDocumentDeleteFailureRestoresOnlyConfirmedObject(t *testing.T) {
	deleteErr := errors.New("delete response failed")

	t.Run("confirmed missing is successful", func(t *testing.T) {
		storage := &contractDocumentStorageStub{objectPresent: false}
		restored := 0
		err := reconcileContractDocumentDeleteFailure(context.Background(), storage, "path", deleteErr, func(context.Context) error {
			restored++
			return nil
		})
		if err != nil || restored != 0 {
			t.Fatalf("error = %v restored = %d", err, restored)
		}
	})

	t.Run("confirmed existing restores metadata", func(t *testing.T) {
		storage := &contractDocumentStorageStub{objectPresent: true}
		restored := 0
		err := reconcileContractDocumentDeleteFailure(context.Background(), storage, "path", deleteErr, func(context.Context) error {
			restored++
			return nil
		})
		if !errors.Is(err, deleteErr) || restored != 1 {
			t.Fatalf("error = %v restored = %d", err, restored)
		}
	})

	t.Run("unknown outcome never restores", func(t *testing.T) {
		verificationErr := errors.New("verification unavailable")
		storage := &contractDocumentStorageStub{objectExistsErr: verificationErr}
		restored := 0
		err := reconcileContractDocumentDeleteFailure(context.Background(), storage, "path", deleteErr, func(context.Context) error {
			restored++
			return nil
		})
		if !errors.Is(err, deleteErr) || !errors.Is(err, verificationErr) || restored != 0 {
			t.Fatalf("error = %v restored = %d", err, restored)
		}
	})

	t.Run("missing configuration never sent delete and restores", func(t *testing.T) {
		storage := &contractDocumentStorageStub{}
		restored := 0
		err := reconcileContractDocumentDeleteFailure(context.Background(), storage, "path", ErrStorageMissing, func(context.Context) error {
			restored++
			return nil
		})
		if !errors.Is(err, ErrStorageMissing) || restored != 1 || storage.existsCalls != 0 {
			t.Fatalf("error = %v restored = %d existsCalls = %d", err, restored, storage.existsCalls)
		}
	})
}
