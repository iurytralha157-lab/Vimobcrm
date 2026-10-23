package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestWhatsAppQueuePoolRequiresClaimAgainstPostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 240*time.Second)
	defer cancel()
	db := openWhatsAppQueuePoolDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	for _, state := range []string{"pool_waiting", "pool_ready", "limit_exhausted"} {
		for _, actorKind := range []string{"admin", "member", "leader", "outside"} {
			t.Run(state+"/"+actorKind, func(t *testing.T) {
				f := newWhatsAppPoolFixture(t, ctx, db.Pool(), state+"-"+actorKind, actorKind)
				attendance := attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}
				if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendance); err != nil {
					t.Fatalf("legitimate attendance before pooling: %v", err)
				}
				targetID := newWhatsAppPoolReactionTarget(t, ctx, db.Pool(), f)
				putWhatsAppLeadInPool(t, ctx, db.Pool(), f, state)
				var audience *bool
				if err := db.Pool().QueryRow(ctx, `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)`, f.organizationID, f.leadID, f.userID).Scan(&audience); err != nil || audience == nil || *audience != (actorKind != "outside") {
					t.Fatalf("invalid private audience fixture: access=%v error=%v", audience, err)
				}
				before := whatsAppPoolFingerprint(t, ctx, db.Pool(), f.organizationID)
				want := ErrQueuePoolClaimRequired
				if actorKind == "outside" {
					want = ErrConversationNotFound
				}
				if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendance); !errors.Is(err, want) {
					t.Fatalf("join before claim: %v want=%v", err, want)
				}
				if _, err := repo.SendMessage(ctx, f.tenant, f.conversationID, sendMessageInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID, ClientMessageID: f.suffix + "-blocked", Text: "Must claim first"}); !errors.Is(err, want) {
					t.Fatalf("send before claim: %v want=%v", err, want)
				}
				wantReaction := want
				if actorKind == "outside" {
					// Target authorization deliberately hides an unreadable message
					// before the pool helper is reached: preserve its exact 404.
					wantReaction = ErrMessageNotFound
				}
				if _, err := repo.ReactToMessage(ctx, f.tenant, f.conversationID, targetID, reactToMessageInput{ExpectedLeadID: f.leadID, ClientReactionID: f.suffix + "-blocked-reaction", Emoji: "👍"}); !errors.Is(err, wantReaction) {
					t.Fatalf("reaction before claim: %v want=%v", err, wantReaction)
				}
				if after := whatsAppPoolFingerprint(t, ctx, db.Pool(), f.organizationID); after != before {
					t.Fatal("blocked join/send/reaction changed lead, owner, attendance, runtime, history or outbox")
				}
				if actorKind == "outside" {
					return
				}
				claimWhatsAppPool(t, ctx, db.Pool(), f)
				if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendance); err != nil {
					t.Fatalf("join after actual claim: %v", err)
				}
				queueHardeningMessage(t, ctx, repo, f.sessionConversationLockFixture, sendMessageInput{Text: "Claimed owner send", ClientMessageID: f.suffix + "-allowed"})
				if response, err := repo.ReactToMessage(ctx, f.tenant, f.conversationID, targetID, reactToMessageInput{ExpectedLeadID: f.leadID, ClientReactionID: f.suffix + "-allowed-reaction", Emoji: "👍"}); err != nil || response.Status != "queued" {
					t.Fatalf("reaction after actual claim: status=%s error=%v", response.Status, err)
				}
				var preserved bool
				if err := db.Pool().QueryRow(ctx, `select l.assigned_user_id=$3::uuid and r.state='manual_protected'
				 from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
				 where l.organization_id=$1::uuid and l.id=$2::uuid`, f.organizationID, f.leadID, f.userID).Scan(&preserved); err != nil || !preserved {
					t.Fatalf("claimed owner/protection changed: %t %v", preserved, err)
				}
			})
		}
	}
}

func TestWhatsAppQueuePoolRejectsForeignOrganizationAgainstPostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	db := openWhatsAppQueuePoolDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	a := newWhatsAppPoolFixture(t, ctx, db.Pool(), "tenant-a", "admin")
	b := newWhatsAppPoolFixture(t, ctx, db.Pool(), "tenant-b", "admin")
	putWhatsAppLeadInPool(t, ctx, db.Pool(), a, "pool_waiting")
	putWhatsAppLeadInPool(t, ctx, db.Pool(), b, "pool_waiting")
	before := whatsAppPoolFingerprint(t, ctx, db.Pool(), b.organizationID)
	if _, err := repo.JoinConversationAttendance(ctx, a.tenant, b.conversationID, attendanceInput{ExpectedLeadID: b.leadID, SendSessionID: b.sessionID}); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("cross-organization join: %v", err)
	}
	if _, err := repo.SendMessage(ctx, a.tenant, b.conversationID, sendMessageInput{ExpectedLeadID: b.leadID, SendSessionID: b.sessionID, Text: "foreign must remain hidden", ClientMessageID: a.suffix + "-foreign"}); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("cross-organization send: %v", err)
	}
	if after := whatsAppPoolFingerprint(t, ctx, db.Pool(), b.organizationID); after != before {
		t.Fatal("foreign tenant mutated")
	}
	claimWhatsAppPool(t, ctx, db.Pool(), a)
	if after := whatsAppPoolFingerprint(t, ctx, db.Pool(), b.organizationID); after != before {
		t.Fatal("claim crossed organizations")
	}
}

