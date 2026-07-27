# Reconciliação do histórico do Supabase

Esta pasta contém os artefatos seguros necessários para reconciliar o ledger de
produção com a baseline criada em 2026-07-22. Nenhuma alteração remota foi
executada durante a preparação destes arquivos.

## Artefatos

- `ledger-remoto-2026-07-22.json`: 444 versões e nomes registrados no projeto
  `iemalzlfnbouobyjwlwi` no momento do backup.
- `checksums-baseline-2026-07-22.json`: tamanho e SHA-256 das seis migrations
  ativas e do diff final esperado.
- `scripts/repair-supabase-migration-history.ps1`: roteiro protegido para
  remover as versões antigas do ledger, registrar a baseline como aplicada e
  executar somente o `db push --dry-run`.
- `supabase/migration-history-aliases.json`: 41 migrations que possuíam o mesmo
  nome lógico com timestamps locais e remotos diferentes.

O SQL bruto das 444 migrations remotas não foi versionado. O material contém
11 ocorrências do token público `anon` legado, distribuídas em oito arquivos, e
permanece somente no backup temporário da reconciliação.

## Baseline ativa

| Versão | Responsabilidade |
| --- | --- |
| `20260721000000` | Extensões requeridas pelo schema |
| `20260722000000` | Snapshot de `public` e `private` |
| `20260722000001` | ACLs e normalizações necessárias para equivalência |
| `20260722000002` | Policies de Storage/Realtime, trigger de Auth, buckets e publications |

Depois da baseline existem somente duas migrations pendentes:

- `20260722103039_stop_redistribution_on_stage_move.sql`
- `20260722210631_announcements_schedule.sql`

## Evidências de validação

- a cadeia local antiga falhou de forma determinística no contrato
  `leads.source_session_id`;
- o ledger remoto falhou na primeira migration por ausência de `public.users`;
- a baseline e as duas migrations pendentes foram aplicadas integralmente em
  uma instância Supabase isolada com CLI `2.109.1`;
- o diff de `auth`, `storage` e `realtime` ficou vazio;
- o diff final de `public` e `private`, com as pendências aplicadas, possui
  2.347 bytes e SHA-256
  `58055E07684C97654150EB80809F7E25369823C373B84A111EF7D11AC9FD8BA3`;
- esse diff contém apenas os objetos das duas migrations pendentes, a policy
  pública antiga de comunicados, a localização pré-instalada de `pg_net` e duas
  constraints que o `migra` reescreve em toda comparação;
- os sete buckets de Storage reproduzem os limites e tipos MIME observados em
  produção;
- ACLs padrão excessivas que não existem em produção foram removidas
  explicitamente da baseline.

### Testes SQL

O teste dedicado `supabase/tests/sql_reconciliation_pending.test.sql` passou
com 8 de 8 asserções. Ele cobre o trigger de redistribuição, as colunas,
constraint, índices e a única policy autenticada de leitura de comunicados.

A suíte histórica foi executada separadamente no banco isolado:

- 42 arquivos e 445 asserções executadas;
- 34 arquivos integralmente verdes;
- oito arquivos não verdes, classificados sem ocultar falhas: um depende do
  fixture Pamella removido; três dependem de Vault, `pg_cron` e integrações de
  produção; um contém duas expectativas de grants que também divergem no banco
  atual; e três cobrem os motores de atenção/WhatsApp ainda sujeitos a
  reconciliação funcional e ao cutover bloqueado.

As falhas reais encontradas na baseline durante a primeira rodada — default
ACLs, buckets de Storage e policies permissivas sobrepostas — foram corrigidas.
A sobreposição em `announcements` permitiria contornar agendamento e
segmentação; a migration pendente agora remove a policy pública antiga e cria
uma única policy para `authenticated`, preservando o bypass de `super_admin`.

## Janela de reconciliação

Antes de qualquer alteração remota:

1. congele DDL avulso e crie um novo backup lógico;
2. confirme que o projeto vinculado é `iemalzlfnbouobyjwlwi`;
3. execute o roteiro sem parâmetros para revisar o plano;
4. execute o reparo somente em janela aprovada;
5. revise o `db push --dry-run` gerado pelo roteiro;
6. aplique as duas migrations pendentes em um passo separado;
7. rode os testes SQL, advisors e smoke tests da aplicação.

O comando protegido para o passo 4 é:

```powershell
.\scripts\repair-supabase-migration-history.ps1 `
  -Executar `
  -BackupConfirmado `
  -ConfirmarProjeto iemalzlfnbouobyjwlwi
```

Esse comando altera somente `supabase_migrations.schema_migrations` e termina
depois do dry-run. Ele não executa `db push` sem `--dry-run`.
