# Baseline de schema para instalações locais novas

Este caminho é exclusivo de bancos locais descartáveis. Preserva todos os SQLs
canônicos e o `migrations.source-lock.json`. Não substitui nem executa o roteiro
de reparo do ledger de produção descrito em `../README.md`.

## Por que há uma baseline local

A cadeia de 2026 contém contratos históricos que não podem executar de forma
literal em um banco vazio, mesmo com a plataforma Supabase correta:

1. `20260921115616_add_silent_historical_lead_import.sql` exige a ausência de
   três gatilhos criados por migrations anteriores. Mais adiante,
   `20260922173000_add_whatsapp_attendance_capture_gate.sql` exige os gatilhos
   de auto-reply quando a função correspondente existe.
2. `20260921132800_guard_historical_stage_clock.sql` exige quatro registros C2S
   e hashes exatos dos respectivos payloads de produção. A migration mistura
   instalação de um contrato de schema com um reparo pontual de dados.
3. `20261012144339_whatsapp_selected_route_explicit_pn_barrier.sql` e
   `20261012223733_whatsapp_stored_lid_contact_identity_barrier.sql` aceitam
   somente o corpo derivado de um cutover separado. O predecessor aceita
   também o corpo produzido pela cadeia canônica sem aquele cutover.

Uma migration adicionada ao fim não resolve uma falha anterior. A baseline
materializa o schema reconciliado; seu manifesto conserva a procedência e os
hashes de cada migration representada. O histórico original continua arquivado
e sua execução literal não é declarada aprovada.

## Contratos e artefatos

`baseline-20261016.json` fixa o prefixo canônico representado, os artefatos SQL,
o catálogo esperado e os dados estáticos permitidos. Os SQLs de schema,
binding de extensão e referência são artefatos separados. O complemento GraphQL
restaura somente a definição, proprietário e ACL conferidos na origem local.

Os únicos dados de referência permitidos são:

| Tabela | Finalidade |
| --- | --- |
| `private.queue_timezone_catalog` | Fusos reconhecidos pelo PostgreSQL usado |
| `public.admin_subscription_plans` | Planos constantes do produto |
| `public.available_permissions` | Catálogo de permissões |
| `public.help_articles` | Conteúdo inicial de ajuda |
| `public.home_publications` | Conteúdo inicial da página de entrada |

Cada artefato de referência aponta para hashes de migrations do prefixo.
O verificador calcula quantidade e SHA-256 dos registros, sem imprimi-los.
Leads, organizações, usuários, sessões, credenciais, Vault, jobs, outboxes,
cursores e estados de workers não fazem parte dessa referência.

A instalação de `pg_cron` existe somente no banco configurado pelo cluster.
Clones locais em outro nome não recebem scheduler. A única exceção de catálogo
aceita pelo tooling é `excludeLocalCron`, com justificativa exata no manifesto;
ela exclui a extensão `pg_cron` e o schema `cron`. O sentinela fixo do antigo
QA também é infraestrutura excluída da comparação e do snapshot.

As sequências `private.lead_distribution_ticket_<32 hex minúsculos>` são
contadores operacionais criados por fila. O snapshot não carrega esses estados.
O catálogo só as exclui depois de conferir proprietário `postgres`, tipo
`bigint`, incremento/cache de um, mínimo um, máximo de bigint, ausência de
ciclo/ownership de tabela ou extensão e acesso exclusivo do proprietário.
O início pode ser maior que um, conforme a recuperação canônica de tickets
anteriores. A validação ocorre antes e depois da coleta; um objeto com esse
nome e outra estrutura/permissão é recusado. Tipos, funções ou outros objetos
com nomes parecidos continuam entrando na comparação.

ACLs são comparadas com `aclexplode`, incluindo defaults, grantor, grantee,
privilégio e grant option. Somente sua ordem física no array é normalizada.
As colunas mantêm nome, tipo e ordem visível; os slots físicos de colunas já
removidas não são um contrato reproduzível pelo `pg_dump`. Diferenças reais de
grant, owner, definição ou tipo permanecem bloqueantes.

## Alvo e execução

Antes de qualquer banco, o gate de fontes verifica todos os hashes do prefixo,
os artefatos SQL e os forwards revisados, sem conexão, `.env` ou Docker:

```powershell
node scripts/supabase/verify-local-schema-baseline.mjs
```

Esse comando não altera CI, package scripts ou o gate canônico de migrations.
Execute também os gates já documentados em `supabase/README.md`.

O arquivo de alvo fica fora do repositório e contém apenas a referência ao
manifesto privado já usado no QA; não copie sua conexão nem chaves para este
diretório. Formato:

```json
{
  "kind": "vimob-local-schema-baseline-target-v1",
  "runManifest": "C:/caminho/absoluto/ao/manifest.json",
  "runId": "UUID-DO-QA",
  "databaseName": "vimob_local_baseline_identificador"
}
```

