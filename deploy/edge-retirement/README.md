# Retirada final das Edge Functions do WhatsApp

Estes entrypoints sao tombstones deliberadamente sem banco, provider ou
segredos. Eles respondem `410 Gone` e so podem substituir as funcoes ativas
depois que o canario e a migracao integral para o backend forem comprovados.

## Fila de midia no backend Go

O `media-worker` legado tambem esta aposentado. O entrypoint mantido em
`supabase/functions/media-worker` e somente um tombstone `410 Gone`: nao abre
banco, nao chama o provider e nao le segredos.

O fluxo canonico agora pertence a API Go. O webhook grava a mensagem e o job
em `public.media_jobs` na mesma transacao; `StartMediaWorker` reclama um job
com lease no banco, baixa no maximo uma midia por vez entre todas as replicas,
persiste o objeto no Storage e atualiza `public.whatsapp_messages`. Mantenha
`WEBHOOK_FILES=false` no Evolution Go para que o ingresso receba somente
metadados. Audio e video (ate 25 MiB), imagem (ate 10 MiB) e sticker (ate
5 MiB) podem entrar automaticamente; documento exige a acao manual do CRM.
Midia sem tamanho declarado ou acima de 25 MiB nao pode ser baixada.

O corte depende da migration
`supabase/migrations/20260904225214_harden_whatsapp_media_queue.sql` e de uma
imagem da API que ja execute o processador nativo e `StartMediaWorker`; alterar
este tombstone no repositorio, sozinho, nao muda producao.

## Entrega externa de notificacoes

`notification-dispatcher` e o produtor de compatibilidade: ele autentica a
chamada privada, resolve o template e grava uma unica notificacao duravel. Ele
nao chama WhatsApp, e-mail ou push. `notification-service` foi reduzido a um
adaptador privado que encaminha contratos legados para esse produtor, sempre
com `apikey` e `Authorization` de service role.

`notification-evolution-failover` esta aposentado como tombstone `410 Gone`.
Ele nao abre banco, nao le segredos e nao chama provider. O segundo worker
legado poderia disputar a mesma notificacao e provocar envio duplicado; a
entrega externa pertence exclusivamente ao worker canonico do backend Go e a
fila normalizada.

Este estado e somente local. Nao altere `production-manifest.json` para simular
deploy e nao publique as funcoes isoladamente. Antes do corte, aplique e valide
a migration da fila normalizada em staging, confirme o worker canonico ativo,
teste queda/reconexao e comprove zero invocacoes do failover legado. O backlog
historico permanece bloqueado ate um replay explicito e auditado.

Ordem obrigatoria:

1. Todas as sessoes Evolution Go apontam para o webhook do backend.
2. `whatsapp_webhook_inbox` e `whatsapp_outbox` nao possuem trabalho pendente.
3. Logs confirmam zero fallback para a Edge por pelo menos uma janela operacional.
4. O frontend e as automacoes usam apenas API Go/outbox canonico.
5. Aplicar manualmente
   `supabase/cutovers/20260713000500_whatsapp_backend_cutover_security.sql` e
   executar o pgTAP de `supabase/cutovers/tests/`. Esse arquivo fica fora de
   `supabase/migrations` para nunca entrar em um `db push` comum.
6. Publicar os tombstones de `evolution-go-proxy`, `whatsapp-notifier` e
   `whatsapp-history-access` com `verify_jwt=true`.
7. Publicar o tombstone de `evolution-go-webhook` com `verify_jwt=false`, pois
   essa era uma rota de provider; nesse ponto nenhuma instancia pode chama-la.

Nao publique estes arquivos durante o canario. O rollback ainda depende do
webhook legado ate a promocao integral ser concluida.
