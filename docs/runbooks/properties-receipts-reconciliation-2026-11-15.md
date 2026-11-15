# Reconciliação dos recibos de criação de imóveis

## Incidente e limite desta entrega

Na auditoria de 15/11/2026, `POST /v1/properties` com chave idempotente retornou
500. O log correspondente registrou `42P01`, relação
`public.property_creation_receipts` ausente. O catálogo de produção confirmou
a ausência. `CreateIdempotent` consulta o recibo antes de iniciar a criação do
imóvel; retirar a chave para contornar o erro permitiria duplicações em retries.

A correção necessária nesse ambiente é reconciliar o schema com as migrations
canônicas existentes. Esta entrega não executa SQL remoto, altera o ledger,
publica código ou cria uma segunda migration para o mesmo contrato. O SHA da API
efetivamente publicada deve ser conferido antes da operação.

Leia primeiro `supabase/README.md`, `supabase/reconciliation/README.md` e
`docs/runbooks/properties-local-hardening-2026-10-12.md`. O bloqueio de
`supabase db push` continua em vigor devido ao ledger histórico. Os comandos
abaixo pertencem a uma operação de banco específica, com alvo, backup e execução
previamente autorizados; não são um deploy automático.

## Contratos e sequência

### Preflight adicional no alvo publicado em 15/11/2026

Foi conferida a organização da auditoria no Supabase self-hosted apresentado
pelo usuário. As consultas foram somente leitura, com saída de catálogo e
contagens agregadas, sem dados de proprietário ou chaves de idempotência:

- `property_creation_receipts`, `properties_creation_request_uidx`,
  `private.guard_property_creation_ledger()` e
  `private.capture_property_creation_receipt()` estavam ausentes.
- `supabase_migrations.schema_migrations` estava ausente nesse alvo. O ledger
  cloud citado como contexto histórico em `supabase/README.md` não foi encontrado
  nem tratado como ledger desta instalação self-hosted.
- Os três roles Supabase estavam presentes. O catálogo de constraints de
  `properties` mostrou apenas `PRIMARY KEY (id)`; índices únicos avulsos e os
  demais contratos da foundation precisam de conferência própria, pois esta
  consulta de constraints não prova sua ausência.
- A leitura de `_creation_idempotency` retornou zero reservas, zero malformadas
  e zero identidades duplicadas. Isso não reconstitui intents históricas já
  removidas ou que nunca foram gravadas.

Portanto a operação depende de reconciliação formal do schema e da proveniência
das migrations desse alvo, incluindo sua equivalência com os pré-requisitos.
Não criar um ledger afirmando execução histórica sem evidência, copiar o ledger
cloud, reaplicar a foundation inteira ou usar `db push` para contornar isso.
Registrar o backup, o plano aprovado de reconciliação e os objetos realmente
ausentes antes de executar os SQLs canônicos. Os passos seguintes são o roteiro
de avaliação e aplicação controlada, não uma autorização automática.

1. `20260731134638_property_developments_foundation.sql` estabelece, entre outros
   objetos, a chave composta de `properties(organization_id,id)` exigida pela FK.
   Conferir o contrato real; não reaplicar a foundation inteira por uma falha de
   um índice sem revisar seu ledger e os demais objetos.
2. `20261012212534_harden_property_creation_and_auxiliary_access.sql` protege a
   reserva no metadata e endurece ACLs de auxiliares. Caso ainda não esteja
   aplicada, revisar todos esses consumidores antes de executá-la.
3. `20261012223804_persist_property_creation_receipts.sql` cria os recibos,
   faz backfill validado, captura inserts de réplicas antigas e mantém tombstone
   quando um imóvel é excluído.

As migrations não são idempotentes em todos os objetos. A presença de parte do
contrato com ledger ausente ou uma versão registrada com contrato incompleto é
drift; interromper a aplicação e reconciliar esse estado explicitamente. Não
marcar uma versão como aplicada apenas para fazer o CLI avançar.

## Preflight somente leitura

Registrar em evidência privada o ambiente, banco, usuário operacional, versão da
API, janela, mecanismo de backup/PITR e responsável pela reversão. Conferir a
identidade do alvo com a infraestrutura já conhecida; o nome do banco sozinho
não é suficiente. Não imprimir URL de conexão, senha ou chaves.

