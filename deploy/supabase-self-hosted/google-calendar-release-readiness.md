# Preflight local: Vimob → Google Agenda

O Vimob é a origem dos compromissos. A integração publica no Google eventos
criados, alterados e excluídos no Vimob. **Eventos criados ou alterados no Google
não entram no Vimob.** O primeiro vínculo OAuth não importa histórico, não cria
um canal `watch` e não inicia sincronização de entrada.

Este documento prepara uma publicação futura. Os comandos abaixo leem somente
o checkout. Não copiam arquivos para o host, não alteram secrets, não aplicam
migrações e não publicam funções. Os testes podem gerar artefatos locais.

## Evidência observada e limites

Na leitura de 2026-10-06 em `https://supabase.vimobcrm.com.br`, o volume
continha cinco slugs: `asaas-create-charge`, `asaas-webhook`,
`evolution-go-webhook`, `hello` e `meta-oauth`. As URLs de
`google-calendar-oauth`, `google-calendar-sync` e `google-calendar-webhook`
respondiam `404`. O roteador efetivo lê `main/function-policy.json` somente
no startup e tem entradas apenas para `asaas-create-charge`, `asaas-webhook`,
`evolution-go-webhook` e `meta-oauth`. `hello` está no volume, mas responde
`404` por não constar na policy. O serviço `supabase-edge-functions` usa
`supabase/edge-runtime:v1.74.0` e monta
`/srv/vimob-supabase/stack/volumes/functions` em `/home/deno/functions`.
Os diretórios Google não existem nesse volume. As cinco variáveis Google do
OAuth/worker estão ausentes do ambiente efetivo do container e dos seus
`env_file` ativos. A especificação atual do serviço API Go no Portainer aponta
`SUPABASE_PROJECT_URL=https://supabase.vimobcrm.com.br`; seu `DATABASE_URL`
usa o usuário `postgres.your-tenant-id` via pooler, com senha presente, sem
expor seu valor. Isso sugere role Postgres `postgres` na conexão, mas a role
efetiva de uma transação da API ainda não foi provada. A especificação não
lista variáveis Google. Os serviços em execução usam Web
`ce4a1193ff1f7dc59d087209662ce01a340da1ab` e API
`cbf7fcbbf7eca363b71a37292717d897b444d7a8`. As variáveis de imagem
salvas no editor da stack ainda apontam ambas para `a231c82e...` por digest;
não atualizar a stack sem reconciliar essa divergência.

No Google Cloud, o projeto **Vimob** (`genial-charter-485603-h0`) foi lido em
2026-10-06. O único cliente OAuth listado é do tipo **Aplicativo da Web**.
Foram salvos nesse cliente o callback exato, o branding com as URLs públicas
abaixo, o domínio autorizado `vimobcrm.com.br` e os três escopos pedidos pelo
código. O público permanece **Externo / Testando**, com apenas
`andrezinho.primo@gmail.com` como usuário de teste. A Google Calendar API
ainda não estava ativada na última leitura. O cliente mostra dois secrets
ativos; não foram revelados nem comparados ao runtime. Portanto, a conexão
geral ainda depende da verificação e publicação do app no Google.
As páginas públicas existentes, confirmadas por GET sem login, são
`https://vimobcrm.com.br/`,
`https://app.vimobcrm.com.br/politica-de-privacidade` e
`https://app.vimobcrm.com.br/termos-de-uso`. As duas rotas legais no domínio
sem `app` retornam 404.

No banco consultado apenas por `SELECT`, existem cinco tabelas
`google_calendar_*`: uma conexão com `sync_status=error`, dois vínculos,
três estados OAuth, zero jobs `failed` e 24 jobs `dead`, todos de
`pull_incremental` legado. O Vault tem `google_calendar_cron_secret`, mas não
tem `google_calendar_sync_base_url`; não havia nenhum dos três Cron jobs da
Agenda nem a RPC filtrada de saída. A RPC antiga de claim é
`SECURITY DEFINER`, pertence a `postgres` e concede `EXECUTE` a `anon`,
`authenticated` e `service_role`; a migração de saída revoga esses grants.
Há quatro canais vencidos, um ainda sem `stopped_at`. Esses números são o
retrato de 2026-10-06, anterior ao corte, e precisam ser relidos.
A conta Vimob com e-mail `andrezinho.primo@gmail.com` existe e está ativa,
mas sua organização padrão está `is_active=false`; a capacidade de Agenda
retorna `ORGANIZATION_INACTIVE`. Seu UUID não serve para o primeiro teste
OAuth enquanto essa condição persistir. A única conexão Google existente
pertence a outra conta, permanece conectada e está em `sync_status=error`.
Não havia jobs de saída prontos na leitura. O gate de novas conexões não
impede futuros envios dessa conexão antiga, se ela voltar a funcionar.

