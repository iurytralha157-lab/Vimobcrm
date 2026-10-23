package whatsapp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Every HTTP endpoint is this test's httptest server. Storage signing is a
// separate preparation step; reassignment there must still fail the final
// provider-start fence, without an image/audio send or a consumed attempt.
func TestLocalWhatsAppMediaSendAndTransferRegression(t *testing.T) {
	for _, mediaType := range []string{"image", "audio"} {
		for _, boundary := range []string{"sent", "transfer_before_worker", "transfer_during_sign"} {
			t.Run(mediaType+"/"+boundary, func(t *testing.T) {
				ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
				defer cancel()
				postgres := openLocalOutboundDatabase(t, ctx)
				pool := postgres.Pool()
				fixture := createLocalSharedOutboundFixture(t, ctx, pool, mediaType+"-"+boundary)
				clientID := fixture.suffix + "-outbound"
				mimeType, extension := "image/png", "png"
				if mediaType == "audio" {
					mimeType, extension = "audio/ogg", "ogg"
				}
				path := "orgs/" + fixture.organizationID + "/sessions/" + fixture.sessionID + "/outgoing/synthetic." + extension
				insertOutboundMediaSource(t, ctx, pool, fixture, path, mediaType, mimeType)
				var providerCalls, signCalls atomic.Int32
				var transferOnSign, transferCommitted atomic.Bool
				transfer := func() {
					t.Helper()
					if _, err := pool.Exec(ctx, `update public.leads set assigned_user_id=$2::uuid where id=$1::uuid`, fixture.leadID, fixture.userID); err != nil {
						t.Errorf("synthetic transfer: %v", err)
						return
					}
					transferCommitted.Store(true)
				}
				var server *httptest.Server
				server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					if strings.HasPrefix(request.URL.Path, "/storage/v1/object/whatsapp-media/") {
						if request.Method == http.MethodGet {
							_, _ = w.Write([]byte("Synthetic immutable media bytes"))
							return
						}
						if request.Method == http.MethodPost && request.Header.Get("x-upsert") == "false" {
							_, _ = w.Write([]byte(`{"Key":"synthetic"}`))
							return
						}
						t.Errorf("unexpected immutable Storage request %s upsert=%s", request.Method, request.Header.Get("x-upsert"))
						http.Error(w, "unexpected", 400)
						return
					}
					if request.Method == http.MethodPost && request.URL.Path == "/storage/v1/object/sign/whatsapp-media/"+path {
						signCalls.Add(1)
						var body struct {
							ExpiresIn int `json:"expiresIn"`
						}
						if err := json.NewDecoder(request.Body).Decode(&body); err != nil || body.ExpiresIn != 900 {
							t.Errorf("unexpected synthetic signing request: %+v %v", body, err)
						}
						if transferOnSign.CompareAndSwap(true, false) {
							transfer()
						}
						_ = json.NewEncoder(w).Encode(map[string]string{"signedURL": server.URL + "/synthetic-signed/" + extension})
						return
					}
					if request.Method != http.MethodPost || request.URL.Path != "/send/media" {
						t.Errorf("unexpected local HTTP request: %s %s", request.Method, request.URL.Path)
						http.NotFound(w, request)
						return
					}
					providerCalls.Add(1)
					var body map[string]any
					if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
						t.Errorf("decode media send: %v", err)
					}
					if body["id"] != deterministicProviderMessageID(clientID) || body["number"] != fixture.phone ||
						body["type"] != mediaType || body["media"] != server.URL+"/synthetic-signed/"+extension ||
						body["mimetype"] != mimeType || request.Header.Get("instanceId") != fixture.suffix {
						t.Errorf("incorrect synthetic %s payload: %#v", mediaType, body)
					}
					if mediaType == "audio" && (body["ptt"] != true || body["audio"] != body["media"]) {
						t.Errorf("audio lost voice-message payload: %#v", body)
					}
					var started bool
					if err := pool.QueryRow(ctx, `select attempts=1 and last_error=$3 from public.whatsapp_outbox
						where organization_id=$1::uuid and client_message_id=$2`, fixture.organizationID, clientID, whatsappOutboxProviderStartedMarker).Scan(&started); err != nil || !started {
						t.Errorf("provider-start marker was not committed before fake media HTTP: %v", err)
					}
					_ = json.NewEncoder(w).Encode(map[string]string{"messageId": stringFromAny(body["id"])})
				}))
				t.Cleanup(server.Close)
				repo := NewRepository(postgres, nil, StorageConfig{ProjectURL: server.URL, APIKey: "synthetic-service-key",
					EvolutionGo: EvolutionGoConfig{APIURL: server.URL, APIKey: "synthetic-provider-key"}})
				if _, err := repo.JoinConversationAttendance(ctx, fixture.tenant, fixture.conversationID,
					attendanceInput{ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID}); err != nil {
					t.Fatal(err)
				}
				input := sendMessageInput{Text: "synthetic media outbound", MediaType: mediaType, Mimetype: mimeType,
					Filename: "synthetic." + extension, MediaURL: server.URL + "/storage/v1/object/public/whatsapp-media/" + path,
					ClientMessageID: clientID, ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID}
				path = outboundMediaImmutablePath(fixture.organizationID, fixture.sessionID, deterministicProviderMessageID(clientID), mimeType, outboundMediaDigest([]byte("Synthetic immutable media bytes")))
				first, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, input)
				if err != nil || first.Message == nil || first.Status != "queued" {
					t.Fatalf("queue media: %+v %v", first, err)
				}
				if pointerValue(first.Message.MediaStoragePath) != path {
					t.Fatalf("copy did not use immutable digest path: %v", first.Message.MediaStoragePath)
				}
				second, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, input)
				if err != nil || second.Message == nil || second.Message.ID != first.Message.ID || providerCalls.Load() != 0 {
					t.Fatalf("deduplicated media enqueue: %+v %v; calls=%d", second, err, providerCalls.Load())
				}
				item := leaseLocalOutbound(t, ctx, pool, fixture.organizationID, clientID)
				body := mapFromAny(item.Payload["body"])
				if body["mediaStoragePath"] != path || body["mediaUrl"] != nil || body["url"] != nil {
					t.Fatalf("durable media intent contains a bearer URL or wrong storage scope: %#v", body)
				}
				beforeSigning := signCalls.Load()
				if boundary == "transfer_before_worker" {
					transfer()
				} else if boundary == "transfer_during_sign" {
					transferOnSign.Store(true)
				}
				if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneMedia); err != nil {
					t.Fatal(err)
				}
				if boundary != "sent" {
					if !transferCommitted.Load() || providerCalls.Load() != 0 {
						t.Fatalf("transferred media reached provider: transfer=%t calls=%d", transferCommitted.Load(), providerCalls.Load())
					}
					if boundary == "transfer_before_worker" && signCalls.Load() != beforeSigning {
						t.Fatal("revoked media was signed after initial attendance rejection")
					}
					assertLocalOutboundState(t, ctx, pool, item, "failed", 0)
					return
				}
				if providerCalls.Load() != 1 || signCalls.Load() != beforeSigning+1 {
					t.Fatalf("successful media requests: provider=%d sign=%d, baseline=%d", providerCalls.Load(), signCalls.Load(), beforeSigning)
				}
				assertLocalOutboundState(t, ctx, pool, item, "sent", 1)
				for replay := 0; replay < 2; replay++ {
					if err := repo.processNativeEvolutionMessages(ctx, pendingEvolutionWebhook{
						OrganizationID: fixture.organizationID, SessionID: fixture.sessionID, EventType: "messages.upsert", Payload: []byte(`{}`),
					}, []nativeEvolutionMessage{{ProviderMessageID: deterministicProviderMessageID(clientID),
						RemoteJID: fixture.remoteJID, ContactPhone: fixture.phone, SenderJID: "5511888877777@s.whatsapp.net",
						FromMe: true, MessageType: mediaType, Content: input.Text, MediaMimeType: mimeType, SentAt: time.Now().UTC()}}); err != nil {
						t.Fatalf("media echo %d: %v", replay+1, err)
					}
				}
				assertLocalOutboundState(t, ctx, pool, item, "sent", 1)
				if providerCalls.Load() != 1 {
					t.Fatal("media echo repeated fake provider send")
				}
			})
		}
	}
}

