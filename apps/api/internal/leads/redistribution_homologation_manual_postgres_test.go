package leads

import "testing"

func TestMainQueuePostgresManualUnassignedRetryKeepsInitialWeights(t *testing.T) {
	ctx, repo := workerHomologationPostgres(t)
	queue := newHotfixQueue(t, ctx, repo, 5)
	if _, err := repo.db.Pool().Exec(ctx, `
		update public.round_robins set strategy='weighted' where id=$1;
		update public.round_robin_members set weight=4 where round_robin_id=$1 and user_id=$2
	`, queue.queue, queue.users[0]); err != nil {
		t.Fatal(err)
	}

	counts := make(map[string]int)
	for index := 0; index < 16; index++ {
		leadID := workerHomologationUUID(t)
		if _, err := repo.db.Pool().Exec(ctx, `
			insert into public.leads(id,organization_id,origin_round_robin_id,pipeline_id,stage_id)
			values($1,$2,$3,$4,$5)
		`, leadID, queue.org, queue.queue, queue.pipeline, queue.stage); err != nil {
			t.Fatal(err)
		}
		result, err := repo.RedistributeRoundRobin(ctx, hotfixAdmin(queue), leadID, index%2 == 0)
		if err != nil || !result.Success || result.RoundRobinID != queue.queue {
			t.Fatalf("initial retry %d: %+v %v", index, result, err)
		}
		counts[result.AssignedUserID]++
	}
	for index, userID := range queue.users {
		want := 2
		if index == 0 {
			want = 8
		}
		if counts[userID] != want {
			t.Errorf("initial broker %d: got %d assignments, want %d", index, counts[userID], want)
		}
	}
}

func TestMainQueuePostgresManualRedistributionPreservesAssignedLeadContract(t *testing.T) {
	ctx, repo := workerHomologationPostgres(t)
	queue := newHotfixQueue(t, ctx, repo, 3)
	actor := hotfixAdmin(queue)

	result, err := repo.RedistributeRoundRobin(ctx, actor, queue.lead, true)
	want := RoundRobinResult{
		LeadID: queue.lead, PipelineID: queue.pipeline, StageID: queue.stage,
		AssignedUserID: queue.users[0], Error: "already_assigned",
	}
	if err != nil || result != want {
		t.Fatalf("assigned lead retry: got %+v, want %+v, err=%v", result, want, err)
	}

	result, err = repo.RedistributeRoundRobin(ctx, actor, queue.lead, false)
	if err != nil || !result.Success || result.AssignedUserID == queue.users[0] {
		t.Fatalf("manual transfer: %+v %v", result, err)
	}
	var previousUserID string
	err = repo.db.Pool().QueryRow(ctx, `
		select coalesce(metadata->>'previous_user_id','') from public.round_robin_logs
		where organization_id=$1 and lead_id=$2 and reason='round_robin'
	`, queue.org, queue.lead).Scan(&previousUserID)
	if err != nil || previousUserID != queue.users[0] {
		t.Fatalf("manual transfer log missing previous owner: err=%v", err)
	}
}
