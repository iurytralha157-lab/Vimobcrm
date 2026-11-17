package whatsapp

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

const evolutionWebhookClaimSessionFilter = "where (nullif(btrim($3), '') is null or ws.id > nullif(btrim($3), '')::uuid)"

type evolutionWebhookClaimQueries struct {
	reserve string
	claim   string
}

var evolutionWebhookLiveClaimQueries = newEvolutionWebhookClaimQueries(evolutionWebhookCandidateSessionsQuery)
var evolutionWebhookBacklogClaimQueries = newEvolutionWebhookClaimQueries(evolutionWebhookBacklogCandidateSessionsQuery)

func newEvolutionWebhookClaimQueries(candidates string) evolutionWebhookClaimQueries {
	reservationCandidates := strings.Replace(candidates, evolutionWebhookClaimSessionFilter, evolutionWebhookClaimSessionFilter+`
			  and nullif($2::text, '') is not null
			  and pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
			    'vimob:whatsapp-webhook:claim:' || ws.organization_id::text || ':' || ws.id::text, 0
			  ))`,
		1,
	)
	reservedCandidates := strings.Replace(candidates, evolutionWebhookClaimSessionFilter,
		evolutionWebhookClaimSessionFilter+" and ws.id = any($5::uuid[])", 1)
	return evolutionWebhookClaimQueries{
		reserve: `with candidate_sessions as materialized (` + reservationCandidates + `) select session_id::text from candidate_sessions order by session_id`,
		claim:   claimEvolutionWebhooksQueryStart + reservedCandidates + claimEvolutionWebhooksQueryEnd,
	}
}

func evolutionWebhookClaimQueriesForLane(lane string) evolutionWebhookClaimQueries {
	if lane == evolutionWebhookLaneBacklog {
		return evolutionWebhookBacklogClaimQueries
	}
	return evolutionWebhookLiveClaimQueries
}

// Reserve only a short claim transaction, not the lifetime of a route's job.
// Both lanes and every new replica use the same tenant/session mutex. Old
// replicas still exclude this claimant through their session NO KEY UPDATE
// fence, which conflicts with this transaction's SHARE fence. Native inbound
// work holds SHARE too, so another route need not wait for that work to finish.
//
// This must remain a separate statement from the reserved claim:
// PostgreSQL evaluates a statement against one snapshot, including when the
// advisory lock becomes available after that snapshot was established.
func reserveEvolutionWebhookClaimSessions(
	ctx context.Context,
	tx pgx.Tx,
	batch int,
	afterSessionID string,
	lane string,
) ([]string, error) {
	queries := evolutionWebhookClaimQueriesForLane(lane)
	rows, err := tx.Query(ctx, queries.reserve, batch, whatsappWebhookWorkerID, afterSessionID, lane)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	sessions := make([]string, 0, batch)
	for rows.Next() {
		var sessionID string
		if err := rows.Scan(&sessionID); err != nil {
			return nil, err
		}
		sessions = append(sessions, sessionID)
	}
	return sessions, rows.Err()
}
