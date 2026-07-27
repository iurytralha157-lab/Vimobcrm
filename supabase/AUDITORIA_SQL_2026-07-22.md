# Auditoria de SQL — 2026-07-22

## Resultado

O repositório e o histórico de migrations de produção não estão sincronizados.
Nenhum SQL remoto foi executado durante esta auditoria. Um `db push` comum deve
continuar bloqueado até que a reconciliação do histórico seja testada em uma
branch descartável do Supabase ou em um banco de homologação.

Destino confirmado pelas variáveis da aplicação, pelo vínculo local do
Supabase e pelas referências versionadas no código:

- projeto: `Vimob`
- referência do projeto: `iemalzlfnbouobyjwlwi`
- PostgreSQL: 17

O projeto de nome parecido, `Vimob 3.0`, não é o banco usado por este checkout.

## Inventário antes da organização

| Área | Arquivos SQL | Classificação |
| --- | ---: | --- |
| `supabase/migrations` | 175 | Cadeia automática de migrations |
| `supabase/drafts` | 9 | Oito cópias exatas do baseline e uma mudança realmente pendente |
| `supabase/tests` | 42 | Verificações SQL/pgTAP |
| `supabase/cutovers` | 2 | Cutover manual e seu teste |
| `scripts` | 1 | Instalador de produção específico de um cliente |

Os oito rascunhos de 2026-06-21 estavam incorporados integralmente em
`20260622000100_apply_vimob_v3_schema.sql` e foram removidos por serem fontes
duplicadas. O rascunho de agendamento de anúncios foi promovido para uma
migration gerada pela CLI.

O instalador específico da Pamella foi removido depois que o banco de produção
confirmou que as cinco automações já estavam instaladas. Executá-lo novamente
alteraria o estado atual de ativação dessas automações.

Inventário depois da organização:

| Área | Arquivos SQL |
| --- | ---: |
| `supabase/migrations` | 6 |
| `supabase/legacy-migrations` | 173 |
| `supabase/drafts` | 0 |
| `supabase/tests` | 43 |
| `supabase/cutovers` | 3 |
| Total | 225 |

## Comparação do histórico de migrations

| Resultado | Quantidade |
| --- | ---: |
| Arquivos de migration locais | 175 |
| Registros de migration remotos | 444 |
| Versões com correspondência exata | 82 |
| Mesmo nome lógico, mas versão diferente | 41 |
| Versões locais ausentes no remoto | 52 |
| Versões remotas ausentes localmente | 362 |

As 41 correspondências por nome estão listadas em
`migration-history-aliases.json`. Os timestamps diferentes indicam fortemente
que SQLs locais revisados foram aplicados por um caminho que gerou um novo
timestamp remoto. Isso é uma inferência baseada nos metadados do histórico; não
prova que todas as instruções sejam idênticas byte a byte.

Os demais arquivos históricos existentes somente no repositório não podem ser
tratados como uma fila para execução. Muitos criam objetos que foram
posteriormente substituídos ou aposentados, enquanto migrations mais recentes
já estão aplicadas no banco. Reexecutá-los poderia restaurar policies, funções,
triggers, índices ou transformações de dados obsoletos.

## Resultado da reconciliação local

A cadeia histórica foi preservada em `supabase/legacy-migrations` e substituída
na pasta ativa por uma baseline canônica em quatro partes. O ledger bruto remoto
foi mantido fora do Git porque oito arquivos contêm 11 ocorrências do token
público `anon` legado; somente suas 444 versões e nomes foram versionados em
`supabase/reconciliation/ledger-remoto-2026-07-22.json`.

Validações concluídas com Supabase CLI 2.109.1 e banco-sombra:

- a cadeia local antiga falha em
  `20260719040806_fix_whatsapp_webhook_source_session_uuid.sql`, porque o
  baseline antigo cria `leads.source_session_id` como `text`;
- o ledger remoto falha na primeira migration, que tenta atualizar
  `public.users` antes de a tabela existir;
- a nova baseline é aplicada integralmente;
- `auth`, `storage` e `realtime` ficam sem diferenças em relação a produção;
- `public` e `private` ficam somente com três normalizações recorrentes do
  comparador: `pg_net` e duas constraints;
- as duas migrations pendentes são aplicadas com sucesso sobre a baseline.

