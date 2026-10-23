# Projeção segura do histórico de atividades

Mudança preparada e testada localmente em 2026-10-18. Não comprova implantação,
configuração da Data API ou entrega Realtime em produção.

## Contrato

O acesso ao lead permite consultar seu histórico, mas não autoriza detalhes de
um imóvel fora do escopo atual do usuário. Atividades históricas podem guardar
nome, código, preço e percentual de comissão do imóvel. A política de linhas não
consegue sanitizar esses campos.

- `GET /v1/activities` continua sendo a leitura canônica, com a visibilidade de
  imóveis e a projeção de conteúdo/metadados existentes.
- `GET /v1/dashboard/recent-activities` usa a mesma projeção de conteúdo. Mantém
  as linhas e substitui os detalhes vedados pelo texto genérico já estabelecido.
- Na Data API, `authenticated` conserva `SELECT` somente de `id`,
  `organization_id`, `lead_id`, `user_id`, `type` e `created_at`, sujeitos às RLS
  de lead, tenant, sessão e pool existentes. `anon` não recebe leitura.
- `content` e `metadata` são lidos pela API canônica, inclusive para usuários
  administradores. O servidor conserva o acesso necessário para projetá-los
  conforme o perfil; `service_role` não perde privilégios.
- A migration não altera políticas de escrita, INSERT/UPDATE/DELETE, conteúdo
  armazenado, autoria ou regra de transferência do histórico. Retornos de escrita
  que peçam campos sensíveis diretamente passam a falhar; retornos apenas dos
  identificadores autorizados permanecem compatíveis.

## Consumidores verificados no repositório

`hooks/use-activities.ts` usa `lib/api/activities.ts`, que chama a API Go para
listar e criar atividades. `lib/api/dashboard.ts` também chama Go. O componente
legado `RecentActivities.tsx` não está montado no Dashboard atual, mas sua API
continua registrada e deve respeitar a mesma fronteira.

Não foi encontrado consumidor direto `from('activities')` nem assinatura
`postgres_changes` dessa tabela no cliente atual. `LeadRealtimeBus.tsx` e
`BackendRealtimeBus.tsx` invalidam chaves de cache; não precisam de conteúdo ou
metadados brutos. A chave primária e os identificadores de invalidação continuam
selecionáveis. Isso não é teste de entrega de Supabase Realtime: assinaturas
externas, versões implantadas e sessões já abertas precisam de verificação
separada antes de rollout.

O inventário dirigido da baseline local não encontrou view sobre `activities`.
As funções públicas não-trigger que referenciam a tabela são
`apply_automation_internal_effect` e `preflight_historical_lead_import`; o
histórico canônico concede sua execução apenas a `service_role`. Não foi
encontrada RPC pública de cliente que retorne o histórico bruto. Isso é inspeção
de fonte, não inventário do banco remoto.

## Ordem e reversão

A migration `20261018222847_restrict_activity_sensitive_columns_to_canonical_api.sql`
exige a proteção de linhas de
`20261018210058_restrict_activity_reads_to_visible_leads_and_active_session.sql`.
Seu preflight falha antes de alterar ACL se faltar o guard esperado. O
postflight verifica privilégios efetivos, incluindo herança e grants a PUBLIC;
qualquer acesso residual aborta toda a transação. A lista explícita de colunas
também impede que uma coluna nova passe a ser exposta automaticamente.

Os endpoints Go anteriores já acessavam o banco pelo servidor e não dependem
dos grants de navegador. A versão corrigida do Dashboard precisa acompanhar o
rollout para fechar também sua projeção de conteúdo.

Não executar `db push`: permanece o bloqueio de reconciliação documentado em
`supabase/README.md`. Uma reversão deve ser uma nova migration revisada e manter
uma fronteira alternativa de projeção. Restaurar SELECT de tabela reabre o
vazamento, mesmo que a RLS de leads permaneça ativa.

## Verificações locais

`node scripts/supabase/test-activity-read-scope-postgres.mjs LOCAL_WRITE_TEST`
cria somente seu próprio PostgreSQL de dados sintéticos, sem rede ou portas,
com imagem local e volume tmpfs; remove o container ao terminar. Importa helpers
e políticas reais para uma composição mínima, sem simular um replay completo.
Cobre duas organizações, usuário/líder/admin, sessão revogada/recovery, pool,
histórico transferido, ACLs de tabela/coluna/PUBLIC/herança, leitura explícita,
wildcard, whole-row JSON, filtros/ordenação sensíveis e escrita com RETURNING.

O teste Go `TestDashboardActivityProjectionLocalIntegration` exige
`VIMOB_RUN_DASHBOARD_ACTIVITY_DB_TESTS=LOCAL_WRITE_TEST` e
`DASHBOARD_ACTIVITY_TEST_ADMIN_URL` apontando para um PostgreSQL descartável em
loopback. Cria e remove um banco aleatório exclusivo. Executa as consultas reais
do Dashboard e do histórico canônico com duas organizações, usuário/líder/admin,
permissão de imóveis ausente, metadados de comissão, referências antigas,
transferência do lead e mudança de visibilidade do imóvel.

Os testes não exercitam transporte PostgREST, GraphQL, Realtime, navegadores,
produção, carga de 5–6 mil usuários ou replay literal de todas as migrations.