O manifesto local tem slugs que não coincidem com o volume e com a policy
efetivos: `hello` não existe nele e `meta-oauth` está `RETIRED`. Substituir o
roteador ou o manifesto completo sem reconciliação pode derrubar rotas ativas.
Para o fluxo de mão única, o plano de publicação seleciona **somente**
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

1. No **host Supabase**, preservar os cinco diretórios existentes e as quatro
   entradas de `main/function-policy.json`. A leitura do host confirmou
   `/srv/vimob-supabase/stack/volumes/functions` como bind mount e `_shared`
   presente, sem os seis módulos `_shared/google-calendar*` necessários,
   inclusive `google-calendar-pilot.ts`.
   Publicar seletivamente os diretórios `google-calendar-oauth` e
   `google-calendar-sync` e esses seis módulos; adicionar à policy apenas
   essas duas rotas com `verify_jwt=false`. O callback precisa chegar ao
   handler, que faz sua própria validação. Revalidar as quatro rotas antigas
   da policy e reconhecer que `hello` já respondia `404` antes do corte.
   O Portainer da API Go pode estar em outro host.
2. Conferir no serviço Functions `SUPABASE_URL` e
   `SUPABASE_SERVICE_ROLE_KEY` e configurar, por `env_file` separado,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_CALENDAR_REDIRECT_URI` e
   `GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL`. As quatro variáveis Google
   estavam ausentes do container e dos `env_file` ativos na leitura do host.
   O retorno pós-conexão deve usar a mesma origem da Web/PWA, por exemplo
   `https://app.vimobcrm.com.br/settings?tab=integrations&integration=google-calendar`.
   Sem esse fallback, `return_url` é descartada no callback. Não registrar
   valores de segredo. `GOOGLE_CALENDAR_WEBHOOK_URL` não é necessário no modo
   de mão única. A entrada de `env_file` requer recriar somente o serviço
   `functions` com os cinco arquivos Compose efetivos, nesta ordem:
   `docker-compose.yml`, `docker-compose.caddy.yml`,
   `docker-compose.pin.yml`, `docker-compose.evolution-function.yml` e
   `docker-compose.wireguard.yml`. Um restart simples não atualiza o ambiente
   do container. Essa operação ainda não foi executada.
3. No Google Cloud, ativar a **Google Calendar API**; preencher o branding
   com as URLs públicas observadas e autorizar o domínio `vimobcrm.com.br`;
   declarar os escopos efetivamente pedidos pelo código (`openid`, `email` e
   `https://www.googleapis.com/auth/calendar.events.owned`); cadastrar no
   cliente Web a URI de retorno exata
   `https://supabase.vimobcrm.com.br/functions/v1/google-calendar-oauth/callback`.
   Conferir que o Client ID do runtime é o desse cliente, comparando apenas
   prefixo e sufixo. Preparar e solicitar a verificação do escopo de Agenda
   e mudar o público para `In production` antes de
   prometer acesso geral. Em `Testing`, só usuários de teste cadastrados
   autorizam, e o refresh token com esse escopo pode expirar em sete dias.
   Mesmo após publicar, um app que pede escopo sensível sem verificação pode
   exibir aviso de app não verificado e ficar sujeito ao limite de 100 usuários.
   O primeiro teste será limitado no backend a um UUID Vimob com Agenda
   efetivamente ativa: `GOOGLE_CALENDAR_CONNECT_MODE=pilot` e
   `GOOGLE_CALENDAR_PILOT_USER_IDS=<UUID_VALIDADO_POR_SELECT>`.
   O Gmail de teste Google pode ser diferente do login Vimob. Não usar o UUID
   da conta `andrezinho.primo@gmail.com` enquanto sua organização padrão
   estiver inativa.
   O padrão sem configuração é `disabled`. O modo `all` só deve ser usado
   depois da verificação e da liberação geral no Google. O app nativo ainda
   requer teste separado de retorno/deep link; o fluxo web/PWA retorna à URL
   web.
