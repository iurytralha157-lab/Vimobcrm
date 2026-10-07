-- Run with an autocommit-capable client, outside any transaction block.
-- Apply after processing_epoch exists and before activating any session cutover.
-- The claim filters session, epoch and lane before ordering the due head.
-- Keep payload out of the predicate so this build does not inspect webhook JSON.
create index concurrently whatsapp_webhook_inbox_epoch_lane_session_due_head_idx
  on public.whatsapp_webhook_inbox (
    session_id, processing_epoch, processing_lane, created_at, id
  )
  include (next_attempt_at)
  where status in ('pending', 'retry')
    and attempts < max_attempts;

-- Postcheck before cutover: pg_index.indisready and pg_index.indisvalid must
-- both be true for this index. A failed concurrent build can leave an invalid
-- index; inspect that state before any separate, reviewed retry or cleanup.