```sql
select current_database(), current_user, version();

select to_regclass('public.properties') as properties,
       to_regclass('public.property_creation_receipts') as receipts,
       to_regclass('public.properties_creation_request_uidx') as legacy_identity;

select rolname, rolcanlogin, rolbypassrls
from pg_roles where rolname in ('anon','authenticated','service_role');

select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.properties'::regclass and contype in ('p','u');

select tgname, tgenabled
from pg_trigger
where tgrelid = 'public.properties'::regclass and not tgisinternal
  and tgname in ('properties_guard_creation_ledger','properties_capture_creation_receipt');

select to_regprocedure('private.guard_property_creation_ledger()'),
       to_regprocedure('private.capture_property_creation_receipt()'),
       to_regprocedure('private.guard_property_creation_receipt()');
```

Conferir também as tabelas auxiliares e `private.has_permission(uuid,text)` do
predecessor, sua RLS, grants e policies. Preservar um snapshot de definições e
ACLs antes de alterar essa fronteira. O cutover de auxiliares em
`supabase/cutovers/20261012_property_auxiliary_gateway.sql` é uma operação
separada e não deve ser executado incidentalmente para criar recibos.

Se o schema de ledger existir, consultar somente as versões relacionadas:

```sql
select version from supabase_migrations.schema_migrations
where version in ('20260731134638','20261012212534','20261012223804')
order by version;
```

Conferir os hashes dos arquivos com o source-lock revisado:

```powershell
node scripts/supabase/verify-migrations.mjs
```

Examinar o backfill sem exportar dados de proprietário, ator ou hashes:

```sql
with ledgers as (
  select organization_id, metadata -> '_creation_idempotency' as ledger
  from public.properties where metadata ? '_creation_idempotency'
), validated as (
  select *, coalesce(
    jsonb_typeof(ledger) = 'object'
    and jsonb_typeof(ledger -> 'actor_id') = 'string'
    and jsonb_typeof(ledger -> 'key_hash') = 'string'
    and jsonb_typeof(ledger -> 'request_hash') = 'string'
    and (ledger ->> 'actor_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and (ledger ->> 'key_hash') ~ '^[0-9a-f]{64}$'
    and (ledger ->> 'request_hash') ~ '^[0-9a-f]{64}$', false) as valid
  from ledgers
), duplicates as (
  select organization_id, ledger ->> 'actor_id', ledger ->> 'key_hash'
  from validated where valid
  group by 1,2,3 having count(*) > 1
)
select (select count(*) from validated) as reservations,
       (select count(*) from validated where not valid) as malformed,
       (select count(*) from duplicates) as duplicate_identities;
```

`malformed` e `duplicate_identities` devem ser zero. A migration aborta em vez
de inventar hashes ou descartar reservas inválidas. Reservas apagadas antes da
introdução dos recibos não podem ser recuperadas pelo backfill; revisar a
existência de intents antigas e o histórico externo sem reexecutá-las.

## Ensaio e aplicação da migration existente

Ensaiar em PostgreSQL descartável com fixtures sintéticas antes do alvo remoto.
Não usar clone com dados pessoais para esses testes. O teste
`remediation_postgres_test.go` exige `LOCAL_WRITE_TEST`, conexão administrativa
loopback e banco administrativo `postgres`; cada caso cria e remove seu próprio
banco aleatório. A infraestrutura deve fornecer previamente os roles Supabase.
Ele executa os dois SQLs canônicos íntegros sobre um scaffold de seus contratos
referenciados, não uma instalação completa da plataforma.

```powershell
go test ./apps/api/internal/properties -run '^TestProperty(History|Receipt)' -count=1 -v
```

Para habilitar somente esse ensaio local, fornecer
`VIMOB_PROPERTY_REMEDIATION_WRITE_TEST=LOCAL_WRITE_TEST` e
`VIMOB_PROPERTY_REMEDIATION_ADMIN_URL` por variável de processo protegida, sem
imprimir o valor nem salvá-lo no repositório. Sem essas variáveis os três testes
de banco são pulados, e o pulo não representa aprovação.

Depois de preflight, ensaio, backup conferido e autorização da operação remota,
usar uma conexão explícita aprovada pelo operador (por exemplo, `PGSERVICE`
preparado fora do repositório), `psql -X` e `ON_ERROR_STOP`. Nunca deixar o alvo
depender dos defaults da máquina. Aplicar somente os arquivos cuja ausência
tenha sido comprovada, na ordem acima:

```powershell
# PGSERVICE deve apontar para o alvo já conferido; não preencher com credenciais.
psql -X --set=ON_ERROR_STOP=1 --file=supabase/migrations/20261012212534_harden_property_creation_and_auxiliary_access.sql
psql -X --set=ON_ERROR_STOP=1 --file=supabase/migrations/20261012223804_persist_property_creation_receipts.sql
psql -X --set=ON_ERROR_STOP=1 --file=supabase/tests/property_creation_receipts.sql
```

