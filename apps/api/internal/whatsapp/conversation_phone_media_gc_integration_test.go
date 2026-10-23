package whatsapp

import (
	"context"
	"testing"
	"time"
)

func TestLocalWhatsAppRetiredCapturedMediaBlocksGC(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "retired-captured-media-gc")
	id := insertHardeningTarget(t, ctx, db.Pool(), f, "-manual-media", "received", false)
	path := "orgs/" + f.organizationID + "/sessions/" + f.sessionID + "/synthetic-retired-manual.pdf"
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_messages set message_type='document',media_status='ready',media_storage_path=$2 where id=$1::uuid;
	 update public.leads set phone='5511777766666' where id=$3::uuid`, id, path, f.leadID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.StartConversation(ctx, f.tenant, phoneConfirmationRequest(f, "5511777766666")); err != nil {
		t.Fatal(err)
	}
	var privateLinks int
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from private.whatsapp_unlinked_history_links where conversation_id=$1::uuid`, f.conversationID).Scan(&privateLinks); err != nil || privateLinks != 0 {
		t.Fatalf("manual fixture unexpectedly has history-link ledger: %d %v", privateLinks, err)
	}
	var gcID string
	if err := db.Pool().QueryRow(ctx, `insert into private.whatsapp_unlinked_media_gc(organization_id,bucket_id,object_path,source_conversation_id)
	 values($1::uuid,'whatsapp-media',$2,$3::uuid) returning id::text`, f.organizationID, path, f.conversationID).Scan(&gcID); err != nil {
		t.Fatal(err)
	}
	// Cover recheck independently of claim; no Storage DELETE or fake HTTP is
	// used. A previously leased job must also respect the immutable attachment.
	if _, err := db.Pool().Exec(ctx, `update private.whatsapp_unlinked_media_gc set status='processing',locked_by='synthetic-manual-gc',locked_at=clock_timestamp() where id=$1::uuid`, gcID); err != nil {
		t.Fatal(err)
	}
	var canDelete bool
	if err := db.Pool().QueryRow(ctx, `select private.whatsapp_unlinked_media_gc_can_delete($1::uuid,'synthetic-manual-gc')`, gcID).Scan(&canDelete); err != nil {
		t.Fatal(err)
	}
	if canDelete {
		t.Error("retired captured lead media can be deleted by GC recheck")
	}
	if _, err := db.Pool().Exec(ctx, `update private.whatsapp_unlinked_media_gc set status='pending',locked_by=null,locked_at=null where id=$1::uuid`, gcID); err != nil {
		t.Fatal(err)
	}
	job, found, err := repo.claimUnlinkedMediaGCJob(ctx)
	if err != nil || found {
		t.Errorf("retired captured lead media was claimed for GC: found=%t sameJob=%t %v", found, job.ID == gcID, err)
	}
}

func TestLocalWhatsAppExpiredUnlinkedMediaStillPermitsGC(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "expired-unlinked-media-gc")
	if _, err := db.Pool().Exec(ctx, `insert into private.whatsapp_webhook_session_cutovers(session_id,active_epoch,cutover_at)values($1::uuid,1,clock_timestamp())`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	var expired string
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone,contact_name)
	 values($1::uuid,$2::uuid,'5511222233333@s.whatsapp.net','5511222233333','Synthetic expired ephemeral') returning id::text`, f.organizationID, f.sessionID).Scan(&expired); err != nil {
		t.Fatal(err)
	}
	path := "orgs/" + f.organizationID + "/sessions/" + f.sessionID + "/synthetic-expired.pdf"
	if _, err := db.Pool().Exec(ctx, `insert into public.whatsapp_messages(organization_id,session_id,conversation_id,message_id,content,from_me,direction,status,capture_state,message_type,media_status,media_storage_path)
	 values($1::uuid,$2::uuid,$3::uuid,$4,'Synthetic expired media',false,'inbound','received','unlinked_ephemeral','document','ready',$5);
	 update public.whatsapp_conversations set created_at=clock_timestamp()-interval '8 days' where id=$3::uuid`, f.organizationID, f.sessionID, expired, f.suffix+"-ephemeral-media", path); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := db.Pool().QueryRow(ctx, `select private.scrub_expired_whatsapp_unlinked_conversations(500)->>'status'`).Scan(&status); err != nil || status != "processed" {
		t.Fatalf("actual expired scrub: %s %v", status, err)
	}
	job, found, err := repo.claimUnlinkedMediaGCJob(ctx)
	if err != nil || !found || job.ObjectPath != path || job.OrganizationID != f.organizationID {
		t.Fatalf("unprotected expired path cannot be reclaimed: %+v %t %v", job, found, err)
	}
	var canDelete bool
	if err := db.Pool().QueryRow(ctx, `select private.whatsapp_unlinked_media_gc_can_delete($1::uuid,$2)`, job.ID, unlinkedRetentionWorkerID).Scan(&canDelete); err != nil || !canDelete {
		t.Fatalf("unprotected expired path recheck denied: %t %v", canDelete, err)
	}
}
