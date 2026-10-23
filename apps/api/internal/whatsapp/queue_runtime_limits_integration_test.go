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

	"github.com/jackc/pgx/v5/pgconn"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestLocalQueueOutboxStartLockReleasesOnlyItsOwnConversation(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	var sends atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sends.Add(1)
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": stringFromAny(body["id"])})
	}))
	defer provider.Close()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider"}})
	first := outboundHardeningFixture(t, ctx, db, repo, "queue-start-timeout")
	second := secondHardeningConversation(t, ctx, db, repo, first)
	firstCID, successorCID, otherCID := first.suffix+"-head", first.suffix+"-next", first.suffix+"-other"
	for _, message := range []struct {
		fixture sessionConversationLockFixture
		cid     string
	}{{first, firstCID}, {first, successorCID}, {second, otherCID}} {
		queueHardeningMessage(t, ctx, repo, message.fixture, sendMessageInput{Text: "Synthetic bounded start", ClientMessageID: message.cid})
	}
	claimed, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 4, "", whatsappOutboxLaneFast)
	if err != nil || len(claimed) != 2 {
		t.Fatalf("claim independent heads: %d / %v", len(claimed), err)
	}
	var head, other pendingWhatsAppOutbox
	for _, item := range claimed {
		if item.ClientMessageID == firstCID {
			head = item
		} else if item.ClientMessageID == otherCID {
			other = item
		}
	}
	if head.ID == "" || other.ID == "" {
		t.Fatal("claim skipped a head or advanced its successor")
	}
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWhatsAppQueueTx(blocker)
	if _, err := blocker.Exec(ctx, `select id from public.whatsapp_conversations where id=$1::uuid for update`, first.conversationID); err != nil {
		t.Fatal(err)
	}
	jobCtx, cancelJob := context.WithTimeout(ctx, 7*time.Second)
	defer cancelJob() // A watchdog for the unchanged baseline, not the product limit.
	started, done := time.Now(), make(chan error, 1)
	go func() { done <- repo.processClaimedWhatsAppOutbox(jobCtx, head, whatsappOutboxLaneFast) }()
	if err := repo.processClaimedWhatsAppOutbox(ctx, other, whatsappOutboxLaneFast); err != nil {
		t.Fatalf("independent conversation did not progress: %v", err)
	}
	err = <-done
	var sqlError *pgconn.PgError
	if !errors.As(err, &sqlError) || sqlError.Code != "55P03" || time.Since(started) > 5*time.Second {
		t.Fatalf("start waited beyond the local lock budget: %v / %v", err, time.Since(started))
	}
	var status, marker string
	var attempts int
	var locked bool
	if err := db.Pool().QueryRow(ctx, `select status,attempts,coalesce(last_error,''),locked_by is not null from public.whatsapp_outbox where id=$1::uuid`, head.ID).Scan(&status, &attempts, &marker, &locked); err != nil {
		t.Fatal(err)
	}
	if status != "retry" || attempts != 0 || locked || marker != "worker_phase_timed_out" || sends.Load() != 1 {
		t.Fatalf("blocked unstarted work was not safely released: %s/%d/%s/%v sends=%d", status, attempts, marker, locked, sends.Load())
	}
	items, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 4, "", whatsappOutboxLaneFast)
	if err != nil || len(items) != 0 {
		t.Fatalf("retry head lost FIFO: %d / %v", len(items), err)
	}
	rollbackWhatsAppQueueTx(blocker)
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set next_attempt_at=now() where id=$1::uuid`, head.ID); err != nil {
		t.Fatal(err)
	}
	items, err = repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
	if err != nil || len(items) != 1 || items[0].ID != head.ID {
		t.Fatalf("the same head did not resume first: %d / %v", len(items), err)
	}
	if err := repo.processClaimedWhatsAppOutbox(ctx, items[0], whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	items, err = repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
	if err != nil || len(items) != 1 || items[0].ClientMessageID != successorCID {
		t.Fatalf("successor did not follow its completed head: %d / %v", len(items), err)
	}
	if sends.Load() != 2 {
		t.Fatal("blocked work was sent before the lock or duplicated on recovery")
	}
}

func TestLocalQueueOutboxCanceledWorkUsesCurrentDurableMarker(t *testing.T) {
	for _, marker := range []string{"", whatsappOutboxProviderAcceptedMarker, whatsappOutboxProviderStartedMarker, whatsappOutboxProviderUnknownMarker} {
		t.Run("marker-"+marker, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			var sends atomic.Int32
			provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { sends.Add(1); http.Error(w, "must not send", 500) }))
			defer provider.Close()
			repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic-provider"}})
			f := outboundHardeningFixture(t, ctx, db, repo, "queue-marker-timeout")
			queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic current marker", ClientMessageID: f.suffix + "-marker"})
			items, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
			if err != nil || len(items) != 1 {
				t.Fatalf("claim fixture: %d / %v", len(items), err)
			}
			item := items[0]
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set last_error=$2,attempts=1 where id=$1::uuid`, item.ID, marker); err != nil {
				t.Fatal(err)
			}
			canceled, stop := context.WithCancel(ctx)
			stop()
			if err := repo.processClaimedWhatsAppOutbox(canceled, item, whatsappOutboxLaneFast); !errors.Is(err, context.Canceled) {
				t.Fatalf("canceled worker did not retain its original error: %v", err)
			}
			var status, currentMarker string
			var attempts int
			var locked bool
			if err := db.Pool().QueryRow(ctx, `select status,attempts,coalesce(last_error,''),locked_by is not null from public.whatsapp_outbox where id=$1::uuid`, item.ID).Scan(&status, &attempts, &currentMarker, &locked); err != nil {
				t.Fatal(err)
			}
			want, wantMarker := "retry", "worker_phase_timed_out"
			if marker == whatsappOutboxProviderAcceptedMarker {
				wantMarker = marker
			} else if marker != "" {
				want, wantMarker = "dead", whatsappOutboxProviderUnknownMarker
			}
			if status != want || currentMarker != wantMarker || attempts != 1 || locked || sends.Load() != 0 {
				t.Fatalf("cancellation lost its current provider fence: %s/%s/%d/%v sends=%d", status, currentMarker, attempts, locked, sends.Load())
			}
			if marker == whatsappOutboxProviderAcceptedMarker {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_outbox set next_attempt_at=now() where id=$1::uuid`, item.ID); err != nil {
					t.Fatal(err)
				}
				again, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
				if err != nil || len(again) != 1 {
					t.Fatalf("accepted finalizer not eligible: %d / %v", len(again), err)
				}
				if err := repo.processClaimedWhatsAppOutbox(ctx, again[0], whatsappOutboxLaneFast); err != nil {
					t.Fatal(err)
				}
				if sends.Load() != 0 {
					t.Fatal("accepted delivery was POSTed again")
				}
			}
		})
	}
}

func TestLocalQueueMediaCompletionLockCannotOccupyWorkerForever(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createSessionConversationLockFixture(t, ctx, db.Pool(), "media-completion-budget")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, db.Pool(), f) })
	job, asset := queueTimeoutMediaFixture(t, ctx, db, f)
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWhatsAppQueueTx(blocker)
	if _, err := blocker.Exec(ctx, `select id from public.whatsapp_messages where id=$1::uuid for update`, job.MessageID); err != nil {
		t.Fatal(err)
	}
	watchdog, stop := context.WithTimeout(ctx, 7*time.Second)
	defer stop()
	started := time.Now()
	err = repo.completeWhatsAppMediaJob(watchdog, job, asset)
	var sqlError *pgconn.PgError
	if !errors.As(err, &sqlError) || sqlError.Code != "55P03" || time.Since(started) > 5*time.Second {
		t.Fatalf("media completion escaped local lock limit: %v / %v", err, time.Since(started))
	}
	var status string
	var hasStorage bool
	if err := db.Pool().QueryRow(ctx, `select status,storage_path is not null from public.media_jobs where id=$1::uuid`, job.ID).Scan(&status, &hasStorage); err != nil || status != "processing" || hasStorage {
		t.Fatalf("timed-out completion partially changed durable asset: %s/%v/%v", status, hasStorage, err)
	}
	rollbackWhatsAppQueueTx(blocker)
	if err := repo.completeWhatsAppMediaJob(ctx, job, asset); err != nil {
		t.Fatalf("same fenced completion did not recover after unlock: %v", err)
	}
	if err := db.Pool().QueryRow(ctx, `select status,storage_path is not null from public.media_jobs where id=$1::uuid`, job.ID).Scan(&status, &hasStorage); err != nil || status != "completed" || !hasStorage {
		t.Fatalf("asset was not finalized after retry: %s/%v/%v", status, hasStorage, err)
	}
}

func TestLocalQueueTimeoutCleanupDoesNotBorrowAnotherScopeOrLease(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	first := outboundHardeningFixture(t, ctx, db, repo, "queue-timeout-scope-a")
	second := outboundHardeningFixture(t, ctx, db, repo, "queue-timeout-scope-b")
	queueHardeningMessage(t, ctx, repo, first, sendMessageInput{Text: "Synthetic isolated cleanup", ClientMessageID: first.suffix + "-head"})
	items, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
	if err != nil || len(items) != 1 {
		t.Fatalf("claim scoped cleanup: %d/%v", len(items), err)
	}
	item := items[0]
	for _, change := range []func(*pendingWhatsAppOutbox){
		func(wrong *pendingWhatsAppOutbox) { wrong.OrganizationID = second.organizationID },
		func(wrong *pendingWhatsAppOutbox) { wrong.SessionID = second.sessionID },
		func(wrong *pendingWhatsAppOutbox) { wrong.ConversationID = second.conversationID },
		func(wrong *pendingWhatsAppOutbox) { wrong.LeaseToken += "-stale" },
	} {
		wrong := item
		change(&wrong)
		if err := repo.releaseTimedOutWhatsAppOutbox(ctx, wrong); err != nil {
			t.Fatal(err)
		}
	}
	var status, lease string
	if err := db.Pool().QueryRow(ctx, `select status,locked_by from public.whatsapp_outbox where id=$1::uuid`, item.ID).Scan(&status, &lease); err != nil || status != "processing" || lease != item.LeaseToken {
		t.Fatalf("foreign cleanup changed its victim: %s/%s/%v", status, lease, err)
	}
	if err := repo.releaseTimedOutWhatsAppOutbox(ctx, item); err != nil {
		t.Fatal(err)
	}
	if err := repo.releaseTimedOutWhatsAppOutbox(ctx, item); err != nil {
		t.Fatalf("completed lease cleanup was not idempotent: %v", err)
	}
}

func TestLocalQueueCanceledMediaPhaseRollsBackWithoutLiveWaiters(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createSessionConversationLockFixture(t, ctx, db.Pool(), "media-canceled-phase")
	t.Cleanup(func() { cleanupSessionConversationLockFixture(t, db.Pool(), f) })
	job, asset := queueTimeoutMediaFixture(t, ctx, db, f)
	blocker, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWhatsAppQueueTx(blocker)
	if _, err := blocker.Exec(ctx, `select id from public.whatsapp_messages where id=$1::uuid for update`, job.MessageID); err != nil {
		t.Fatal(err)
	}
	phase, stop := context.WithTimeout(ctx, 200*time.Millisecond)
	defer stop()
	if err := repo.completeWhatsAppMediaJob(phase, job, asset); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("canceled database phase lost its error: %v", err)
	}
	var waiters int
	cleanupDeadline := time.Now().Add(2 * time.Second)
	for {
		if err := db.Pool().QueryRow(ctx, `select count(*) from pg_catalog.pg_stat_activity
		 where wait_event_type='Lock' and position($1 in query)>0 and pid<>pg_backend_pid()`, job.MessageID).Scan(&waiters); err != nil {
			t.Fatal(err)
		}
		if waiters == 0 {
			break
		}
		if time.Now().After(cleanupDeadline) {
			t.Fatalf("canceled phase left %d PostgreSQL waiters behind", waiters)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

func queueTimeoutMediaFixture(t *testing.T, ctx context.Context, db *dbpkg.Postgres, f sessionConversationLockFixture) (queuedWhatsAppMediaJob, completedWhatsAppMediaAsset) {
	t.Helper()
	job := queuedWhatsAppMediaJob{OrganizationID: f.organizationID, SessionID: f.sessionID, ConversationID: f.conversationID,
		ProviderMessageID: f.suffix + "-media", AssetKey: hashWhatsAppMediaKey(f.suffix), LockedBy: "synthetic-timeout-worker"}
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_messages
	 (organization_id,session_id,conversation_id,lead_id,provider_message_id,message_id,from_me,direction,message_type,media_mime_type,media_status,media_size,status,sent_at)
	 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$5,false,'inbound','image','image/png','pending',1,'received',now()) returning id::text`,
		f.organizationID, f.sessionID, f.conversationID, f.leadID, job.ProviderMessageID).Scan(&job.MessageID); err != nil {
		t.Fatal(err)
	}
	if err := db.Pool().QueryRow(ctx, `insert into public.media_jobs
	 (organization_id,session_id,conversation_id,message_id,provider_message_id,message_key,media_type,media_mime_type,status,attempts,max_attempts,next_retry_at,dedupe_key,asset_key,declared_size,locked_at,lease_expires_at,lease_duration,locked_by,lease_token,processing_slot,manual_requested)
	 values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'{}','image','image/png','processing',1,3,now(),$6,$7,1,now(),now()+interval '5 minutes',interval '5 minutes',$8,gen_random_uuid(),1,false)
	 returning id::text,lease_token::text`, f.organizationID, f.sessionID, f.conversationID, job.MessageID, job.ProviderMessageID,
		hashWhatsAppMediaKey(f.suffix, "dedupe"), job.AssetKey, job.LockedBy).Scan(&job.ID, &job.LeaseToken); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanup, stop := context.WithTimeout(context.Background(), 5*time.Second)
		defer stop()
		if _, err := db.Pool().Exec(cleanup, `delete from public.media_jobs where organization_id=$1::uuid;
		 delete from public.whatsapp_messages where organization_id=$1::uuid`, f.organizationID); err != nil {
			t.Error(err)
		}
	})
	return job, completedWhatsAppMediaAsset{storagePath: "orgs/" + f.organizationID + "/assets/" + whatsappMediaAssetVersion + "/" + job.AssetKey + ".png", contentType: "image/png", actualSize: 1}
}
