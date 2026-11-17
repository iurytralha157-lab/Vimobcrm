package whatsapp

import (
	"context"
	"os"
	"strings"
	"testing"
)

func nativeConversationAssigneeStatements(t *testing.T) (string, string) {
	t.Helper()
	raw, err := os.ReadFile("webhook_native_processor.go")
	if err != nil {
		t.Fatal(err)
	}
	var creation, promotion string
	for _, statement := range strings.Split(string(raw), "`") {
		if strings.Contains(statement, "organization_id, session_id, lead_id, assigned_user_id, remote_jid,") &&
			strings.Contains(statement, "insert into public.whatsapp_conversations (") {
			creation = statement
		}
		if strings.Contains(statement, "update public.whatsapp_conversations") &&
			strings.Contains(statement, "'identity_promotion_source', 'evolution_go_native'") {
			promotion = statement
		}
	}
	for name, statement := range map[string]string{"creation": creation, "promotion": promotion} {
		for _, guard := range []string{
			"case when exists (", "from public.users app_user", "join public.organization_members member",
			"member.user_id = app_user.id and member.organization_id = $1::uuid",
			"coalesce(app_user.is_active, false)", "coalesce(member.is_active, false) and member.deleted_at is null",
		} {
			if !strings.Contains(statement, guard) {
				t.Fatalf("native conversation %s lost active same-organization assignee guard %q", name, guard)
			}
		}
	}
	return creation, promotion
}

func TestNativeConversationAssigneeWritersAreGuarded(t *testing.T) {
	nativeConversationAssigneeStatements(t)
}

func TestNativeConversationDoesNotCopyInactiveLeadAssignee(t *testing.T) {
	creation, promotion := nativeConversationAssigneeStatements(t)
	ctx, db := webhookDependencyDatabase(t)
	for _, state := range []string{"active", "inactive-member", "deleted-member", "inactive-user", "foreign-member-only"} {
		t.Run(state, func(t *testing.T) {
			fixture := newWebhookDependencyFixture(t, ctx, db, "assignee-"+state)
			other := newWebhookDependencyFixture(t, ctx, db, "assignee-other-"+state)
			tx, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer tx.Rollback(context.Background())
			switch state {
			case "inactive-member", "foreign-member-only":
				_, err = tx.Exec(ctx, `update public.organization_members set is_active=false
					where organization_id=$1::uuid and user_id=$2::uuid`, fixture.organizationID, fixture.userID)
			case "deleted-member":
				_, err = tx.Exec(ctx, `update public.organization_members set deleted_at=now()
					where organization_id=$1::uuid and user_id=$2::uuid`, fixture.organizationID, fixture.userID)
			case "inactive-user":
				_, err = tx.Exec(ctx, `update public.users set is_active=false where id=$1::uuid`, fixture.userID)
			}
			if err != nil {
				t.Fatal(err)
			}
			if state == "foreign-member-only" {
				if _, err := tx.Exec(ctx, `insert into public.organization_members(organization_id,user_id,role,is_active)
					values($1::uuid,$2::uuid,'admin',true)`, other.organizationID, fixture.userID); err != nil {
					t.Fatal(err)
				}
			}
			var id, lead, remote string
			if err := tx.QueryRow(ctx, creation, fixture.organizationID, fixture.sessionID, fixture.userID,
				fixture.suffix+"@lid", "", "Synthetic guarded conversation", false).Scan(&id, &lead, &remote); err != nil {
				t.Fatalf("create guarded conversation: %v", err)
			}
			expected := ""
			if state == "active" {
				expected = fixture.userID
			}
			var assigned string
			if err := tx.QueryRow(ctx, `select coalesce(assigned_user_id::text,'')
				from public.whatsapp_conversations where id=$1::uuid`, id).Scan(&assigned); err != nil || assigned != expected {
				t.Fatalf("created assignee matches eligible lead owner = %t, error = %v", assigned == expected, err)
			}
			if _, err := tx.Exec(ctx, `update public.whatsapp_conversations set assigned_user_id=null where id=$1::uuid`, id); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, promotion, fixture.organizationID, fixture.sessionID, id,
				"5599999999999@s.whatsapp.net", "5599999999999", "Synthetic promoted contact", fixture.userID, remote); err != nil {
				t.Fatalf("promote guarded conversation: %v", err)
			}
			var retained, foreignAssignee string
			if err := tx.QueryRow(ctx, `select coalesce(conversation.assigned_user_id::text,''),
				coalesce(lead.assigned_user_id::text,''), coalesce(foreign_conversation.assigned_user_id::text,'')
				from public.whatsapp_conversations conversation
				join public.leads lead on lead.organization_id=conversation.organization_id and lead.id=$2::uuid
				join public.whatsapp_conversations foreign_conversation on foreign_conversation.organization_id=$3::uuid
				  and foreign_conversation.id=$4::uuid
				where conversation.organization_id=$5::uuid and conversation.id=$1::uuid`,
				id, fixture.leadID, other.organizationID, other.conversationID, fixture.organizationID).
				Scan(&assigned, &retained, &foreignAssignee); err != nil {
				t.Fatal(err)
			}
			if assigned != expected || retained != fixture.userID || foreignAssignee != other.userID {
				t.Fatalf("promotion scope: eligible assignee=%t retained lead owner=%t foreign owner=%t",
					assigned == expected, retained == fixture.userID, foreignAssignee == other.userID)
			}
		})
	}
}