4. Conciliar no banco, por `SELECT`, as tabelas `google_calendar_*`, o Vault,
   a RPC antiga `google_calendar_claim_sync_jobs`, a nova RPC e os Cron jobs.
   A migração local `20261006150000_claim_google_calendar_outbound_jobs.sql`
   define `google_calendar_claim_outbound_sync_jobs(integer,text)`, que
   reivindica **apenas** `push_upsert` e `push_delete` com dono verificável.
   Ela também revoga de `PUBLIC`, `anon`, `authenticated` e `service_role` a
   execução da RPC antiga de claim, quando presente; verificar os privilégios
   efetivos e identificar qualquer consumidor antigo antes do corte. A leitura
   de produção encontrou grants explícitos para as três roles, inclusive as
   duas acessíveis aos clientes. A função é `SECURITY DEFINER`, então essa
   exposição deve ser corrigida na reconciliação isolada antes de ativar o
   worker.
   Jobs de exclusão antigos sem dono e conexão verificáveis ficam na fila para
   auditoria. Ela não foi aplicada em
   produção. Reconciliar o objeto antes de uma aplicação isolada; não usar
   `db push` em lote sem ledger confiável.
   **Não aplicar** a migração local
   `20261006151000_google_calendar_one_way_help_content.sql` neste corte.
   O `public.help_articles` real não tem `slug`, `summary`, `steps` nem
   `last_reviewed_at`, e não contém o artigo alvo; o `UPDATE` falharia. A
   migração de expansão da Ajuda `20260729110946_expand_help_center.sql`
   também está ausente no schema. A Central de Ajuda exige reconciliação
   separada; não incluir um sweep de migrações neste piloto.
   Conferir separadamente a chave estrangeira dos vínculos. A leitura de
   produção em 2026-10-06 encontrou
   `google_calendar_event_links_schedule_event_id_fkey ON DELETE CASCADE`,
   embora a migração local de confiabilidade use `ON DELETE SET NULL`. O
   ledger de migrações do Supabase não está presente nessa instalação.
   `CASCADE` apaga o vínculo quando o compromisso é removido no Vimob e
   impede o worker de localizar o ID Google de um vínculo legado. Antes de
   testar exclusões, confirmar o objeto real por leitura:

   ```sql
   select conname, pg_get_constraintdef(oid) as definition
   from pg_constraint
   where conrelid = 'public.google_calendar_event_links'::regclass
     and conname = 'google_calendar_event_links_schedule_event_id_fkey';
   ```

   Se ainda estiver em `CASCADE`, a reconciliação **isolada**, após revisão
   do objeto e janela de mudança, é esta. Não executar o sweep completo:
   ele também agenda os jobs antigos de entrada.

   ```sql
   begin;
   alter table public.google_calendar_event_links
     drop constraint google_calendar_event_links_schedule_event_id_fkey;
   alter table public.google_calendar_event_links
     add constraint google_calendar_event_links_schedule_event_id_fkey
     foreign key (schedule_event_id)
     references public.schedule_events(id)
     on delete set null;
   commit;
   ```

   Reler `pg_get_constraintdef` após essa etapa. Ela é independente da RPC
   filtrada `google_calendar_claim_outbound_sync_jobs` e não substitui sua
   aplicação reconciliada.
5. Desativar os Cron jobs de entrada `google-calendar-enqueue-due-pulls` e
   `google-calendar-renew-watches` no futuro corte. O único job necessário é
   `google-calendar-sync-jobs`, que processa a fila de envio. Confirmar que não
   existe worker antigo chamando a RPC sem filtro. Contar o backlog por ação,
   status, idade, organização e usuário antes de ativar esse job; a nova RPC
   deixa jobs sem dono e conexão verificáveis na fila para auditoria.
6. Para cumprir a expectativa de envio logo após criar, editar ou excluir um
   compromisso, confirmar por leitura que a role da API Go pode
   executar `private.invoke_google_calendar_worker(text,integer)` e que os
   parâmetros `google_calendar_sync_base_url` e `google_calendar_cron_secret`
   estão presentes no Vault. **Não chamar a função durante a auditoria**:
   ela agenda uma requisição HTTP. Depois desse preflight, configurar
   `GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED=true` na API Go é requisito
   para a tentativa de despacho imediatamente após a gravação; confirmar o
   valor efetivo nas réplicas antes do teste. O Cron por minuto permanece como
   fallback durável e caminho de retentativa. Com a flag em `false`, o envio
   pode esperar o próximo minuto e não atende à expectativa de despacho logo
   após a ação. Medir a latência real até a mudança aparecer no Google.

## Ordem do piloto em produção, ainda não executado

