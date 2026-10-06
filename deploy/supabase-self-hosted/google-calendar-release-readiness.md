# Preflight local: Vimob → Google Agenda

O Vimob é a origem dos compromissos. A integração publica no Google eventos
criados, alterados e excluídos no Vimob. **Eventos criados ou alterados no Google
não entram no Vimob.** O primeiro vínculo OAuth não importa histórico, não cria
um canal `watch` e não inicia sincronização de entrada.

Este documento prepara uma publicação futura. Os comandos abaixo leem somente
o checkout. Não copiam arquivos para o host, não alteram secrets, não aplicam
migrações e não publicam funções. Os testes podem gerar artefatos locais.

## Evidência observada e limites

Na leitura de 2026-10-06 em `https://supabase.vimobcrm.com.br`, o runtime
apresentava cinco slugs: `asaas-create-charge`, `asaas-webhook`,
`evolution-go-webhook`, `hello` e `meta-oauth`. As URLs de
`google-calendar-oauth`, `google-calendar-sync` e `google-calendar-webhook`
respondiam `404`. Reconfirme o inventário antes do corte. O roteador, os mounts,
as variáveis reais do serviço Functions, o `SUPABASE_PROJECT_URL` efetivo da API,
o banco/Vault/Cron e a configuração do Google Cloud não foram confirmados.

O manifesto local tem slugs que não coincidem com o runtime observado:
`hello` não existe nele e `meta-oauth` está `RETIRED`. Substituir o roteador ou
o manifesto completo sem reconciliação pode derrubar essas rotas. Para o fluxo
de mão única, o plano de publicação seleciona **somente**
`google-calendar-oauth` e `google-calendar-sync`. O webhook e o legado
`google-calendar-auth` não são necessários para este corte.

## Verificações locais

Na raiz do checkout revisado:

```sh
node scripts/supabase/verify-edge-functions.mjs
node scripts/supabase/verify-migrations.mjs
node --test scripts/supabase/plan-google-calendar-edge-release.test.mjs
node scripts/supabase/plan-google-calendar-edge-release.mjs \
  --runtime-slugs asaas-create-charge,asaas-webhook,evolution-go-webhook,hello,meta-oauth
```

O plano enumera os dois diretórios candidatos, os arquivos `_shared`
importados e as rotas observadas que o roteador versionado negaria. A lista
`--runtime-slugs` precisa vir de uma nova leitura do runtime. Sem ela, o script
registra que não recebeu inventário atual. `--json` mostra o mesmo plano em
formato estruturado. A verificação de manifesto compara hashes, lifecycle e
`verify_jwt`; um erro deve ser investigado antes de atualizar o lock.

## Preparação do ambiente

1. No **host Supabase**, identificar a imagem, o roteador efetivo, os mounts e
   a raiz que serve as funções. Confirmar a presença/ausência dos dois diretórios
   Google e de `_shared`, além das versões das cinco rotas preexistentes.
   Preservar essas rotas durante o corte. O Portainer da API Go pode estar em
   outro host.
2. Conferir a presença no serviço Functions de `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_CALENDAR_REDIRECT_URI`,
   `GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL` e
   `GOOGLE_CALENDAR_CANARY_USER_IDS`. Não registrar valores de segredo.
   `GOOGLE_CALENDAR_WEBHOOK_URL` não é necessário no modo de mão única.
3. No Google Cloud, conferir o cliente OAuth, a tela de consentimento, os
   usuários de teste quando o projeto estiver em `Testing` e o redirect URI
   público HTTPS exato do callback OAuth. Conferir que o Client ID corresponde
   ao configurado no serviço Functions. O app nativo ainda requer teste separado
   de retorno/deep link; o fluxo web/PWA retorna à URL web.
4. Conciliar no banco, por `SELECT`, as tabelas `google_calendar_*`, o Vault,
   a RPC antiga `google_calendar_claim_sync_jobs`, a nova RPC e os Cron jobs.
   A migração local `20261006150000_claim_google_calendar_outbound_jobs.sql`
   define `google_calendar_claim_outbound_sync_jobs(integer,text,uuid[])`, que
   reivindica **apenas** `push_upsert` e `push_delete` de usuários selecionados.
   Ela também revoga de `service_role` a execução da RPC antiga de claim,
   quando presente; verificar os privilégios efetivos e identificar qualquer
   consumidor antigo antes do corte.
   Jobs de exclusão antigos sem dono e conexão verificáveis ficam na fila para
   auditoria. Ela não foi aplicada em
   produção. Reconciliar o objeto antes de uma aplicação isolada; não usar
   `db push` em lote sem ledger confiável.
   Conferir também o artigo `como-conectar-o-google-agenda` da Central de
   Ajuda. A migração local `20261006151000_google_calendar_one_way_help_content.sql`
   atualiza somente o texto padrão antigo; um artigo personalizado exige
   revisão manual antes do corte. Nenhuma dessas migrações foi aplicada.
