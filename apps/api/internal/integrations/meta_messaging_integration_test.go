package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestMetaOutboundIdempotencyAgainstPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("META_MESSAGING_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set META_MESSAGING_TEST_DATABASE_URL to run the outbound Meta idempotency contract test")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || !isOutboundMessagingLoopbackHost(parsed.Hostname()) {
		t.Fatalf("META_MESSAGING_TEST_DATABASE_URL must use a loopback host")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	pageID := "outbound-page-" + suffix
	contactID := "outbound-contact-" + suffix
	var organizationID, foreignOrganizationID, conversationID string
	if err := database.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug, subscription_status)
		values ($1, $2, 'active')
		returning id::text
	`, "Outbound Meta "+suffix, "outbound-meta-"+suffix).Scan(&organizationID); err != nil {
		t.Fatal(err)
	}
	if err := database.Pool().QueryRow(ctx, `
		insert into public.organizations (name, slug, subscription_status)
		values ($1, $2, 'active')
		returning id::text
	`, "Outbound foreign "+suffix, "outbound-foreign-"+suffix).Scan(&foreignOrganizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cleanupCancel()
		_, _ = database.Pool().Exec(cleanupCtx, `
			delete from public.organizations
			where id in ($1::uuid, $2::uuid)
		`, organizationID, foreignOrganizationID)
	})
	if _, err := database.Pool().Exec(ctx, `
		insert into public.meta_integrations (
			organization_id, page_id, page_name, access_token, is_connected
		)
		values ($1::uuid, $2, 'Outbound test page', $3, true)
	`, organizationID, pageID, "outbound-test-token-"+suffix); err != nil {
		t.Fatal(err)
	}
	if err := database.Pool().QueryRow(ctx, `
		insert into public.meta_conversations (
			organization_id, external_id, platform, page_id,
			unread_count, is_archived
		)
		values ($1::uuid, $2, 'messenger', $3, 0, false)
		returning id::text
	`, organizationID, contactID, pageID).Scan(&conversationID); err != nil {
		t.Fatal(err)
	}

	var callsMu sync.Mutex
	calls := map[string]int{}
	totalCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var payload struct {
			Message struct {
				Text string `json:"text"`
			} `json:"message"`
		}
		if err := json.NewDecoder(request.Body).Decode(&payload); err != nil {
			t.Errorf("decode Graph payload: %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		callsMu.Lock()
		calls[payload.Message.Text]++
		totalCalls++
		callNumber := totalCalls
		callsMu.Unlock()
		if payload.Message.Text == "resultado incerto" {
			http.Error(writer, `{"error":{"message":"temporary"}}`, http.StatusServiceUnavailable)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"recipient_id": contactID,
			"message_id":   fmt.Sprintf("mid.%s.%d", suffix, callNumber),
		})
	}))
	defer server.Close()

	repository := NewRepository(database, ExternalConfig{
		MetaGraphVersion: "v25.0",
		MetaGraphBaseURL: server.URL,
	})
	repository.client = server.Client()
	tenantContext := tenant.Context{OrganizationID: organizationID}

	const sentKey = "11111111-1111-4111-8111-111111111111"
	request := SendMetaMessageRequest{Text: "mensagem idempotente", IdempotencyKey: sentKey}
	first, err := repository.SendMetaMessage(ctx, tenantContext, conversationID, request)
	if err != nil || first.StatusCode != http.StatusCreated || first.Message["status"] != "sent" || first.Message["idempotent_replay"] != false {
		t.Fatalf("first send = %#v, error = %v", first, err)
	}
	replay, err := repository.SendMetaMessage(ctx, tenantContext, conversationID, request)
	if err != nil || replay.StatusCode != http.StatusOK || replay.Message["status"] != "sent" || replay.Message["idempotent_replay"] != true {
		t.Fatalf("sent replay = %#v, error = %v", replay, err)
	}
	if _, err := repository.SendMetaMessage(ctx, tenantContext, conversationID, SendMetaMessageRequest{
		Text: "different payload", IdempotencyKey: sentKey,
	}); !errors.Is(err, ErrIdempotencyConflict) {
		t.Fatalf("same key with different body error = %v", err)
	}

	const uncertainKey = "22222222-2222-4222-8222-222222222222"
	uncertainRequest := SendMetaMessageRequest{Text: "resultado incerto", IdempotencyKey: uncertainKey}
	uncertain, err := repository.SendMetaMessage(ctx, tenantContext, conversationID, uncertainRequest)
	if err != nil || uncertain.StatusCode != http.StatusAccepted || uncertain.Message["status"] != "uncertain" {
		t.Fatalf("uncertain send = %#v, error = %v", uncertain, err)
	}
	uncertainReplay, err := repository.SendMetaMessage(ctx, tenantContext, conversationID, uncertainRequest)
	if err != nil || uncertainReplay.StatusCode != http.StatusAccepted || uncertainReplay.Message["idempotent_replay"] != true {
		t.Fatalf("uncertain replay = %#v, error = %v", uncertainReplay, err)
	}

	const pendingKey = "33333333-3333-4333-8333-333333333333"
	if pending, owned, err := repository.reserveMetaOutboundMessage(
		ctx, organizationID, conversationID, pendingKey, "reserva pendente",
	); err != nil || !owned || pending.Status != "pending" {
		t.Fatalf("pending reservation = %#v owned=%v error=%v", pending, owned, err)
	}
	pendingReplay, err := repository.SendMetaMessage(ctx, tenantContext, conversationID, SendMetaMessageRequest{
		Text: "reserva pendente", IdempotencyKey: pendingKey,
	})
	if err != nil || pendingReplay.StatusCode != http.StatusAccepted || pendingReplay.Message["status"] != "pending" {
		t.Fatalf("pending replay = %#v, error = %v", pendingReplay, err)
	}

	const concurrentKey = "55555555-5555-4555-8555-555555555555"
	concurrentRequest := SendMetaMessageRequest{Text: "envio concorrente", IdempotencyKey: concurrentKey}
	const concurrentRequests = 8
	var concurrentWait sync.WaitGroup
	concurrentWait.Add(concurrentRequests)
	concurrentErrors := make(chan error, concurrentRequests)
	for range concurrentRequests {
		go func() {
			defer concurrentWait.Done()
			result, err := repository.SendMetaMessage(ctx, tenantContext, conversationID, concurrentRequest)
			if err != nil {
				concurrentErrors <- err
				return
			}
			if status, _ := result.Message["status"].(string); status != "pending" && status != "sent" {
				concurrentErrors <- fmt.Errorf("unexpected concurrent state %q", status)
			}
		}()
	}
	concurrentWait.Wait()
	close(concurrentErrors)
	for err := range concurrentErrors {
		t.Fatalf("concurrent send: %v", err)
	}

	const foreignKey = "44444444-4444-4444-8444-444444444444"
	if _, err := repository.SendMetaMessage(ctx, tenant.Context{OrganizationID: foreignOrganizationID}, conversationID, SendMetaMessageRequest{
		Text: "tenant errado", IdempotencyKey: foreignKey,
	}); !errors.Is(err, ErrIntegrationNotFound) {
		t.Fatalf("foreign tenant error = %v, want ErrIntegrationNotFound", err)
	}

	callsMu.Lock()
	sentCalls := calls[request.Text]
	uncertainCalls := calls[uncertainRequest.Text]
	pendingCalls := calls["reserva pendente"]
	concurrentCalls := calls[concurrentRequest.Text]
	foreignCalls := calls["tenant errado"]
	callsMu.Unlock()
	if sentCalls != 1 || uncertainCalls != 1 || pendingCalls != 0 || concurrentCalls != 1 || foreignCalls != 0 {
		t.Fatalf(
			"Graph calls = sent:%d uncertain:%d pending:%d concurrent:%d foreign:%d",
			sentCalls, uncertainCalls, pendingCalls, concurrentCalls, foreignCalls,
		)
	}

	var reservationCount, sentCount, uncertainCount int
	if err := database.Pool().QueryRow(ctx, `
		select
			count(*)::int,
			count(*) filter (where client_request_id = $2::uuid and status = 'sent' and external_id is not null)::int,
			count(*) filter (where client_request_id = $3::uuid and status = 'uncertain' and external_id is null)::int
		from public.meta_messages
		where conversation_id = $1::uuid
		  and client_request_id is not null
	`, conversationID, sentKey, uncertainKey).Scan(&reservationCount, &sentCount, &uncertainCount); err != nil {
		t.Fatal(err)
	}
	if reservationCount != 4 || sentCount != 1 || uncertainCount != 1 {
		t.Fatalf("stored reservations = total:%d sent:%d uncertain:%d", reservationCount, sentCount, uncertainCount)
	}
}

func isOutboundMessagingLoopbackHost(host string) bool {
	host = strings.TrimSpace(strings.Trim(host, "[]"))
	if strings.EqualFold(host, "localhost") {
		return true
	}
	parsed := net.ParseIP(host)
	return parsed != nil && parsed.IsLoopback()
}