Cada migration já abre transação, limita locks em 5s e a execução em 30s.
Se houver timeout, interromper e revisar volume/locks; não repetir em loop nem
remover o limite sem plano específico. Falha de qualquer arquivo impede avançar
para o próximo. A aplicação manual exige reconciliar a versão original no
ledger pela operação formal já revisada do repositório; não usar timestamp novo,
`db push` ou `migration repair` indiscriminado.

## Verificação e rollback

- Executar o contrato SQL de recibos: PK, FK composta, RLS sem policy de browser,
  ausência de grants diretos para browser, privilégio de service_role sem
  DELETE/TRUNCATE, triggers de imutabilidade e captura ativos.
- Reconciliar quantidades de reservas válidas e recibos por organização,
  sem exportar identidades ou hashes. Conferir que nenhuma reserva ficou sem
  recibo e que réplicas antigas com ledger continuam sendo capturadas.
- Só então repetir a intenção canário existente com a mesma chave e conteúdo,
  verificar um único imóvel/recibo, proprietário, foto persistida e a resposta
  de replay. Conferir dois tenants, dois atores e payload divergente no ensaio.
- A readiness atual não consulta essa relação. `/readyz` verde não substitui
  o contrato SQL e a criação idempotente comprovada.

Antes do commit, qualquer falha da migration desfaz a transação. Depois do
commit, a reversão normal é de código com os recibos preservados: **não remover
tabela, recibos, tombstones, triggers ou índice de reserva**. As capturas de
réplicas antigas existem justamente para troca gradual de versões. Uma versão
anterior ao contrato de idempotência exige suspender novas criações e revisar
intents pendentes antes de rollback. Não reenviar intents sem chave.

Se o predecessor tiver mudado ACLs e isso exigir reversão, restaurar somente o
delta revisado com base no snapshot anterior, mantendo os contratos de recibo.
Uma restauração integral do banco exige plano separado, pois desfaz também
gravações legítimas posteriores ao backup.

## Evidência local desta entrega

Em 15/11/2026, PostgreSQL 17.11 descartável em loopback executou o predecessor,
a migration de recibos e seu contrato. Foram verificados backfill em duas
organizações, captura de outra identidade de ator, tombstone após exclusão,
rejeição de mudança de identidade/reanimação e rollback de backfill inválido.
O teste de histórico também leu preços pelo snapshot real e persistiu o evento
genérico sem inventar transição de status/preço. Os bancos próprios foram
descartados ao encerrar cada teste. Produção permanece pendente de reconciliação.

## Histórico de imóveis: correção F10 da mesma rodada

`Repository.Update` já carrega o snapshot sob lock e chama
`insertPropertyUpdatedActivity` na transação. A classificação do evento agora
compara os status pelo normalizador canônico, incluindo aliases e vazio legado.
O snapshot também fornece preços anteriores para que um formulário completo
com preço inalterado não transforme a edição de comentário em evento de preço.
Publicação inalterada segue o mesmo critério. O payload conserva apenas as
mudanças desses classificadores; os rótulos de campos enviados continuam no
contrato `updated_fields` existente.

`ListHistory` projeta `payload.message` como título. `HistoryTab` agora omite
esse detalhe quando repete o título, preservando mensagens distintas. O diálogo
legado de histórico foi examinado e não possui a mesma renderização duplicada.
Nenhuma linha histórica é reescrita; eventos antigos já classificados de forma
incorreta continuam registrados com seu tipo original.

A mudança permanece no repositório legado de imóveis para corrigir o ponto
compartilhado, sem refatorar seus demais fluxos. Esse arquivo já excedia o limite
de tamanho. Uma divisão posterior deve extrair a escrita/projeção de histórico
como responsabilidade própria, mantendo autorização e transação do chamador.

Validação local: regressões de status e da renderização falharam antes do fix e
passaram depois; o pacote Go completo teve 362 testes/subtestes aprovados e 26
integrações preexistentes puladas por dependerem de outras fixtures. Os três
casos PostgreSQL novos executaram sem pulo. O runtime de HistoryTab teve 2/2
aprovados, ESLint focal não encontrou erros e o source-lock conferiu 286
migrations. Nenhuma migration canônica foi modificada.

Rollback de F10: reverter o código da API e da apresentação em conjunto, sem
apagar eventos. Não requer mudança de schema; os campos de preço já existiam.
O reteste visual em produção continua dependendo de implantação, não executada
nesta entrega. Os gates globais de frontend são coordenados pelo responsável
pela integração da rodada.