func TestLocalWhatsAppReactionSendAndRemovalRegression(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres := openLocalOutboundDatabase(t, ctx)
	pool := postgres.Pool()
	fixture := createLocalSharedOutboundFixture(t, ctx, pool, "reaction-send")
	var providerCalls atomic.Int32
	var expectedEmoji atomic.Value
	expectedEmoji.Store("")
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || (request.URL.Path != "/send/text" && request.URL.Path != "/message/react") {
			t.Errorf("unexpected fake reaction endpoint: %s", request.URL.Path)
			http.NotFound(w, request)
			return
		}
		providerCalls.Add(1)
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode fake reaction request: %v", err)
		}
		if request.URL.Path == "/message/react" && (body["reaction"] != expectedEmoji.Load() || body["number"] != fixture.remoteJID || body["fromMe"] != true) {
			t.Errorf("unexpected reaction body: %#v", body)
		}
		w.Header().Set("Content-Type", "application/json")
		// Reactions acknowledge the target's ID, as compatible providers do.
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": stringFromAny(body["id"])})
	}))
	t.Cleanup(provider.Close)
	repo := NewRepository(postgres, nil, StorageConfig{ProjectURL: provider.URL, APIKey: "synthetic-service-key",
		EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider-key"}})
	if _, err := repo.JoinConversationAttendance(ctx, fixture.tenant, fixture.conversationID,
		attendanceInput{ExpectedLeadID: fixture.leadID, SendSessionID: fixture.sessionID}); err != nil {
		t.Fatal(err)
	}
	targetClientID := fixture.suffix + "-target"
	target, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, sendMessageInput{
		Text: "synthetic reaction target", ClientMessageID: targetClientID, ExpectedLeadID: fixture.leadID})
	if err != nil || target.Message == nil {
		t.Fatalf("reaction target enqueue: %+v %v", target, err)
	}
	if err := repo.processClaimedWhatsAppOutbox(ctx, leaseLocalOutbound(t, ctx, pool, fixture.organizationID, targetClientID), whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	for index, emoji := range []string{"👍", ""} {
		clientID := fixture.suffix + "-reaction-" + string(rune('0'+index))
		expectedEmoji.Store(emoji)
		input := reactToMessageInput{Emoji: emoji, ClientReactionID: clientID, ExpectedLeadID: fixture.leadID}
		first, err := repo.ReactToMessage(ctx, fixture.tenant, fixture.conversationID, target.Message.ID, input)
		if err != nil || first.Reaction == nil || first.Status != "queued" {
			t.Fatalf("reaction enqueue: %+v %v", first, err)
		}
		second, err := repo.ReactToMessage(ctx, fixture.tenant, fixture.conversationID, target.Message.ID, input)
		if err != nil || second.Reaction == nil || second.Reaction.ID != first.Reaction.ID || providerCalls.Load() != int32(index+1) {
			t.Fatalf("reaction dedupe: %+v %v", second, err)
		}
		item := leaseLocalOutbound(t, ctx, pool, fixture.organizationID, clientID)
		if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
			t.Fatal(err)
		}
		assertLocalOutboundState(t, ctx, pool, item, "sent", 1)
		var state, storedEmoji, storedProviderID string
		if err := pool.QueryRow(ctx, `select reaction.status,coalesce(reaction.emoji,''),message.provider_message_id
			from public.whatsapp_message_reactions reaction join public.whatsapp_messages message on message.id=$3::uuid
			where reaction.organization_id=$1::uuid and reaction.target_message_id=$2::uuid
		`, fixture.organizationID, target.Message.ID, first.Reaction.ID).Scan(&state, &storedEmoji, &storedProviderID); err != nil {
			t.Fatal(err)
		}
		wantState := "active"
		if emoji == "" {
			wantState = "removed"
		}
		if state != wantState || storedEmoji != emoji || storedProviderID != deterministicProviderMessageID(clientID) {
			t.Fatalf("reaction completion changed event identity/state: %s %q %s", state, storedEmoji, storedProviderID)
		}
		var duplicate string
		if err := pool.QueryRow(ctx, `select public.apply_whatsapp_provider_reaction(
			$1::uuid,$2::uuid,$3,$4,'5511888877777@s.whatsapp.net','Synthetic',true,$5,now(),
			'completed-outbound-echo',0,0,null,null)->>'outcome'
		`, fixture.organizationID, fixture.sessionID, storedProviderID, deterministicProviderMessageID(targetClientID), emoji).Scan(&duplicate); err != nil || duplicate != "duplicate" {
			t.Fatalf("completed reaction echo: %q %v", duplicate, err)
		}
		assertLocalOutboundState(t, ctx, pool, item, "sent", 1)
	}
	if providerCalls.Load() != 3 {
		t.Fatalf("provider requests=%d, want target+add+remove", providerCalls.Load())
	}
	var pushCount int
	if err := pool.QueryRow(ctx, `select count(*)::int from public.notifications where organization_id=$1::uuid
		and metadata->>'event_key'='whatsapp_inbound_attendant'`, fixture.organizationID).Scan(&pushCount); err != nil || pushCount != 0 {
		t.Fatalf("outbound reaction generated inbound push: %d %v", pushCount, err)
	}
}
