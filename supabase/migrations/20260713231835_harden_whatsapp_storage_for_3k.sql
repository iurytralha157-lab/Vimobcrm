alter table if exists public.whatsapp_messages set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_threshold = 1000,
  toast.autovacuum_vacuum_scale_factor = 0.02,
  toast.autovacuum_vacuum_threshold = 1000
);

alter table if exists public.whatsapp_conversations set (
  autovacuum_vacuum_scale_factor = 0.03,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_threshold = 500,
  autovacuum_analyze_threshold = 500
);

alter table if exists public.chatbot_inbound_messages set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 1000,
  autovacuum_analyze_threshold = 1000,
  toast.autovacuum_vacuum_scale_factor = 0.02,
  toast.autovacuum_vacuum_threshold = 1000
);

alter table if exists public.media_jobs set (
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01,
  autovacuum_vacuum_threshold = 100,
  autovacuum_analyze_threshold = 100,
  toast.autovacuum_vacuum_scale_factor = 0.02,
  toast.autovacuum_vacuum_threshold = 100
);
