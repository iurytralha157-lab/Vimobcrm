# Rascunhos do banco de dados

Este diretório é reservado para SQL ainda em revisão e que não pode ser
executado. No momento não existem rascunhos SQL ativos.

Os oito rascunhos-fonte do Vimob v3, criados em 2026-06-21, foram removidos
porque seu conteúdo já existe integralmente em
`supabase/legacy-migrations/20260622000100_apply_vimob_v3_schema.sql`.

O rascunho de agendamento de anúncios foi promovido para
`supabase/migrations/20260722210631_announcements_schedule.sql` depois que a
auditoria do banco ativo confirmou que o frontend depende de campos ausentes no
schema remoto.

`FRONTEND_TO_DATABASE_MAP.md` permanece neste diretório como documentação
histórica de arquitetura; não é um SQL executável.
