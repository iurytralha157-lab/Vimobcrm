# Histórico anterior à baseline

Este diretório preserva as 173 migrations que estavam ativas antes da
reconciliação de 2026-07-22. Elas são material histórico e **não** fazem parte
da cadeia executada por `supabase db push` ou `supabase db reset`.

Não mova esses arquivos de volta para `supabase/migrations`. A cadeia local
antiga não era reproduzível do zero: ela definia
`public.leads.source_session_id` como `text` e depois exigia `uuid` em
`20260719040806_fix_whatsapp_webhook_source_session_uuid.sql`. O ledger remoto
também não era reproduzível: sua primeira migration tentava atualizar
`public.users` antes de a tabela ser criada.

Use este diretório somente para investigação, auditoria e consulta de decisões
históricas. Mudanças futuras devem nascer como migrations novas na pasta ativa.
