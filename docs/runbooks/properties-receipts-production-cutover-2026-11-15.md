# F00: recibos no Supabase self-hosted com schema parcial

## Alvo e escopo autorizado

O usuário autorizou encerrar F00 em produção em 15/11/2026. A execução remota é
coordenada pelo responsável pela operação; a preparação deste roteiro não
executa SQL remoto. Conferir novamente o alvo, versão de PostgreSQL, banco,
identidade operacional e API servida antes de aplicar. Não usar o banco local
descartável como evidência de que a produção já foi corrigida.

Preflight real informado pelo operador: PostgreSQL 17.6, recibos e índice de
reserva ausentes, quatro funções e dois triggers ausentes, ledger Supabase
ausente e zero reservas em `properties.metadata`. A tabela tem cerca de 14 MB
e 2.196 linhas estimadas. `id` e `organization_id` são UUID NOT NULL; `metadata`
é JSONB nullable e `created_at` timestamptz NOT NULL. Os roles anon/authenticated
são NOLOGIN sem bypass; service_role é NOLOGIN com BYPASSRLS. O índice avulso
`properties_organization_id_id_uidx` é UNIQUE BTREE(organization_id,id), válido,
pronto e não parcial. Será reutilizado; não há aplicação da foundation.

O delta pertence somente ao contrato de idempotência. Não aplicar a foundation
de lançamentos inteira nem o hardening de ACL/policies auxiliares. Não criar
`supabase_migrations`, registrar timestamps inventados ou executar `db push`.
As 54 alterações locais anteriores desta rodada devem permanecer preservadas.

## Backup e preflight

Para este delta estritamente aditivo, o backup necessário é a preimage de DDL e
catálogo, com os SQLs e hashes da operação. Não exigir dump/migração completa do
banco: nenhum objeto anterior será substituído, o índice composto é reutilizado,
nenhuma linha de imóvel é alterada e o estado conferido tem zero reservas.
Essa conclusão depende de manter os guardas do cutover e as condições reais do
preflight. Se o alvo diferir, reavaliar antes da escrita.

Preservar a preimage de schema de `public.properties`, incluindo owner,
ACL, RLS, índices, constraints e triggers; as quatro funções abaixo se existirem;
e as permissões do schema `private`, juntamente com a prova de ausência dos
novos objetos. A preimage deve ficar protegida no ambiente operacional, sem
dados pessoais ou credenciais no repo ou nos resultados do chat. O cutover não altera linhas já existentes
de imóveis. Com zero reservas, o backfill canônico não insere recibos legados.
Após a primeira criação, recibos e tombstones são dados duráveis e fazem parte
da política de backup. Não removê-los para rollback.

Consultas somente leitura, com timeout operacional e sem exportar registros:

```sql
select current_database(), current_user, current_setting('server_version_num');

select indexrelid::regclass as name, pg_get_indexdef(indexrelid) as definition,
       indisvalid, indisready, indimmediate, indnkeyatts,
       indpred is not null as partial
from pg_index
where indrelid='public.properties'::regclass and indisunique;

select attname, format_type(atttypid,atttypmod), attnotnull
from pg_attribute where attrelid='public.properties'::regclass
  and attnum>0 and not attisdropped
  and attname in ('id','organization_id','metadata','created_at');

select rolname, rolbypassrls, rolcanlogin from pg_roles
where rolname in ('anon','authenticated','service_role');

select pg_relation_size('public.properties') as bytes,
       count(*) filter (where metadata ? '_creation_idempotency') as reservations
from public.properties;

select to_regclass('public.property_creation_receipts') as receipts,
       to_regclass('public.properties_creation_request_uidx') as reservation_index,
       to_regprocedure('private.guard_property_creation_ledger()') as ledger_guard,
       to_regprocedure('private.property_creation_ledger_is_valid(jsonb)') as validation,
       to_regprocedure('private.guard_property_creation_receipt()') as receipt_guard,
       to_regprocedure('private.capture_property_creation_receipt()') as capture;

select tgname, tgenabled, pg_get_triggerdef(oid)
from pg_trigger where tgrelid='public.properties'::regclass and not tgisinternal
  and tgname in ('properties_guard_creation_ledger','properties_capture_creation_receipt');
```

Confirmar PostgreSQL >=15, `id`/`organization_id` UUID, `metadata` JSONB e
`created_at` timestamptz com comportamento compatível com o cadastro. Conferir
PK/índice de `organizations(id)` e existência do schema `private`. O backend deve
usar a identidade privilegiada esperada; RLS sem policies no recibo não pode
depender de um `service_role` sem BYPASSRLS. Qualquer diferença exige revisar o
delta antes de aplicá-lo. Zero reservas é revalidado sob lock pelo cutover.

## Sequência concreta

1. Conferir preimage de DDL/catálogo, preflight e hashes dos arquivos usados. O gate
   `node scripts/supabase/verify-migrations.mjs` deve continuar verde.
2. Aplicar `supabase/cutovers/20261115_prepare_property_creation_receipts.sql`.
   Ele toma SHARE ROW EXCLUSIVE em `properties`, com lock_timeout de 5s e
   statement_timeout de 30s. Reutiliza índice único composto válido, imediato e
   não parcial nas duas colunas, inclusive quando é avulso ou tem ordem inversa.
   Cria o índice composto canônico somente se faltar e não houver conflito de
   nome. Instala apenas o índice/guarda/trigger de reserva do predecessor.
3. Aplicar integralmente, sem editar,
   `supabase/migrations/20261012223804_persist_property_creation_receipts.sql`.
4. Executar os contratos somente leitura:
   `supabase/cutovers/tests/20261115_property_creation_receipt_preconditions.sql`
   e `supabase/tests/property_creation_receipts.sql`.