func TestWhatsAppQueuePoolRechecksAfterLeadWaitAgainstPostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	db := openWhatsAppQueuePoolDatabase(t, ctx)
	var providerCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls.Add(1)
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": "MUST-NOT-SEND"})
	}))
	defer provider.Close()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic"}})
	for _, operation := range []string{"join", "send", "provider_start"} {
		t.Run(operation, func(t *testing.T) {
			f := newWhatsAppPoolFixture(t, ctx, db.Pool(), "lead-wait-"+operation, "admin")
			attendance := attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}
			if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendance); err != nil {
				t.Fatal(err)
			}
			var item pendingWhatsAppOutbox
			if operation == "provider_start" {
				queueHardeningMessage(t, ctx, repo, f.sessionConversationLockFixture, sendMessageInput{Text: "Intent before closure", ClientMessageID: f.suffix + "-pending"})
				item = leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, f.suffix+"-pending")
			}
			warmWhatsAppPoolConnections(t, ctx, db.Pool())
			holder, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer holder.Rollback(context.Background())
			var pid int
			if err := holder.QueryRow(ctx, `select pg_backend_pid() from public.leads where organization_id=$1::uuid and id=$2::uuid for update`, f.organizationID, f.leadID).Scan(&pid); err != nil {
				t.Fatal(err)
			}
			done := make(chan error, 1)
			go func() {
				switch operation {
				case "join":
					_, err = repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendance)
				case "send":
					_, err = repo.SendMessage(ctx, f.tenant, f.conversationID, sendMessageInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID, Text: "Pending closure", ClientMessageID: f.suffix + "-race"})
				case "provider_start":
					err = repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast)
				}
				done <- err
			}()
			waitWhatsAppPoolLeadLock(t, ctx, db.Pool(), pid, f.leadID)
			putWhatsAppLeadInPool(t, ctx, holder, f, "pool_waiting")
			if err := holder.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case err := <-done:
				if operation == "provider_start" {
					if err != nil {
						t.Fatalf("terminal rejection failed: %v", err)
					}
					assertLocalOutboundState(t, ctx, db.Pool(), item, "failed", 0)
				} else if !errors.Is(err, ErrQueuePoolClaimRequired) {
					t.Fatalf("post-wait gate: %v", err)
				}
			case <-ctx.Done():
				t.Fatal("operation did not finish after committed closure")
			}
			if providerCalls.Load() != 0 {
				t.Fatalf("pool intent reached loopback provider %d times", providerCalls.Load())
			}
		})
	}
}

func TestWhatsAppQueuePoolReadAutomationAndPostClaimDeliveryAgainstPostgres(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	db := openWhatsAppQueuePoolDatabase(t, ctx)
	var providerCalls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls.Add(1)
		var body struct {
			ID string `json:"id"`
		}
		if r.Method != http.MethodPost || r.URL.Path != "/send/text" || json.NewDecoder(r.Body).Decode(&body) != nil || body.ID == "" {
			http.Error(w, "unexpected fake send", 400)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": body.ID})
	}))
	defer provider.Close()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic"}})
	f := newWhatsAppPoolFixture(t, ctx, db.Pool(), "automation-read-claim", "admin")
	attendance := attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID, attendance); err != nil {
		t.Fatal(err)
	}
	putWhatsAppLeadInPool(t, ctx, db.Pool(), f, "pool_waiting")
	if response, err := repo.GetConversationAttendance(ctx, f.tenant, f.conversationID, attendance); err != nil || !response.Joined {
		t.Fatalf("pool read changed: joined=%t error=%v", response.Joined, err)
	}
	if err := repo.processNativeEvolutionMessages(ctx, pendingEvolutionWebhook{OrganizationID: f.organizationID, SessionID: f.sessionID, EventType: "messages.upsert", Payload: []byte(`{}`)}, []nativeEvolutionMessage{{
		ProviderMessageID: f.suffix + "-inbound", RemoteJID: f.remoteJID, ContactPhone: f.phone, ContactName: f.suffix,
		FromMe: false, MessageType: "text", Content: "Synthetic inbound while pooled", SentAt: time.Now().UTC(),
	}}); err != nil {
		t.Fatalf("native inbound was blocked by human claim requirement: %v", err)
	}
	var inboundPreserved bool
	if err := db.Pool().QueryRow(ctx, `select r.state='pool_waiting' and l.assigned_user_id is null and exists(select 1 from public.whatsapp_messages m
	 where m.organization_id=l.organization_id and m.lead_id=l.id and m.message_id=$3 and m.direction='inbound')
	 from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
	 where l.organization_id=$1::uuid and l.id=$2::uuid`, f.organizationID, f.leadID, f.suffix+"-inbound").Scan(&inboundPreserved); err != nil || !inboundPreserved {
		t.Fatalf("inbound lost pool state/message: preserved=%t error=%v", inboundPreserved, err)
	}
	automated := f.suffix + "-automation"
	queueHardeningMessage(t, ctx, repo, f.sessionConversationLockFixture, sendMessageInput{Text: "Existing authorized automation", ClientMessageID: automated, InternalAutomation: true})
	item := leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, automated)
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, db.Pool(), item, "sent", 1)
	claimWhatsAppPool(t, ctx, db.Pool(), f)
	human := f.suffix + "-claimed-human"
	queueHardeningMessage(t, ctx, repo, f.sessionConversationLockFixture, sendMessageInput{Text: "Human after claim", ClientMessageID: human})
	item = leaseLocalOutbound(t, ctx, db.Pool(), f.organizationID, human)
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, db.Pool(), item, "sent", 1)
	if providerCalls.Load() != 2 {
		t.Fatalf("fake delivery calls=%d want2", providerCalls.Load())
	}
}
