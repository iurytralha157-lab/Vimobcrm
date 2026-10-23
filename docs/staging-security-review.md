# Triagem de exposicao do banco de homologacao

Data: 2026-10-23. Checkout: `D:\Vimob\workspaces\vimob-crm`, branch
`homologacao`, candidata `57ea4e5f883094bcbbbccd2267a2c926c71c9a44`.

## Decisao

**HOLD para acesso geral ao ambiente de homologacao antes da triagem dirigida
das RPCs abaixo.** A baseline preserva grants para `anon` e `authenticated`
em funcoes de mutacao com `SECURITY DEFINER`, incluindo rotinas globais sem
validacao da identidade do chamador. A consulta posterior ao catalogo Cloud
confirmou grants de cinco dessas RPCs para ambas as roles. O desligamento dos
workers na API nao revoga os privilegios `EXECUTE` do banco.

Os avisos `pg_graphql_anon_table_exposed` e
`pg_graphql_authenticated_table_exposed`, isoladamente, nao comprovam leitura
indevida de linhas. Precisam ser correlacionados com grants, RLS, policies e
contrato de acesso de cada objeto. As RPCs identificadas fornecem um motivo
concreto para manter o HOLD, sem depender apenas desses avisos.

## Escopo e evidencia

A revisao inicial foi somente leitura dos arquivos canonicos e dos 20 forwards
validados por `loadCloudSource`, sem consultar o catalogo Cloud. Os corpos das
funcoes e a analise das guardas abaixo continuam baseados nessa fonte local.
Depois, o agente principal realizou a consulta de catalogo descrita na proxima
secao, somente no projeto de testes.

Nenhuma dessas etapas acessou producao, chamou RPC por HTTP, executou o corpo
das funcoes de mutacao ou alterou grants, RLS e ACLs.

As fontes da projecao Cloud sao
[`baseline-20261016.sql`](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql)
e
[`baseline-20261016-post-graphql.sql`](../supabase/reconciliation/local-bootstrap/baseline-20261016-post-graphql.sql).
Nenhum dos 20 forwards contem os nomes das RPCs de risco listadas a seguir.
O smoke SQL de Auth/RLS entre duas organizacoes nao cobre essas entradas.

## Verificacao posterior do catalogo Cloud

O agente principal consultou o catalogo em `2026-10-23T20:11:00.401Z`, no
projeto `lfkfuhvjvqgwyikzcfep`, por `SELECT` somente leitura. O resultado esta
em [cloud-rpc-grants.json](../deploy/staging/cloud-rpc-grants.json).

Todas as seis assinaturas consultadas sao `SECURITY DEFINER`, de propriedade
de `postgres`. Os privilegios efetivos observados foram:

| Assinatura | anon EXECUTE | authenticated EXECUTE |
| --- | --- | --- |
| `cancel_disabled_automation_runtime(integer)` | true | true |
| `release_due_automation_delays(integer)` | true | true |
| `complete_automation_event(uuid,text)` | true | true |
| `finish_automation_external_effect(text,text,jsonb,text,text)` | true | true |
| `rebind_whatsapp_conversation_session(uuid,uuid)` | true | true |
| `rebind_whatsapp_conversation_session(uuid,uuid,text)` | false | false |

Esse resultado confirma os atributos e a executabilidade no catalogo dessas
assinaturas. Nao constitui execucao funcional nem prova de exploracao HTTP.
As demais RPCs citadas nesta triagem permanecem verificadas somente na fonte.

## Achados prioritarios

### 1. Rotinas globais de automacao executaveis por anon

**Corpos revisados na fonte; grants e atributos confirmados no catalogo Cloud.
Prioridade P1 para triagem antes de liberar acesso.**