O executor verifica novamente contêiner, rótulos, redes e publicação loopback
com o contrato existente de QA. Só aceita o prefixo de nome acima, no cluster
local atestado; recusa `postgres`, banco remoto e um alvo sem sentinela próprio.
O preparo do banco descartável e do schema `vimob_local_bootstrap` cabe ao
responsável pela homologação. O sentinela deve conter uma única linha:
`singleton=true`, `run_id`, `project_id` e `baseline_id` correspondentes aos
manifestos. O preflight exige ausência de relações de domínio ou plataforma.

Execute a partir da raiz do principal, substituindo somente os caminhos locais:

```powershell
node scripts/supabase/local-schema-baseline.mjs --manifest D:/Vimob/workspaces/vimob-crm/supabase/reconciliation/local-bootstrap/baseline-20261016.json --target C:/alvo-local.json --mode preflight
node scripts/supabase/local-schema-baseline.mjs --manifest D:/Vimob/workspaces/vimob-crm/supabase/reconciliation/local-bootstrap/baseline-20261016.json --target C:/alvo-local.json --mode apply
node scripts/supabase/local-schema-baseline.mjs --manifest D:/Vimob/workspaces/vimob-crm/supabase/reconciliation/local-bootstrap/baseline-20261016.json --target C:/alvo-local.json --mode forward
node scripts/supabase/local-schema-baseline.mjs --manifest D:/Vimob/workspaces/vimob-crm/supabase/reconciliation/local-bootstrap/baseline-20261016.json --target C:/alvo-local.json --mode verify
```

`--output <arquivo>` salva a atestação sem conexão ou credenciais. `catalog`
salva as definições e permissões para comparação independente, sem registros de
tabelas. O modo normal imprime somente hashes, quantidades e classificação.

O restore usa os bytes revisados e `psql -X` com `ON_ERROR_STOP`, transação e
sentinela revalidado no próprio servidor. Nenhum `--linked`, `db push` ou
configuração de produção é utilizado. Só os metacomandos `restrict` e
`unrestrict` gerados pelo `pg_dump` são aceitos nos artefatos.

O restore completo usa o papel fixo `supabase_admin` exclusivamente pelo socket
local do contêiner atestado. O guard exige esse usuário com `rolsuper` e
`rolcanlogin`: restaurar proprietários dos schemas da plataforma requer essa
capacidade, que o papel `postgres` do Supabase não possui. A conexão de
verificação e o ledger usam `postgres`. O runner não eleva papéis nem altera
privilégios da aplicação para contornar o erro.

A senha sintética vem somente do manifesto local atestado e é passada por
variável de ambiente do processo filho (`docker exec --env PGPASSWORD`). Seu
valor não entra em argumentos, relatório ou SQL; `psql --no-password` recusa
qualquer tentativa de pedir credenciais interativamente.

O runner exige PostgreSQL 17 ou superior e usa `PGCONNECT_TIMEOUT=10`, timeout
de lock de cinco segundos e `transaction_timeout=180s` no servidor. Aos 190
segundos encerra somente o processo filho de restore que criou. O prólogo dos
artefatos preserva os limites revisados; desligar esses limites é recusado.

## Ledger próprio e forwards

Depois de comparar schema e referência, `vimob_local_bootstrap.attestation`
registra hashes do catálogo, referência, prefixo e artefatos. Seu campo
`historical_execution` é sempre falso. O ledger
`vimob_local_bootstrap.history` distingue:

- `baseline-equivalent`: arquivo histórico representado estruturalmente;
- `forward-executed`: arquivo posterior realmente executado nesse banco.

Não há preenchimento artificial de `supabase_migrations.schema_migrations`.
A API de homologação deve reconhecer a classificação própria e verificar as
provas; não basta trocar uma flag de “cadeia completa”.

Forwards devem ser um sufixo exato das migrations ativas, com source-lock válido.
O executor remove somente um par externo `BEGIN`/`COMMIT`, analisando comentários,
strings e corpos com dollar-quote, para executar SQL, fingerprint e registro em
uma única transação. Outros comandos transacionais no nível superior são
rejeitados. Uma migration incompatível com transação exige roteiro específico;
nenhum fallback automático enfraquece essa proteção.

## Falhas, recuperação e evidência

Falha de restore ou fingerprint não certifica histórico algum. Preserve o erro
e as diferenças; descarte/recrie somente o banco local identificado antes de
repetir. O comando `apply` recusa banco já preenchido. Não tente “consertar” um
restore pela edição do manifesto para aceitar um desvio não revisado.

Falha anterior ao commit de um forward reverte o SQL e o respectivo registro.
Perda do reconhecimento do commit não provoca repetição cega: uma nova chamada
valida o ledger durável e o catálogo exato. Regressão de schema é feita em outro
banco descartável com a baseline anterior e sua cauda conhecida, sem downgrade
automático de dados ou schema do principal/produção.

O catálogo confronta proprietários e ACLs, funções, triggers, índices,
constraints, RLS/policies, tipos, defaults, sequências, publicações, extensões e
objetos da plataforma Supabase. Os testes reais de API, distribuição,
redistribuição, bolsão e automações continuam necessários depois do restore.
Os testes puros do tooling rodam com:

```powershell
node --test scripts/supabase/local-schema-baseline.test.mjs
```
