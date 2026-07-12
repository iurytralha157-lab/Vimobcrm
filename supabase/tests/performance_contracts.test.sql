begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select has_index(
  'public',
  'audit_logs',
  'idx_audit_logs_org_created',
  'audit history is indexed by organization and recency'
);

select has_index(
  'public',
  'lead_timeline_events',
  'idx_lead_timeline_org_event',
  'lead timeline is indexed by organization and event time'
);

select has_index(
  'public',
  'whatsapp_conversations',
  'idx_whatsapp_conversations_assigned_user',
  'WhatsApp assignment foreign key is covered'
);

select has_index(
  'public',
  'schedule_events',
  'idx_schedule_events_lead',
  'schedule lead lookups are covered'
);

select * from finish();
rollback;