- `cancel_disabled_automation_runtime(integer)` recebe apenas o tamanho do
  lote. Seu corpo e `SECURITY DEFINER`, pertence a `postgres` e altera execucoes,
  etapas e eventos de organizacoes com o modulo desativado, sem verificar
  `auth.uid()`, papel do chamador ou pertencimento a uma organizacao.
  [Corpo, linha 41825](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L41825);
  [grants para anon/authenticated, linha 4007](../supabase/reconciliation/local-bootstrap/baseline-20261016-post-graphql.sql#L4007).
- `release_due_automation_delays(integer)` percorre execucoes vencidas de
  varias organizacoes, chama `resume_automation_delay` e retorna linhas de
  `automation_executions`. Tambem e `SECURITY DEFINER` de `postgres`, sem
  autorizacao do chamador no corpo.
  [Corpo, linha 67586](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L67586);
  [grants para anon/authenticated, linha 5808](../supabase/reconciliation/local-bootstrap/baseline-20261016-post-graphql.sql#L5808).

A filtragem por modulo, estado ou vencimento e uma regra operacional;
nao vincula essas operacoes a quem fez a chamada. RLS nas tabelas nao substitui
a autorizacao dessas funcoes executadas como seu proprietario.

### 2. Outras mutacoes de worker com grants para clientes

**Certo na fonte; grants de `complete_automation_event` e
`finish_automation_external_effect` tambem confirmados no catalogo Cloud.
Impacto individual ainda requer triagem.**

`complete_automation_event` e `fail_automation_event` alteram eventos por ID e
`locked_by`; `finish_automation_external_effect` altera o resultado por
`effect_key`. Seus corpos nao autorizam a identidade do chamador. Conhecer um
ID, um nome de worker ou uma chave de efeito nao e, por si, uma verificacao de
permissao de usuario.

- `complete_automation_event`: [corpo 48051](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L48051),
  [ACL 4242](../supabase/reconciliation/local-bootstrap/baseline-20261016-post-graphql.sql#L4242).
- `fail_automation_event`: [corpo 51253](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L51253),
  [ACL 4472](../supabase/reconciliation/local-bootstrap/baseline-20261016-post-graphql.sql#L4472).
- `finish_automation_external_effect`: [corpo 53459](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L53459),
  [ACL 4612](../supabase/reconciliation/local-bootstrap/baseline-20261016-post-graphql.sql#L4612).

As ACLs tambem concedem `anon`/`authenticated` a `enter_automation_delay_wait`,
`reserve_automation_external_effect`, `resume_automation_delay` e
`start_automation_execution_from_event`. Algumas dependem de lease ou contexto
da execucao; essa dependencia precisa ser avaliada antes de concluir o alcance
de uma chamada indevida. Nenhuma exploracao HTTP foi executada nesta revisao.

### 3. Rebind legado contradiz a fronteira do cutover B1

**Grants e divergencia certos na fonte; `EXECUTE` para clientes na sobrecarga
de dois argumentos confirmado no catalogo Cloud. Bypass de autorizacao
provavel, pendente de reproducao isolada.**

A sobrecarga `rebind_whatsapp_conversation_session(uuid, uuid)` possui grants
para `anon`, `authenticated` e `service_role` na
[ACL, linha 5579](../supabase/reconciliation/local-bootstrap/baseline-20261016-post-graphql.sql#L5579).
O [cutover B1, linha 733](../supabase/cutovers/20260919_enable_strict_whatsapp_message_binding.sql#L733)
determina revogacao para essas roles nas duas sobrecargas porque os helpers
legados alteram a conversa sem manter o ledger imutavel de binding.

O [corpo de dois argumentos, linha 62700](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L62700)
e `SECURITY DEFINER` e retorna uma linha de `whatsapp_conversations` apos
`UPDATE`. Em `v_can_send`, a comparacao com `auth.uid()` pode resultar em
`NULL` para `anon`. O teste `IF NOT v_can_send` nao rejeita um resultado
`NULL`. Ha caminhos dependentes dos IDs e do estado da conversa/sessao que
precisam ser reproduzidos com dados sinteticos antes de determinar o impacto.

A sobrecarga de tres argumentos esta concedida apenas a `service_role` na
fonte, mas tambem diverge da revogacao total prevista por B1.
[ACL, linha 5589](../supabase/reconciliation/local-bootstrap/baseline-20261016-post-graphql.sql#L5589).
O readback Cloud confirmou ausencia de `EXECUTE` para `anon` e `authenticated`
nessa sobrecarga; nao verificou o privilegio de `service_role`.

## O que exige classificacao, sem revogacao indiscriminada

- As tabelas de automacao possuem grants amplos para `anon`, mas tambem RLS
  habilitada e policies que verificam papel autenticado, organizacao e
  permissoes. O aviso GraphQL nao demonstra sozinho que `anon` le essas linhas.
  Exemplos: [RLS 107269](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L107269)
  e [policy de leitura de automations 112303](../supabase/reconciliation/local-bootstrap/baseline-20261016.sql#L112303).
- `cancel_automations_on_stage_change()` retorna `trigger`; seu grant nao o
  transforma numa RPC comum. A migration do gateway
  [exclui triggers dessa triagem](../supabase/migrations/20260908033712_lock_pipeline_and_lead_mutations_to_backend_gateway.sql#L76).
- `claim_automation_events`, `claim_automation_executions` e
  `apply_automation_internal_effect` possuem grants apenas para `service_role`
  na fonte. Preservar essa distincao ao avaliar avisos de `SECURITY DEFINER`.

## Proximo passo limitado

1. Complementar a leitura de catalogo das RPCs ainda nao consultadas e incluir
   os campos ausentes do readback atual: `search_path`, a ACL de `PUBLIC` e
   `has_function_privilege` para `anon`, `authenticated` e `service_role` nas
   assinaturas pertinentes. Owner e `prosecdef` ja foram conferidos nas seis
   assinaturas da tabela acima. A consulta nao deve chamar as funcoes de mutacao.
2. Reproduzir os casos prioritarios em ambiente descartavel ou transacao de
   teste com rollback, dados sinteticos e duas organizacoes; separar o teste
   SQL do teste HTTP real de PostgREST/GraphQL.
3. Relacionar cada grant ao consumidor autorizado antes de propor a menor
   correcao de ACL ou de guarda no corpo. Registrar mudanca e teste em tarefa
   propria; esta triagem nao aplica hardening nem muda o contrato canonico.
4. Reavaliar acesso geral depois desses resultados. Manter a etapa atual
   limitada a validacao tecnica com dados sinteticos, sem habilitar workers
   ou conectar integracoes operacionais para contornar o bloqueio.
