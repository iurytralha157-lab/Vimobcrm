package whatsapp

import (
	"bytes"
	"context"
	"fmt"
	"net"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/packages/db"
)

// Opt-in proof against the disposable local Supabase Storage and Postgres pair.
// All bytes, identities and paths are synthetic; no provider is contacted.
func TestLocalUnlinkedStorageGC(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_STORAGE_GC_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_STORAGE_GC_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	host := net.ParseIP(target.Hostname())
	if (target.Hostname() != "localhost" && (host == nil || !host.IsLoopback())) || target.Port() != "57722" {
		t.Fatal("Storage GC fixture requires disposable loopback PostgreSQL port 57722")
	}
	apiURL := strings.TrimRight(strings.TrimSpace(os.Getenv("WHATSAPP_STORAGE_GC_TEST_SUPABASE_URL")), "/")
	apiTarget, err := url.Parse(apiURL)
	if err != nil || apiTarget.Scheme != "http" || apiTarget.Hostname() != "127.0.0.1" || apiTarget.Port() != "57721" {
		t.Fatal("Storage GC fixture requires http://127.0.0.1:57721")
	}
	serviceKey := strings.TrimSpace(os.Getenv("WHATSAPP_STORAGE_GC_TEST_SERVICE_ROLE_KEY"))
	if serviceKey == "" {
		t.Fatal("Storage GC fixture requires the disposable project's service key")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	postgres, err := db.NewPostgres(ctx, db.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	var competingJobs, otherExpired int
	if err := postgres.Pool().QueryRow(ctx, `
		select
		  (select count(*) from private.whatsapp_unlinked_media_gc
		   where status in ('pending', 'retry', 'processing')),
		  (select count(*) from public.whatsapp_conversations
		   where unlinked_retention_v1 and lead_id is null
		     and created_at <= clock_timestamp() - interval '7 days'
		     and unlinked_retention_scrubbed_at is null)
	`).Scan(&competingJobs, &otherExpired); err != nil {
		t.Fatal(err)
	}
	if competingJobs != 0 || otherExpired != 0 {
		t.Fatalf("disposable GC stack has competing work: gc=%d expired=%d", competingJobs, otherExpired)
	}

	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "storage-gc")
	storage := newStorageClient(StorageConfig{ProjectURL: apiURL, APIKey: serviceKey})
	oldPath := fmt.Sprintf("orgs/%s/assets/v2/%s-old.webp", fixture.organizationID, fixture.suffix)
	sharedPath := fmt.Sprintf("orgs/%s/assets/v2/%s-shared.webp", fixture.organizationID, fixture.suffix)
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cleanupCancel()
		for _, path := range []string{oldPath, sharedPath} {
			if err := storage.deleteUnlinkedMediaObject(cleanupCtx, fixture.organizationID, path); err != nil {
				t.Errorf("remove synthetic Storage object: %v", err)
			}
		}
		for _, statement := range []string{
			`delete from private.whatsapp_unlinked_media_gc where organization_id = $1::uuid`,
			`delete from public.whatsapp_messages where organization_id = $1::uuid`,
			`delete from public.whatsapp_conversation_lead_bindings where organization_id = $1::uuid`,
		} {
			if _, err := postgres.Pool().Exec(cleanupCtx, statement, fixture.organizationID); err != nil {
				t.Errorf("remove synthetic GC fixture: %v", err)
			}
		}
		cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)
	})

	for _, path := range []string{oldPath, sharedPath} {
		if err := storage.upload(ctx, whatsappMediaBucket, path, "image/webp",
			bytes.NewReader([]byte("synthetic-vimob-storage-gc-fixture")), false); err != nil {
			t.Fatal(err)
		}
		exists, err := storage.objectExists(ctx, whatsappMediaBucket, path)
		if err != nil || !exists {
			t.Fatalf("synthetic object was not stored: exists=%t err=%v", exists, err)
		}
	}

	oldPhone := fmt.Sprintf("55117%08d", time.Now().UnixNano()%100_000_000)
	oldJID := oldPhone + "@s.whatsapp.net"
	var expiredConversationID, oldOnlyMessageID, sharedOldMessageID, liveMessageID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
		  organization_id, session_id, remote_jid, contact_phone,
		  contact_name, assigned_user_id, is_group
		) values ($1::uuid, $2::uuid, $3, $4, 'Synthetic GC contact', $5::uuid, false)
		returning id::text
	`, fixture.organizationID, fixture.sessionID, oldJID, oldPhone, fixture.userID).Scan(&expiredConversationID); err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		conversationID string
		leadID         string
		providerID     string
		path           string
		captureState   string
		remoteJID      string
		id             *string
	}{
		{expiredConversationID, "", fixture.suffix + "-old-only", oldPath, "unlinked_ephemeral", oldJID, &oldOnlyMessageID},
		{expiredConversationID, "", fixture.suffix + "-old-shared", sharedPath, "unlinked_ephemeral", oldJID, &sharedOldMessageID},
		{fixture.conversationID, fixture.leadID, fixture.suffix + "-live-shared", sharedPath, "captured", fixture.remoteJID, &liveMessageID},
	} {
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_messages (
			  organization_id, conversation_id, session_id, lead_id,
			  provider_message_id, message_id, from_me, direction, message_type,
			  content, media_storage_path, media_status, remote_jid, status, capture_state
			) values (
			  $1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid,
			  $5, $5, false, 'inbound', 'image', 'synthetic media',
			  $6, 'ready', $7, 'received', $8
			) returning id::text
		`, fixture.organizationID, item.conversationID, fixture.sessionID,
			item.leadID, item.providerID, item.path, item.remoteJID,
			item.captureState).Scan(item.id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set created_at = clock_timestamp() - interval '8 days'
		where id = $1::uuid and organization_id = $2::uuid
		  and unlinked_retention_v1 and lead_id is null
	`, expiredConversationID, fixture.organizationID); err != nil {
		t.Fatal(err)
	}
	var scrubStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select private.scrub_expired_whatsapp_unlinked_conversations(500)->>'status'
	`).Scan(&scrubStatus); err != nil || scrubStatus != "processed" {
		t.Fatalf("synthetic seven-day scrub = %q err=%v", scrubStatus, err)
	}
	var scrubbed int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_messages
		where id = any($1::uuid[]) and content is null and media_storage_path is null
		  and unlinked_retention_scrubbed_at is not null
	`, []string{oldOnlyMessageID, sharedOldMessageID}).Scan(&scrubbed); err != nil || scrubbed != 2 {
		t.Fatalf("expired message scrub count=%d err=%v", scrubbed, err)
	}
	var livePath string
	if err := postgres.Pool().QueryRow(ctx, `
		select media_storage_path from public.whatsapp_messages where id = $1::uuid
	`, liveMessageID).Scan(&livePath); err != nil || livePath != sharedPath {
		t.Fatalf("live lead media changed by scrub: path=%q err=%v", livePath, err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{ProjectURL: apiURL, APIKey: serviceKey})
	job, found, err := repo.claimUnlinkedMediaGCJob(ctx)
	if err != nil || !found || job.ObjectPath != oldPath {
		t.Fatalf("first GC claim path=%q found=%t err=%v", job.ObjectPath, found, err)
	}
	if err := repo.processUnlinkedMediaGCJob(ctx, job); err != nil {
		t.Fatalf("real Storage GC delete: %v", err)
	}
	exists, err := storage.objectExists(ctx, whatsappMediaBucket, oldPath)
	if err != nil || exists {
		t.Fatalf("expired unshared object survived GC: exists=%t err=%v", exists, err)
	}
	if err := storage.deleteUnlinkedMediaObject(ctx, fixture.organizationID, oldPath); err != nil {
		t.Fatalf("repeated local Storage DELETE was not idempotent: %v", err)
	}
	if _, found, err := repo.claimUnlinkedMediaGCJob(ctx); err != nil || found {
		t.Fatalf("shared live object was claimed: found=%t err=%v", found, err)
	}
	exists, err = storage.objectExists(ctx, whatsappMediaBucket, sharedPath)
	if err != nil || !exists {
		t.Fatalf("shared live object was deleted: exists=%t err=%v", exists, err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set media_storage_path = null, media_status = null, message_type = 'text'
		where id = $1::uuid and organization_id = $2::uuid
	`, liveMessageID, fixture.organizationID); err != nil {
		t.Fatal(err)
	}
	job, found, err = repo.claimUnlinkedMediaGCJob(ctx)
	if err != nil || !found || job.ObjectPath != sharedPath {
		t.Fatalf("released shared GC claim path=%q found=%t err=%v", job.ObjectPath, found, err)
	}
	if err := repo.processUnlinkedMediaGCJob(ctx, job); err != nil {
		t.Fatalf("released shared real Storage GC delete: %v", err)
	}
	exists, err = storage.objectExists(ctx, whatsappMediaBucket, sharedPath)
	if err != nil || exists {
		t.Fatalf("released shared object survived GC: exists=%t err=%v", exists, err)
	}
	var completed int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from private.whatsapp_unlinked_media_gc
		where organization_id = $1::uuid and status = 'completed'
	`, fixture.organizationID).Scan(&completed); err != nil || completed != 2 {
		t.Fatalf("completed GC rows=%d err=%v", completed, err)
	}
}
