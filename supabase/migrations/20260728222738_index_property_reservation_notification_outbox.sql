create index if not exists idx_events_property_reservation_notification_pending
on public.events (created_at, id)
where event_type = 'property_reserved_by_won_lead'
  and entity_type = 'property'
  and status = 'pending';

comment on index public.idx_events_property_reservation_notification_pending is
  'Supports durable recovery of property-reservation notification fan-out jobs.';