5. Conferir objetos, RLS/ACL e quantidades; só então retestar pelo CRM.

Usar cliente com alvo explícito já conferido e `ON_ERROR_STOP`; no SQL Editor,
executar cada arquivo completo e conferir o resultado antes de seguir. Os dois
arquivos de escrita possuem transações próprias. Se a etapa 3 falhar, ela é
revertida, mas as precondições da etapa 2 permanecem. Não reaplicar o prelude:
ele recusa objetos já existentes. Inspecionar a causa e repetir somente a etapa
pendente depois da correção. Não eliminar limites ou reaplicar em loop.

O prelude recusa funções/triggers/tabela/índice de reserva já existentes, evitando
sobrescrever uma definição desconhecida. Não modifica auxiliares, registros de
imóvel ou ledger de migrations. Não confundir a execução desse subconjunto com
a aplicação integral de `20260731134638` ou `20261012212534`.

Registrar na evidência operacional o horário, alvo, operador, hashes, índices
reutilizados/criados e readbacks. Registrar a execução integral do SQL de recibos
como evidência de contrato, com sua versão original. O ledger ausente será
reconciliado em operação formal própria; não inventar histórico nesta correção.

## Canário e reversão

No CRM, Vetter co. confirmada, repetir o rascunho sintético pendente pela mesma
intenção idempotente. Conferir um único imóvel, recibo, proprietário e foto
persistida. Reabrir após reload e correlacionar o request ID com a resposta da
API. Um retorno HTTP ou `/readyz` isolado não comprova a criação completa.

Se a aplicação falhar antes do commit de uma etapa, a própria transação desfaz
seu delta. Depois do commit, preferir correção aditiva; recibos/tombstones nunca
devem ser descartados para contornar retry ou rollback de código.

Uma reversão de schema só pode ser considerada antes de qualquer reserva/recibo
novo, sob locks que impeçam criações simultâneas e com readback de ambos os
conjuntos vazios. Nessa situação, remover exclusivamente os objetos recém-criados
na ordem inversa de dependências, usando o backup e a lista da operação. Nunca
remover um índice avulso reutilizado. O índice composto novo pode permanecer como
adição estrutural segura; não alegar restauração total se ele permanecer. Essa
reversão reintroduz o erro 42P01 da versão da API que exige recibos.

Se já houver qualquer recibo, inclusive tombstone, não usar DROP/DELETE como
rollback. Preservar o contrato, suspender novas intenções se necessário e reparar
para frente. Uma restauração integral do backup pode apagar gravações legítimas
posteriores e exige um plano separado.

## Ensaio descartável

`receipt_cutover_postgres_test.go` usa somente bancos próprios aleatórios em
loopback. Os cenários removem a constraint composta do scaffold, conservando
apenas PK(id), zero reservas e funções ausentes. Cobrem ausência do índice e
reuso de índice avulso invertido; aplicam o prelude, SQL canônico e contratos;
confirmam dados/ACLs auxiliares idênticos; capturam criação legada, conservam a
reserva durante substituição de metadata e mantêm tombstone após excluir o
imóvel. Casos negativos recusam reservas inesperadas e função preexistente.

Executar com as variáveis protegidas do harness local já documentadas no runbook
de reconciliação, sem imprimir a URL:

```powershell
go test ./apps/api/internal/properties -run '^TestPropertyReceiptCutover' -count=1 -v
```

O ensaio não cobre a totalidade das demais dependências de `createPropertyTx` ou
Storage da produção. Uma falha posterior revelada no canário deve ser tratada
pela causa e não pela aplicação incidental de migrations de outros domínios.

## Apêndice: execução e canário em 15/11/2026

O operador confirmou a execução em produção pelo acesso SSH autorizado, com
parada em erro (`ON_ERROR_STOP`): primeiro o prelude
`20261115_prepare_property_creation_receipts.sql`, depois a migration canônica
inalterada `20261012223804_persist_property_creation_receipts.sql`. O índice
composto existente foi reutilizado. Não houve aplicação integral da foundation,
hardening incidental dos auxiliares ou criação de ledger Supabase.

O backup protegido preservou o schema completo e as definições das funções
alvo, com a preimage do catálogo. Os contratos pós-aplicação foram aprovados:
RLS e fronteira de grants do recibo, captura de criação e proteção da reserva.
Nenhuma credencial ou conexão de produção é registrada neste documento.

O canário visual recuperou a intenção de cadastro já pendente no navegador da
Vetter co. O CRM abriu a edição de **AP0378**, ID
`8c51c4c1-9f21-471e-8ed3-26396a941c15`. A conferência do banco encontrou um imóvel
e um recibo na mesma organização para esse cadastro, sem criar uma segunda
intenção. O proprietário de QA preexistente ficou vinculado.

Depois da confirmação do cadastro, a foto foi enviada pela UI na edição para o
armazenamento protegido. Após F5, a ficha permaneceu com **1 foto**. O imóvel
terminou em **Rascunho (`draft`)**, com aviso de que não estava no Site.

Evidência visual privada:
[AP0378 persistido](D:/Vimob/outputs/vetter-production-closure-20261115/f00-ap0378-persistido.jpg).

Foi comprovada a recuperação da intenção preexistente até o cadastro e a mídia
persistidos. **Não foi realizado um replay HTTP adicional depois da criação**;
essa verificação específica não deve ser apresentada como executada. A operação
remota e o canário foram conduzidos e conferidos pelo responsável pela execução.
Com o recibo agora existente, qualquer reversão deve preservar esse recibo e os
futuros tombstones conforme o plano acima.
