package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This opt-in, sequential sample measures the local HTTP webhook, durable
// worker, and authenticated API handlers. It does not measure Realtime or UI.
func TestLocalWhatsAppDeliveryLatencyContract(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_LATENCY_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_LATENCY_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	host := net.ParseIP(target.Hostname())
	nativeFixture := os.Getenv("VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED") == nativeOutboundMarker && databaseURL == localVerifiedOutboundCloneURL()
	if (target.Hostname() != "localhost" && (host == nil || !host.IsLoopback())) || (target.Port() != "57722" && !nativeFixture) {
		t.Fatal("latency fixture requires the disposable loopback PostgreSQL port 57722 or verified native clone")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	if nativeFixture {
		verifyNativeOutboundCluster(t, ctx, postgres.Pool())
	}

	// The real worker is not session-scoped. Never start it if another fixture
	// still owns pending work in this disposable project.
	var otherWork int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_webhook_inbox
		where status in ('pending', 'retry', 'processing')
	`).Scan(&otherWork); err != nil || otherWork != 0 {
		t.Fatalf("disposable inbox has %d unfinished rows: %v", otherWork, err)
	}
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "latency")
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		for _, statement := range []string{
			`delete from public.whatsapp_webhook_routing_snapshots where organization_id = $1::uuid`,
			`delete from public.whatsapp_webhook_inbox where organization_id = $1::uuid`,
			`delete from public.whatsapp_messages where organization_id = $1::uuid`,
			`delete from public.whatsapp_conversations where organization_id = $1::uuid`,
			`delete from public.whatsapp_conversation_lead_bindings where organization_id = $1::uuid`,
			`delete from private.whatsapp_webhook_session_cutovers where session_id in (
				select id from public.whatsapp_sessions where organization_id = $1::uuid
			)`,
		} {
			if _, err := postgres.Pool().Exec(cleanupCtx, statement, fixture.organizationID); err != nil {
				t.Errorf("clean synthetic latency fixture: %v", err)
				return
			}
		}
		cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)
	})
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = '{"token":"synthetic-instance-secret","webhook_token":"synthetic-webhook-secret"}'::jsonb
		where id = $1::uuid and organization_id = $2::uuid
	`, fixture.sessionID, fixture.organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into private.whatsapp_webhook_session_cutovers
		  (session_id, cutoff_at, active_epoch, cutover_at, activated_at)
		values ($1::uuid, clock_timestamp(), 1, clock_timestamp(), clock_timestamp())
	`, fixture.sessionID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{fixture.sessionID}
	if err := repo.ensureEvolutionWebhookSchema(ctx); err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(repo).WithWorkerConfig(WorkerConfig{
		WebhookWorkerEnabled:     true,
		WebhookWorkerInterval:    time.Second,
		WebhookWorkerConcurrency: 4,
	})
	workerCtx, stopWorker := context.WithCancel(ctx)
	t.Cleanup(stopWorker)
	handler.StartWebhookWorker(workerCtx, slog.New(slog.NewTextHandler(io.Discard, nil)))

	mux := http.NewServeMux()
	mux.HandleFunc("POST /webhook", handler.EvolutionGoWebhook)
	mux.HandleFunc("GET /conversations", func(w http.ResponseWriter, r *http.Request) {
		handler.ListConversations(w, r.WithContext(tenant.ContextWithTenant(r.Context(), fixture.tenant)))
	})
	mux.HandleFunc("GET /conversations/{id}/messages", func(w http.ResponseWriter, r *http.Request) {
		handler.ListMessages(w, r.WithContext(tenant.ContextWithTenant(r.Context(), fixture.tenant)))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	client := &http.Client{Timeout: 10 * time.Second}
	unlinkedPhone := fmt.Sprintf("55117%08d", time.Now().UnixNano()%100_000_000)
	if unlinkedPhone == fixture.phone {
		t.Fatal("synthetic lead and unlinked contacts overlap")
	}

	type sample struct{ ack, processed, api time.Duration }
	measure := func(kind, phone, leadID, knownConversationID string) []sample {
		t.Helper()
		results := make([]sample, 0, 10)
		conversationID := knownConversationID
		filter := "withoutLead=true"
		expectedLeadID := "unlinked"
		if leadID != "" {
			filter = "onlyLeads=true"
			expectedLeadID = leadID
		}
		for i := 0; i < 10; i++ {
			messageID := fmt.Sprintf("%s-%s-%02d", fixture.suffix, kind, i)
			content := fmt.Sprintf("synthetic %s %02d", kind, i)
			body, err := json.Marshal(map[string]any{
				"event": "messages.upsert", "instanceId": fixture.suffix,
				"instanceToken": "synthetic-instance-secret",
				"data": map[string]any{"messages": []any{map[string]any{
					"Info": map[string]any{
						"ID": messageID, "Chat": phone + "@s.whatsapp.net",
						"SenderPN": phone + "@s.whatsapp.net", "IsFromMe": false,
						"PushName": "Synthetic Contact", "Timestamp": time.Now().Unix(),
					},
					"Message": map[string]any{"conversation": content},
				}}},
			})
			if err != nil {
				t.Fatal(err)
			}
			endpoint := fmt.Sprintf("%s/webhook?session_id=%s&instance_id=%s",
				server.URL, url.QueryEscape(fixture.sessionID), url.QueryEscape(fixture.suffix))
			request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
			if err != nil {
				t.Fatal(err)
			}
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Webhook-Token", "synthetic-webhook-secret")
			started := time.Now()
			response, err := client.Do(request)
			if err != nil {
				t.Fatal(err)
			}
			var accepted struct {
				Receipt evolutionWebhookReceipt `json:"receipt"`
			}
			decodeErr := json.NewDecoder(response.Body).Decode(&accepted)
			_ = response.Body.Close()
			ackAt := time.Now()
			if response.StatusCode != http.StatusAccepted || decodeErr != nil ||
				accepted.Receipt.Status != "pending" || accepted.Receipt.Duplicate {
				t.Fatalf("%s sample %d: webhook status=%d receipt=%#v decode=%v",
					kind, i, response.StatusCode, accepted.Receipt, decodeErr)
			}
			result := sample{ack: ackAt.Sub(started)}
			deadline := ackAt.Add(60 * time.Second)
			for {
				var state, lastError string
				if err := postgres.Pool().QueryRow(ctx, `
					select status, coalesce(last_error, '') from public.whatsapp_webhook_inbox
					where id = $1::uuid
				`, accepted.Receipt.ID).Scan(&state, &lastError); err != nil {
					t.Fatal(err)
				}
				if state == "processed" {
					result.processed = time.Since(ackAt)
					break
				}
				if state == "dead" || time.Now().After(deadline) {
					t.Fatalf("%s sample %d: inbox %s after %s: %s", kind, i, state, time.Since(ackAt), lastError)
				}
				time.Sleep(25 * time.Millisecond)
			}
			for {
				var list Envelope[[]Conversation]
				readJSON(t, client, server.URL+"/conversations?"+filter, &list)
				visibleInList := false
				for _, conversation := range list.Data {
					if (conversationID != "" && conversation.ID != conversationID) ||
						(conversationID == "" && conversation.RemoteJID != phone+"@s.whatsapp.net") {
						continue
					}
					if conversation.LastMessage != nil && *conversation.LastMessage == content {
						conversationID = conversation.ID
						visibleInList = true
					}
					break
				}
				if visibleInList {
					var page Envelope[MessagePage]
					readJSON(t, client, server.URL+"/conversations/"+conversationID+
						"/messages?expectedLeadId="+url.QueryEscape(expectedLeadID), &page)
					for _, message := range page.Data.Messages {
						if message.MessageID == messageID && message.Content != nil && *message.Content == content {
							result.api = time.Since(ackAt)
							break
						}
					}
				}
				if result.api != 0 {
					break
				}
				if time.Now().After(deadline) {
					t.Fatalf("%s sample %d: list/detail unavailable 60s after ACK", kind, i)
				}
				time.Sleep(25 * time.Millisecond)
			}
			results = append(results, result)
		}
		return results
	}

	for _, cohort := range []struct {
		name, phone, leadID, conversationID string
	}{
		{"lead", fixture.phone, fixture.leadID, fixture.conversationID},
		{"unlinked", unlinkedPhone, "", ""},
	} {
		results := measure(cohort.name, cohort.phone, cohort.leadID, cohort.conversationID)
		acks, processed, api := make([]time.Duration, 0, len(results)), make([]time.Duration, 0, len(results)), make([]time.Duration, 0, len(results))
		for _, result := range results {
			acks = append(acks, result.ack)
			processed = append(processed, result.processed)
			api = append(api, result.api)
		}
		ackMean, ackP95, ackMax := latencySummary(acks)
		processedMean, processedP95, processedMax := latencySummary(processed)
		apiMean, apiP95, apiMax := latencySummary(api)
		t.Logf("%s n=%d HTTP ACK mean=%s p95=%s max=%s; ACK→processed observed mean=%s p95=%s max=%s; ACK→API list+detail observed mean=%s p95=%s max=%s",
			cohort.name, len(results), ackMean, ackP95, ackMax,
			processedMean, processedP95, processedMax, apiMean, apiP95, apiMax)
		if apiP95 > 15*time.Second || apiMax > 60*time.Second {
			t.Errorf("%s API latency exceeds local 15s p95 / 60s all target", cohort.name)
		}
	}
}

func readJSON(t *testing.T, client *http.Client, endpoint string, target any) {
	t.Helper()
	response, err := client.Get(endpoint)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 512))
		t.Fatalf("local API GET returned HTTP %d: %s", response.StatusCode, body)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}

func latencySummary(values []time.Duration) (mean, p95, max time.Duration) {
	if len(values) == 0 {
		return 0, 0, 0
	}
	ordered := append([]time.Duration(nil), values...)
	sort.Slice(ordered, func(i, j int) bool { return ordered[i] < ordered[j] })
	var sum time.Duration
	for _, value := range ordered {
		sum += value
	}
	index := int(math.Ceil(float64(len(ordered))*0.95)) - 1
	return sum / time.Duration(len(ordered)), ordered[index], ordered[len(ordered)-1]
}
