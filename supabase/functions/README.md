# Edge Functions

Toda Edge Function implantada no projeto deve ter fonte versionada neste diretório e configuração de autenticação explícita em `supabase/config.toml`.

`verify_jwt = false` só é aceitável para webhooks ou chamadas internas que validem, no próprio handler, uma assinatura ou chave dedicada. Uma função não pode usar `SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_DB_URL` sem autenticar e autorizar o chamador antes de qualquer acesso privilegiado.

## Envio legado de WhatsApp

`message-sender` é uma worker privada para a tabela legada
`outbox_messages`. Tanto a chamada interna para `evolution-go-proxy` quanto a
chamada direta ao Evolution legado usam `AbortController` com limite de 25
segundos, incluindo a leitura do corpo da resposta. Configuração ou URL local
inválida falha antes desse limite e continua retryável; timeout, abort, HTTP
408/5xx ou transporte incerto depois do `dispatching` são outcome desconhecido,
ficam terminais e nunca são reenviados automaticamente. O campo determinístico
enviado ao Evolution Go é somente correlação, não recibo idempotente.

Cada terminalização ambígua confirmada por CAS grava, em best-effort, o evento
tenant-scoped `whatsapp.manual_reconciliation_required` em `audit_logs`. O
evento contém apenas o id do outbox, motivo controlado, provedor, tentativas e
se o histórico já foi confirmado; conteúdo, telefone, JID, client id, provider
request id e segredos não são gravados. Falha da auditoria é verificada e
contabilizada na resposta agregada, mas nunca altera o estado terminal nem
provoca redispatch.

Dois P1 permanecem deliberadamente abertos porque exigem migration e/ou recibo
durável do provedor. `outbox_messages` não possui constraint/índice composto
único em `(organization_id, session_id, client_message_id)`, então o guard
lógico por leitura + CAS ainda tem TOCTOU com inserts não visíveis e custo de
escala. Além disso, provedor, histórico e outbox não participam de uma transação
única e o provedor não oferece recibo que prove exactly-once. A política segura
continua sendo reconciliação manual para qualquer resultado pós-boundary
ambíguo; esses P1 não devem ser “corrigidos” apenas em código.

## Checkout e webhook Asaas

O slug `asaas-create-charge` cria PIX e boleto diretamente no Asaas. Para cartão de crédito, aceita o checkout transparente quando recebe o objeto `card` validado e cria uma assinatura recorrente no Asaas; chamadas legadas sem esse objeto continuam abrindo o Checkout hospedado. PIX e boleto cobram antecipadamente o período escolhido (1, 6 ou 12 meses), sem desconto, e a renovação é manual. PAN e CVV podem atravessar o backend somente durante a criação transparente e nunca são persistidos, registrados em logs ou devolvidos ao navegador; a recorrência fica vinculada à assinatura mantida pelo Asaas. O retorno hospedado usa `APP_PUBLIC_URL`; em produção, esse valor deve ser uma origem HTTPS válida.