1. Preparar rollback dos arquivos e configurações efetivos, após inspecionar o
   runtime. Reconciliar a FK dos vínculos para `ON DELETE SET NULL` antes de
   testar exclusões. Aplicar isoladamente a nova RPC após revisar seu objeto
   e seus grants no banco real. Deixar a migração de Ajuda fora deste corte.
2. Publicar API Go, Web e os dois diretórios Edge compatíveis, preservando as
   rotas existentes. Configurar o gate `pilot` somente para o UUID Vimob cuja
   capacidade de Agenda foi confirmada por `SELECT`. Pessoas fora do piloto
   não devem receber URL de
   conexão nem ver o botão Conectar. Status e desconexão continuam disponíveis
   para contas conectadas.
3. Confirmar que `POST` anônimo em `google-calendar-oauth` com
   `{"action":"status"}` passou de `404` a `401`, que o status autenticado
   informa `can_connect=true` para a conta piloto autorizada e
   `can_connect=false` para alguém fora do piloto ou sem permissão de Agenda,
   cujo pedido de conexão deve receber `403`. Revalidar as quatro rotas
   preexistentes da policy e comparar `hello` com seu `404` anterior.
4. Auditar o backlog e ativar apenas `google-calendar-sync-jobs`. Confirmar
   que não há worker antigo executando a RPC sem filtro e que a RPC antiga
   nega `service_role`. Verificar que nenhuma ação de pull/watch é executada
   e que nenhuma rota de webhook precisa ser publicada. Após validar role e
   Vault, ativar `GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED=true` em todas as
   réplicas da API e conferir o valor efetivo. O Cron continua ativo para
   recuperar falhas e jobs pendentes.
5. Conectar uma conta Google dedicada para o primeiro teste controlado e
   criar, editar e excluir eventos controlados no Vimob; confirmar no Google o
   mesmo ID vinculado, dados finais e exclusão. Criar também um evento apenas
   no Google e confirmar que ele **não** aparece no Vimob. Alterar a cópia de
   um evento Vimob diretamente no Google; depois editar e excluir pelo Vimob
   e confirmar que o Vimob prevalece. Com o despacho imediato ativo, medir o
   atraso entre a gravação no Vimob e a mudança no Google para criação, edição
   e exclusão. A chamada rápida processa no máximo 20 jobs por vez; quando
   falhar, confirmar a recuperação pelo Cron. Monitorar jobs `failed`/`dead`
   e conexões com token revogado. Não declarar atendida a expectativa de envio
   logo após a ação apenas porque o Cron funciona.

Esta versão não envia convites Google a participantes do compromisso. Uma troca
de responsável entre contas com vínculos antigos exige verificar a limpeza do
dono anterior e o envio pelo novo dono; um job de limpeza retido pode bloquear
o novo envio até os dois lados serem reconciliados. Uma conexão legada com
`sync_enabled=false` tinha pausado a entrada do Google; o envio pelo Vimob não
usa esse campo. Conferir esses casos por `SELECT` antes de validar contas legadas.
Vínculos antigos cujo evento Google não traz a identidade Vimob esperada são
recusados pelo worker para evitar sobrescrever ou apagar evento alheio. Usar
eventos novos na primeira validação e reconciliar esses vínculos antes de
prometer atualização e exclusão de compromissos já vinculados.

O gate `GOOGLE_CALENDAR_CONNECT_MODE=disabled` pausa novas conexões; não
interrompe envio, status nem desconexão das contas já conectadas. Uma
interrupção mais ampla exige rollback coordenado da entrada Web/API/Functions
e suspensão do Cron de saída e do despacho imediato; isso não revoga tokens
das contas já conectadas.
Confirmar que não há workers antigos; a desconexão individual continua
disponível pela interface. A desconexão rejeita jobs de saída
pendentes com `409`, mas a leitura desses jobs e a revogação do token ainda não
são uma única transação com uma nova gravação na API Go. Exercitar a corrida
entre criar/excluir e desconectar no primeiro teste; exigir reconciliação dos
jobs e vínculos antes de declarar o fluxo confiável para uso profissional.
Reconciliar a fila antes de retomar.

O `docker-compose.vimob-functions.yml` deste repositório usa `.env.functions` e
monta `./volumes/functions` em `/home/deno/functions`. O roteador versionado
carrega `/home/deno/functions/production-manifest.json` ao iniciar. Essas são
propriedades dos arquivos versionados, **não** prova da stack em execução.
