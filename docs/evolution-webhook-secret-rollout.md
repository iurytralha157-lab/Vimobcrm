# Rollout do segredo de callback Evolution

Este rollout exige duas fases e não altera o target canônico do inbox Go: o worker continua encaminhando para `evolution-go-webhook`. O handler `evolution-webhook` atende somente callbacks diretos legados e rejeita o contrato `internal_worker_lease`.

## Fase 1 — provisionar e reconciliar

1. Publicar primeiro o provisionador `evolution-proxy` com `EVOLUTION_WEBHOOK_SECRET` configurado.
2. Confirmar que `createInstance` e `setWebhook` resolvem uma única sessão ativa (`session_id` é preferível; `instanceName` só é aceito quando não é ambíguo) e enviam dois headers: `x-webhook-secret` com a credencial global e `x-webhook-token` com o token individual de `advanced_settings.webhook_token`. Nenhuma credencial pode ir na URL.
3. Reconciliar as instâncias já existentes por uma operação controlada de `setWebhook` e canariar o recebimento autenticado, sessão por sessão.
4. Verificar métricas e logs agregados de rejeição antes de ampliar o canário.

As mudanças de código não comprovam que instâncias antigas receberam o novo header. Essa reconciliação permanece uma etapa operacional obrigatória.

## Fase 2 — fechar o handler

Somente depois do canário e da reconciliação, publicar o `evolution-webhook` com autenticação fail-closed. Callback sem o segredo dedicado deve ser rejeitado antes de ler o body ou criar cliente administrativo. Acompanhar 401/409/503 e interromper a expansão se houver instância ainda sem header.

Não apontar `EVOLUTION_GO_WEBHOOK_URL` para `evolution-webhook`: os envelopes são diferentes. O target do worker deve permanecer `evolution-go-webhook`.