O retorno do checkout ou a emissao de um boleto serve apenas para orientar a interface. A ativacao ou troca de plano acontece exclusivamente pela reconciliacao idempotente do webhook depois da confirmacao financeira. Antes do deploy, configure `APP_PUBLIC_URL`, `ASAAS_WEBHOOK_TOKEN`, `ASAAS_API_KEY`, `ASAAS_BASE_URL`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` nos secrets do projeto. O endpoint de producao tambem exige `ASAAS_ALLOW_PRODUCTION_CHARGES=true`; mantenha esse flag ausente ou `false` em desenvolvimento e homologacao.

O checkout transparente tambem falha fechado sem estes tres segredos dedicados:

- `BILLING_CHECKOUT_IP_HMAC_SECRET`: HMAC com no minimo 32 bytes para os limites por IP; nunca reutilize a API key.
- `BILLING_CARD_CREDENTIAL_ENCRYPTION_KEY`: chave AES-256 como 64 caracteres hexadecimais; sela temporariamente o token Asaas e o IP original ate concluir ou rejeitar a recorrencia.
- `BILLING_EDGE_CLIENT_IP_SIGNING_SECRET`: HMAC com 32 a 512 bytes, identico na API Go e na Edge Function, para autenticar o IP validado pelo proxy sem confiar em `X-Forwarded-For`.

Configure e confira sem registrar valores em logs ou tickets:

```sh
supabase secrets set BILLING_CHECKOUT_IP_HMAC_SECRET=... BILLING_CARD_CREDENTIAL_ENCRYPTION_KEY=... BILLING_EDGE_CLIENT_IP_SIGNING_SECRET=... --project-ref <project-ref>
supabase secrets list --project-ref <project-ref>
```

O mesmo `BILLING_EDGE_CLIENT_IP_SIGNING_SECRET` deve existir no ambiente da API Go. A tokenizacao de cartao precisa estar habilitada pelo Asaas para a conta de producao; sem essa liberacao, pagamentos com cartao permanecem bloqueados de forma segura. Este repositorio nao aplica secrets nem faz deploy automaticamente.

A criacao ou o cancelamento da recorrencia de cartao nao roda dentro do webhook. A reconciliacao do evento apenas enfileira um job idempotente no Postgres e responde rapidamente; a API Go acorda periodicamente a funcao privada `asaas-card-recurrence-worker`, que usa leases, retry com backoff e dead-letter com alerta. O token Asaas e o IP permanecem no envelope AES-GCM e so sao abertos dentro dessa worker.

## Webhook Asaas

O slug `asaas-webhook` recebe eventos de cobrança `PAYMENT_*` e do ciclo de assinatura `SUBSCRIPTION_*`, valida o header `asaas-access-token` com o segredo `ASAAS_WEBHOOK_TOKEN` e reconcilia cada `event.id` uma única vez. Configure no Asaas o mesmo token dedicado, entre 32 e 255 caracteres, sem espaços e diferente da API key.

URL esperada:

`https://<project-ref>.supabase.co/functions/v1/asaas-webhook`

Eventos mínimos recomendados:

- `PAYMENT_CREATED`
- `PAYMENT_UPDATED`
- `PAYMENT_CONFIRMED`
- `PAYMENT_RECEIVED`
- `PAYMENT_OVERDUE`
- `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`
- `PAYMENT_REFUNDED`
- `PAYMENT_REFUND_REQUESTED`
- `PAYMENT_REFUND_IN_PROGRESS`
- `PAYMENT_PARTIALLY_REFUNDED`
- `PAYMENT_RECEIVED_IN_CASH_UNDONE`
- `PAYMENT_CHARGEBACK_REQUESTED`
- `PAYMENT_CHARGEBACK_DISPUTE`
- `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`
- `PAYMENT_DELETED`
- `SUBSCRIPTION_CREATED`
- `SUBSCRIPTION_UPDATED`
- `SUBSCRIPTION_INACTIVATED`
- `SUBSCRIPTION_DELETED`
- `SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK`
- `SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED`

## Meta: somente backend Go

OAuth, callback, seleção de ativos, sincronização, webhook, saúde, replay e
mensagens da Meta pertencem à API Go e não devem ser implantados como Edge
Functions. Os slugs antigos abaixo não pertencem ao conjunto implantável;
fontes que ainda existirem no worktree são somente legado de transição ou
tombstones fail-closed. Qualquer versão remota legada deve ser despublicada no
rollout do backend, depois que o callback e o webhook da Meta apontarem para a
API Go:

- `meta-oauth`
- `instagram-oauth`
- `meta-campaign-insights`
- `meta-messenger-proxy`
- `meta-webhook`
- `meta-token-healthcheck`
- `meta-webhook-replay`

Configure no aplicativo da Meta o callback OAuth
`https://api.vimobcrm.com.br/v1/public/integrations/meta/oauth/callback` e o
webhook
`https://api.vimobcrm.com.br/v1/public/integrations/meta/webhook`. Os
segredos `META_APP_ID` e `META_APP_SECRET`, o callback
`META_OAUTH_CALLBACK_URL`, as origens
`META_OAUTH_ALLOWED_ORIGINS` e `APP_PUBLIC_URL` devem existir somente no ambiente
do backend. A interface chama os endpoints autenticados da API Go; o banco
continua sendo apenas persistência e Vault.

## Resposta automática legada da Jhenny