Uma segunda instância Supabase, isolada do ambiente local principal, confirmou
o reset completo das seis migrations ativas. Nessa validação também foram
corrigidas diferenças reais de ACL padrão, os sete buckets de Storage e uma
sobreposição de policies em `announcements`. A policy pública anterior seria
permissiva em paralelo à nova regra e permitiria ignorar agendamento e
segmentação; a migration agora a remove e cria uma única policy de leitura para
`authenticated`, com bypass explícito para `super_admin`.

O teste focado da reconciliação passou com 8 de 8 asserções. Na suíte histórica,
34 de 42 arquivos ficaram integralmente verdes, com 445 asserções executadas.
Os oito restantes foram classificados: dependências de fixtures ou dados
operacionais (`Pamella`, Vault, cron e integrações), duas expectativas de grants
que também divergem em produção e testes dos motores de atenção/WhatsApp ainda
ligados ao cutover bloqueado. Essas pendências não impedem a equivalência da
baseline, mas devem ser tratadas como dívida funcional separada.

Nenhum `migration repair`, `db push` ou DDL remoto foi executado. O roteiro
protegido está em `scripts/repair-supabase-migration-history.ps1`.

## Trabalho pendente confirmado

### Pronto para aplicação controlada depois da reconciliação

- `20260722103039_stop_redistribution_on_stage_move.sql`: a função e o trigger
  não existem no remoto. O backfill identifica atualmente quatro jobs ativos de
  redistribuição cujo lead mudou de etapa depois da inscrição.
- `20260722210631_announcements_schedule.sql`: a aplicação já lê e grava os
  campos de agendamento, mas produção não possui as três colunas, a constraint,
  os três índices nem a policy de leitura com agendamento.

### Cutovers manuais bloqueados

- `cutovers/20260713000500_whatsapp_backend_cutover_security.sql`
- `cutovers/20260719015030_complete_whatsapp_webhook_token_cutover.sql`

Retrato do momento da auditoria: 55 sessões ativas ainda não tinham convergido
para o endpoint de backend sem token na URL; 7.985 payloads históricos da inbox
ainda continham campos de autenticação; as constraints finais estavam ausentes;
e os privilégios brutos das tabelas de WhatsApp ainda não estavam totalmente
bloqueados. Siga os roteiros de implantação e não trate esses arquivos como
migrations.

## Catálogo do banco e advisors

Os schemas `public` e `private` do banco ativo contêm 211 tabelas, 267
funções, 174 triggers de usuário, 463 policies de RLS e 839 índices.

Verificações positivas:

- nenhuma tabela de `public` está com RLS desabilitado;
- não foi encontrada definição de índice exatamente duplicada;
- não foi encontrada definição de policy exatamente duplicada;
- não foi encontrada view pública sem `security_invoker`;
- nenhuma função pública `security definer` pode ser executada por `anon` ou
  `authenticated`.

Pontos para tratamento separado, sem remoção automática em massa:

- advisor de segurança: 34 tabelas com RLS habilitado e sem policy, além de um
  aviso sobre `pg_net` instalado em `public`;
- advisor de performance: 207 chaves estrangeiras sem índice de cobertura, 154
  avisos de índices não utilizados, quatro tabelas sem chave primária e uma
  alocação absoluta de conexões do Auth.

Uma tabela com RLS e sem policy pode ser intencionalmente exclusiva do backend.
Um aviso de índice não utilizado pode representar um índice recente ou
estatísticas reiniciadas. ACLs, planos de consulta e evidências da carga real
devem ser analisados antes de qualquer alteração nessas categorias.

## Plano de reconciliação

1. **Concluído:** backup lógico e ledger remoto capturados com hashes.
2. **Concluído:** CLI 2.109.1 e Docker usados no replay descartável.
3. **Concluído:** baseline canônica criada e histórico preservado no Git.
4. **Concluído:** schemas externos, publications e duas migrations pendentes
   validados em banco-sombra.
5. **Pendente:** abrir uma janela de manutenção, congelar DDL e criar um backup
   novo imediatamente antes do cutover.
6. **Pendente:** executar o roteiro protegido de reparo do ledger e revisar o
   `db push --dry-run`.
7. **Pendente:** aplicar separadamente as duas migrations, rodar testes SQL,
   advisors e smoke tests da aplicação.

Não execute `migration repair` fora da janela aprovada. A operação altera o
registro de implantação; o manifesto versionado é a fonte de recuperação.
