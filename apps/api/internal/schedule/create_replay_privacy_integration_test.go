package schedule

import (
	"errors"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
)

func runScheduleCreateReplayPrivacyChecks(t *testing.T, f scheduleHardeningFixtureContext) {
	leader := f.ownerActor
	leader.UserID = f.admin.UserID
	leader.Permissions = append(append([]string(nil), leader.Permissions...), permissions.LeadOperate, permissions.LeadViewOwn, permissions.PropertyView)
	create := func(t *testing.T, lead, property string) (Event, createInput) {
		t.Helper()
		input, err := (CreateRequest{ClientRequestID: f.id(), Title: "Synthetic private delegated replay", EventType: "task", UserID: f.owner, StartTime: f.start, EndTime: f.start.Add(time.Hour), Visibility: "private", LeadID: lead, PropertyID: property}).Validate(leader.UserID)
		if err != nil {
			t.Fatal(err)
		}
		event, err := f.repo.Create(f.ctx, leader, input)
		if err != nil {
			t.Fatal(err)
		}
		return event, input
	}
	t.Run("private delegated creation retry rejects owner's later notes before returning a projection", func(t *testing.T) {
		event, input := create(t, "", "")
		if _, err := f.repo.Get(f.ctx, leader, event.ID); !errors.Is(err, ErrEventNotFound) {
			t.Fatalf("private delegator read: %v", err)
		}
		replay, err := f.repo.Create(f.ctx, leader, input)
		if err != nil || replay.ID != event.ID || replay.OutcomeNotes != nil || replay.GoogleEventID != nil || replay.GoogleSyncStatus != nil {
			t.Fatalf("safe immediate confirmation: %#v %v", replay, err)
		}
		notes := "Owner's private notes entered after creation"
		if _, err := f.repo.Update(f.ctx, f.ownerActor, event.ID, updateInput{OutcomeNotes: patchString{Set: true, Value: &notes}}); err != nil {
			t.Fatal(err)
		}
		replay, err = f.repo.Create(f.ctx, leader, input)
		if !errors.Is(err, ErrScheduleConflict) || replay.ID != "" || replay.OutcomeNotes != nil {
			t.Fatalf("private notes leaked: %#v %v", replay, err)
		}
	})
	t.Run("creation replay checks current lead and property scopes even after earlier authorization", func(t *testing.T) {
		lead, property := f.id(), f.id()
		if _, err := f.pool.Exec(f.ctx, `insert into public.leads(id,organization_id,name,phone,source,assigned_user_id) values($1,$2,'Synthetic visible lead','0000000000','Synthetic',$3)`, lead, f.org, leader.UserID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx, `insert into public.properties(id,organization_id,title,code,responsible_user_id,created_by) values($1,$2,'Synthetic visible property','SYNTHETIC',$3,$3)`, property, f.org, leader.UserID); err != nil {
			t.Fatal(err)
		}
		event, input := create(t, lead, property)
		replay, err := f.repo.Create(f.ctx, leader, input)
		if err != nil || replay.Lead == nil || replay.Property == nil {
			t.Fatalf("authorized initial references: %#v %v", replay, err)
		}
		if _, err := f.pool.Exec(f.ctx, `update public.leads set assigned_user_id=$2,name='Later confidential lead',phone='0000000001' where id=$1`, lead, f.otherMember); err != nil {
			t.Fatal(err)
		}
		// Simulate ownership changing between preflight validation and the
		// replay query. Current relation scope must independently stop it.
		tx, err := f.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		replayed, found, replayErr := findScheduleCreateReplay(f.ctx, tx, leader, input)
		if err := tx.Rollback(f.ctx); err != nil {
			t.Fatal(err)
		}
		if found || !errors.Is(replayErr, ErrScheduleConflict) || replayed.Lead != nil || replayed.ID != "" {
			t.Fatalf("changed lead scope leaked: %#v %v", replayed, replayErr)
		}
		if replay, err = f.repo.Create(f.ctx, leader, input); !errors.Is(err, ErrInvalidReference) || replay.Lead != nil {
			t.Fatalf("preflight must deny lost lead scope: %#v %v", replay, err)
		}
		if _, err := f.pool.Exec(f.ctx, `update public.leads set assigned_user_id=$2 where id=$1`, lead, leader.UserID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.pool.Exec(f.ctx, `update public.properties set responsible_user_id=$2,created_by=$2,title='Later confidential property' where id=$1`, property, f.otherMember); err != nil {
			t.Fatal(err)
		}
		tx, err = f.pool.Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		replayed, found, replayErr = findScheduleCreateReplay(f.ctx, tx, leader, input)
		if err := tx.Rollback(f.ctx); err != nil {
			t.Fatal(err)
		}
		if found || !errors.Is(replayErr, ErrScheduleConflict) || replayed.Property != nil || replayed.ID != "" {
			t.Fatalf("changed property scope leaked: %#v %v", replayed, replayErr)
		}
		if _, err := f.repo.Get(f.ctx, leader, event.ID); !errors.Is(err, ErrEventNotFound) {
			t.Fatalf("replay accidentally granted private read: %v", err)
		}
	})
}