`ai-agent-responder` é uma worker privada e aceita somente a identidade estável
`provider_message_id` de uma mensagem de entrada já persistida na mesma
organização, sessão e conversa. Antes de takeover, agenda, provedor de IA ou
outbox, ela disputa um claim de UUIDv8 determinístico em
`ai_interaction_logs`; apenas o `INSERT ... ON CONFLICT DO NOTHING RETURNING`
vencedor executa efeitos. Os `client_message_id` de saída também derivam do
claim e do índice do trecho, sem UUID aleatório.

O estado canônico de atendimento humano em `conversation_ai_state` é relido
dentro do vínculo já comprovado de organização, conversa e sessão antes do
claim, antes do provedor de IA, antes de interpretar intenção de visita e
imediatamente antes de cada caminho de outbox. `human_override`,
`paused_until` futuro ou estado malformado suprime a resposta e fecha o claim
adquirido sem envio. As alterações em `ai_agent_conversations` usam
`status + updated_at` previamente lidos como compare-and-set, portanto um
handoff ou encerramento concorrente não pode ser reativado pelo responder
legado.

Respostas divididas em vários blocos fazem a mesma releitura imediatamente
antes de cada insert individual no outbox. Se o takeover aparecer entre
blocos, os restantes não são enfileirados e o claim termina como supressão
parcial, com a quantidade já enfileirada no metadata, nunca como resposta
normal concluída. `last_ai_message_at` só é gravado por um segundo CAS depois
de o outbox completo ser aceito; uma supressão antes ou durante os blocos não
deixa um marcador falso de resposta da IA.

A criação automática de visita está intencionalmente desativada aqui. O schema
atual da agenda não possui chave única de intenção de visita nem RPC atômico de
agendamento; um fluxo de consulta seguida de insert permitiria duplicatas e
efeitos parciais. O responder pode reconhecer dia/horário solicitado e informar
ao modelo que ainda depende de confirmação humana, mas não insere
`schedule_events`, não move o lead e não emite notificação de visita. A
reativação exige primitiva atômica versionada e testes concorrentes.

O contrato é deliberadamente **at-most-once**: se a função cair depois de
adquirir o claim e antes de concluir os efeitos, a mensagem pode ficar sem
resposta automática e o replay será ignorado. Essa perda fail-closed é preferível
a responder ou agendar duas vezes. Reprocessamento futuro exige uma fila/lease
durável com estado de efeito; não se deve apagar claims manualmente em produção.
Também existe uma microjanela inevitável entre a última leitura da pausa
canônica e o insert no outbox, pois essas tabelas não participam de uma única
transação. As releituras e os guards CAS reduzem essa janela e falham fechado
quando observam mudança; eliminá-la por completo exige um RPC atômico no banco.

## Funções aposentadas por segurança

### Dados públicos e importadores legados

`public-site-data` e `import-wordpress-properties` são tombstones públicos que
respondem `410` sem criar cliente privilegiado ou consultar dados. O site
público atual usa `GET /v1/public/site/data` na API Go, com projeção explícita;
uma futura importação deve nascer atrás da API autenticada, autorização de
tenant, DTO validado e limite de lote. `instagram-oauth` também responde `410`:
o único OAuth Meta implantável é o fluxo da API Go descrito acima.

O snapshot histórico de funções remotas não é prova do estado atual. No
rollout, despublique qualquer versão antiga desses slugs ou publique primeiro o
tombstone correspondente, conforme o runbook aprovado; nunca reative a fonte
privilegiada anterior.

### Financeiro legado e recorrência

`financial-engine` é um tombstone privado. A ativação de contratos e a geração
de recebíveis/comissões pertencem ao endpoint transacional da API Go
`POST /v1/contracts/:id/activate`; o slug antigo não pode voltar a escrever com
service role.

`smart-recurring-generator` permanece autenticado, mas responde `503` de forma
segura. O schema atual não possui uma chave única de ocorrência nem um RPC que
faça a criação atomicamente. A recorrência financeira só pode ser reativada
depois de uma migração que imponha a unicidade por organização, origem e data,
com teste concorrente no banco. Até lá, falhar é preferível a duplicar valores.

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