5. Desativar os Cron jobs de entrada `google-calendar-enqueue-due-pulls` e
   `google-calendar-renew-watches` no futuro corte. O único job necessário é
   `google-calendar-sync-jobs`, que processa a fila de envio. Confirmar que não
   existe worker antigo chamando a RPC sem filtro. Contar o backlog por ação,
   status, idade, organização e usuário antes de ativar esse job; a nova RPC
   deixa trabalhos de usuários fora do canário na fila.
6. Para despacho em segundos, confirmar por leitura que a role da API Go pode
   executar `private.invoke_google_calendar_worker(text,integer)` e que os
   parâmetros `google_calendar_sync_base_url` e `google_calendar_cron_secret`
   estão presentes no Vault. **Não chamar a função durante a auditoria**:
   ela agenda uma requisição HTTP. O disparo pós-gravação é uma tentativa
   imediata, controlada por `GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED=false`
   na API Go até completar esse preflight; o Cron por minuto é o fallback
   durável. Sem esses pré-requisitos, o envio pode esperar o próximo minuto e
   a fila deve mostrar o atraso.

## Ordem do canário em produção, ainda não executada

1. Preparar rollback dos arquivos e configurações efetivos, após inspecionar o
   runtime. Aplicar a nova RPC e o ajuste guardado da Central de Ajuda somente
   depois de revisar os objetos e o artigo no banco real.
2. Publicar API Go, Web e os dois diretórios Edge compatíveis, preservando as
   rotas existentes e com `GOOGLE_CALENDAR_CANARY_USER_IDS` vazio. Essa flag
   recebe UUIDs completos de `auth.users.id` separados por vírgula; vazia
   bloqueia novas conexões. Status e desconexão continuam disponíveis.
3. Confirmar que `POST` anônimo em `google-calendar-oauth` com
   `{"action":"status"}` passou de `404` a `401`, que o status autenticado
   informa `can_connect=false` e que uma pessoa fora da lista na **mesma
   organização** recebe `403` ao tentar conectar. Revalidar as cinco rotas
   preexistentes.
4. Auditar o backlog e ativar apenas `google-calendar-sync-jobs` com a lista de
   usuários ainda vazia. Confirmar que nenhum job é reivindicado e que não há
   worker antigo executando a RPC sem filtro; a RPC antiga deve negar
   `service_role`. Verificar que nenhuma ação de
   pull/watch é executada e que nenhuma rota de webhook precisa ser publicada.
5. Incluir um único `user_id` no canário. Conectar uma conta Google dedicada e
   criar, editar e excluir eventos controlados no Vimob; confirmar no Google o
   mesmo ID vinculado, dados finais e exclusão. Criar também um evento apenas
   no Google e confirmar que ele **não** aparece no Vimob. Alterar a cópia de
   um evento Vimob diretamente no Google; depois editar e excluir pelo Vimob
   e confirmar que o Vimob prevalece. Medir o atraso entre
   a gravação no Vimob e a mudança no Google. Após validar role/Vault, ativar
   opcionalmente `GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED` na API e repetir
   a medição; a chamada rápida processa no máximo 20 jobs por vez. Monitorar
   jobs `failed`/`dead` e conexões com token revogado.

O piloto não envia convites Google a participantes do compromisso. Evitar troca
de responsável entre alguém fora do canário com conexão antiga e alguém dentro
do canário: o job de limpeza do dono anterior fica retido e bloqueia o novo
envio até os dois lados serem reconciliados. Uma conexão legada com
`sync_enabled=false` tinha pausado a entrada do Google; o envio pelo Vimob não
usa esse campo. Conferir esses casos por `SELECT` antes de incluir a pessoa.
Vínculos antigos cujo evento Google não traz a identidade Vimob esperada são
recusados pelo worker para evitar sobrescrever ou apagar evento alheio. Usar
eventos novos na primeira validação e reconciliar esses vínculos antes de
prometer atualização e exclusão de compromissos já vinculados.

Esvaziar `GOOGLE_CALENDAR_CANARY_USER_IDS` bloqueia novas conexões e impede
que este worker reivindique jobs de envio, mas não revoga tokens de contas já
conectadas. Confirmar que não há workers antigos; a desconexão individual
continua disponível pela interface. A desconexão rejeita jobs de saída
pendentes com `409`, mas a leitura desses jobs e a revogação do token ainda não
são uma única transação com uma nova gravação na API Go. Exercitar a corrida
entre criar/excluir e desconectar no canário; exigir reconciliação dos jobs e
vínculos antes da liberação profissional. Reconciliar a fila antes de retomar.

O `docker-compose.vimob-functions.yml` deste repositório usa `.env.functions` e
monta `./volumes/functions` em `/home/deno/functions`. O roteador versionado
carrega `/home/deno/functions/production-manifest.json` ao iniciar. Essas são
propriedades dos arquivos versionados, **não** prova da stack em execução.
