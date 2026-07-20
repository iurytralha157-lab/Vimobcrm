# Edge Functions

Toda Edge Function implantada no projeto deve ter fonte versionada neste diretório e configuração de autenticação explícita em `supabase/config.toml`.

`verify_jwt = false` só é aceitável para webhooks ou chamadas internas que validem, no próprio handler, uma assinatura ou chave dedicada. Uma função não pode usar `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_DB_URL` sem autenticar e autorizar o chamador antes de qualquer acesso privilegiado.

## Funções aposentadas por segurança

As funções abaixo foram removidas do projeto remoto em 18/07/2026. Elas eram utilitários temporários, não possuíam fonte local e aceitavam chamadas anônimas com acesso privilegiado:

- `temp-fix-db`: executava SQL arbitrário por conexão direta ao Postgres.
- `apply-sql-fix`: aceitava SQL e tentava encaminhá-lo a um RPC privilegiado.
- `apply-plenosobras-flow`: apagava e recriava um pipeline de uma organização fixa.
- `seed-plenosobras`: inseria massa de teste em uma organização real.
- `send-push`: enviava notificações a qualquer `user_id` informado pelo chamador.
- `debug-webhook-status`: retornava dados recentes de leads, WhatsApp e integrações usando service role.
- `migrate-wp-images`: alterava imagens de imóveis de qualquer organização informada pelo chamador.
- `admin-quick-reset`: utilitário one-shot já desativado, mantido publicamente sem necessidade.

Não reimplante esses slugs. Operações de schema devem ser migrações versionadas; operações administrativas devem passar pela API autenticada e pelo catálogo de permissões.
