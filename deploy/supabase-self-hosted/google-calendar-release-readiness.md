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
as variáveis reais do serviço Functions e o ambiente efetivo do processo da API
não foram confirmados. O editor da stack do
Portainer guarda `SUPABASE_PROJECT_URL=https://supabase.vimobcrm.com.br`, mas
os valores de imagem Web/API salvos nele diferem das imagens em execução; não
atualizar a stack sem reconciliar essa divergência.

No Google Cloud, o projeto **Vimob** (`genial-charter-485603-h0`) foi lido em
2026-10-06. O único cliente OAuth listado é do tipo **Aplicativo da Web**;
não há URI de redirecionamento autorizada. O público é **Externo / Testando**,
com **zero usuários de teste**, e o botão **Publicar app** está desabilitado
porque o branding está incompleto. A página de Acesso a dados não lista
escopos, e a Google Calendar API não aparece entre as 23 APIs ativadas. No
branding estão vazios a página inicial, a Política de Privacidade, os Termos
de Uso e os domínios autorizados. O cliente mostra dois secrets ativos; não
foram revelados nem comparados ao runtime. Enquanto esses pontos persistirem,
o primeiro deploy não pode oferecer conexão funcional a todos os usuários.
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
Agenda nem a RPC filtrada de saída. Esses números são o retrato de
2026-10-06, anterior ao corte, e precisam ser relidos.

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
   `GOOGLE_CALENDAR_REDIRECT_URI` e
   `GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL`. Não registrar valores de segredo.
   `GOOGLE_CALENDAR_WEBHOOK_URL` não é necessário no modo de mão única.
3. No Google Cloud, ativar a **Google Calendar API**; preencher o branding
   com as URLs públicas observadas e autorizar o domínio `vimobcrm.com.br`;
   declarar os escopos efetivamente pedidos pelo código (`openid`, `email` e
   `https://www.googleapis.com/auth/calendar.events.owned`); cadastrar no
   cliente Web a URI de retorno exata
   `https://supabase.vimobcrm.com.br/functions/v1/google-calendar-oauth/callback`.
   Conferir que o Client ID do runtime é o desse cliente, comparando apenas
   prefixo e sufixo. Preparar e solicitar a verificação do escopo de Agenda,
   completar o branding e mudar o público para `In production` antes de
   prometer acesso geral. Em `Testing`, só usuários de teste cadastrados
   autorizam, e o refresh token com esse escopo pode expirar em sete dias.
   Mesmo após publicar, um app que pede escopo sensível sem verificação pode
   exibir aviso de app não verificado e ficar sujeito ao limite de 100 usuários.
   A primeira publicação no Vimob pretende disponibilizar a conexão a todos
   os usuários com permissão de Agenda, mas ela depende desse preparo no
   Google. O app nativo ainda requer teste separado de retorno/deep link; o
   fluxo web/PWA retorna à URL web.
4. Conciliar no banco, por `SELECT`, as tabelas `google_calendar_*`, o Vault,
   a RPC antiga `google_calendar_claim_sync_jobs`, a nova RPC e os Cron jobs.
   A migração local `20261006150000_claim_google_calendar_outbound_jobs.sql`
   define `google_calendar_claim_outbound_sync_jobs(integer,text)`, que
   reivindica **apenas** `push_upsert` e `push_delete` com dono verificável.
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

## Ordem da liberação geral em produção, ainda não executada

1. Preparar rollback dos arquivos e configurações efetivos, após inspecionar o
   runtime. Reconciliar a FK dos vínculos para `ON DELETE SET NULL` antes de
   testar exclusões. Aplicar a nova RPC e o ajuste guardado da Central de Ajuda
   somente depois de revisar os objetos e o artigo no banco real.
2. Publicar API Go, Web e os dois diretórios Edge compatíveis, preservando as
   rotas existentes. A conexão fica disponível a todos os usuários Vimob com
   acesso ativo à Agenda e permissão `schedule_manage` assim que o fluxo for
   publicado. Status e desconexão continuam disponíveis para contas conectadas.
3. Confirmar que `POST` anônimo em `google-calendar-oauth` com
   `{"action":"status"}` passou de `404` a `401`, que o status autenticado
   informa `can_connect=true` para uma pessoa autorizada e
   `can_connect=false` para uma pessoa sem permissão de Agenda, cujo pedido de
   conexão deve receber `403`. Revalidar as cinco rotas preexistentes.
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

Não há lista de usuários para pausar novas conexões. Uma interrupção exige
rollback coordenado da entrada Web/API/Functions e suspensão do Cron de saída
e do despacho imediato; isso não revoga tokens das contas já conectadas.
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
