# Dashboard P1 — implementação e validação local de 18/10/2026

Checkout: `D:\Vimob\workspaces\vimob-crm`, branch `main`, HEAD inicial
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. As alterações anteriores foram
preservadas; havia 2.430 entradas no status inicial. Este lote não fez commit,
push, deploy, migração remota ou acesso a dados de produção.

## Complemento após a segunda revisão

Por decisão explícita do usuário, os filtros compartilhados de Dashboard,
Pipeline, Contatos e Conversas passam a existir somente em memória. Seleções
continuam interligadas durante a navegação, mas não são gravadas nem restauradas
de `sessionStorage`/`localStorage`. Recarregar, trocar usuário/organização ou
remontar a árvore por mudança de autorização inicia filtros vazios. O último
funil também deixa de ser salvo; parâmetros explícitos de navegação e o funil
padrão continuam válidos. Valores antigos do storage são ignorados, sem limpeza
genérica de preferências. Períodos como Hoje/Este mês continuam disponíveis.

As opções de filtros ocultam dados retidos após 401/403 ou falha de validação
de sessão, preservando cache com aviso somente em falhas transitórias. Abrir
o painel revalida catálogos vencidos da organização, inclusive quando uma
seleção em memória já manteve a consulta habilitada.

Origens personalizadas como `__proto__`, `constructor` e `toString` são
tratadas como texto em Entradas, Ganhos/Perdidos, Visitas e Primeiro Contato.
O lookup seguro é compartilhado; nomes, valores brutos e contagens continuam
com os contratos anteriores.

A proteção de colunas do histórico e a projeção do imóvel estão documentadas
em [activity-history-projection.md](activity-history-projection.md). O
complemento de DRE/comissões está em
[dashboard-auxiliary-followup-2026-10-18.md](dashboard-auxiliary-followup-2026-10-18.md).
Esses complementos são locais; não aplicam migrations nem publicam código.
Os resultados abaixo registram o lote P1 original, não a segunda rodada.

## Mudanças de comportamento

1. As nove rotas auxiliares de Dashboard em `/v1/analytics` passam pelo mesmo
   middleware de sessão ativa já usado pela Dashboard principal. Sessão ausente,
   revogada, de outro usuário, de recuperação ou verificador indisponível não
   chega à consulta de dados. Organização e `dashboard_view` continuam exigidos.
2. As oito consultas comerciais usam `leadscope.VisibilitySQL`. Filtros apenas
   restringem o alcance autorizado. Listas de corretores, equipes e líderes
   também verificam os vínculos atuais, sua atividade e `membership_generation`
   no SQL, inclusive quando o contexto de usuário contém um snapshot antigo.
3. `enterprise-kpis` exige o módulo financeiro existente e `financial_view` ou
   `financial_manage`, com negação 403 antes do SQL. Comissões em `vgv-by-broker`
   e `dashboard/top-brokers` exigem a mesma autorização financeira: leitura
   própria para o leitor; gestão para terceiros; sempre dentro dos leads
   visíveis e filtros. A ausência de autorização é `null`, não um zero inventado.
4. A nova policy RESTRICTIVE SELECT de `activities` exige sessão ativa e lead
   pai legível pelas suas próprias políticas RLS. O histórico acompanha o
   responsável atual; o autor histórico não ganha acesso adicional.

As rotas auxiliares são: `enterprise-kpis`, `sla-summary`,
`sla-performance-by-user`, `team-ranking`, `vgv-stats`, `vgv-by-broker`,
`stage-vgv`, `leader-stats` e `team-leader-stats/{teamId}`.

## Regras preservadas e impacto

| Perfil | Resultado esperado |
| --- | --- |
| Usuário | Consultas comerciais limitadas aos leads próprios autorizados; financeiro depende de permissão separada. Ter gestão financeira não concede acesso ao ranking comercial. |
| Líder | Leads dos responsáveis atuais das equipes lideradas, inclusive quando a origem histórica do lead é outra equipe; membros/vínculos removidos deixam as listas. Comissões de terceiros exigem gestão financeira. |
| Gestor | Acesso comercial amplo continua dependendo de `lead_view_all`; isso não concede financeiro automaticamente. |
| Administrador/proprietário | Alcance da própria organização preservado; o gate legado de disponibilidade do Financeiro continua obrigatório. |

Datas, fórmulas de métricas, coortes, filtros e associação por `team_pipelines`
foram preservados. A Dashboard continua excluindo leads sem responsável para
leitores restritos. O histórico via Data API reutiliza o contrato RLS de leads,
que pode autorizar um lead sem responsável da equipe; são contratos diferentes.
Atividades sem lead e `organization_id` legado nulo continuam sujeitas às suas
policies anteriores, agora também ao gate de sessão. Nenhuma policy anterior
foi removida ou reescrita. O bypass operacional dos papéis de serviço permanece.

Não houve mudança no gate legado por nome/allowlist do Financeiro, no DRE,
na navegação ou nas regras globais de Pipeline/WhatsApp. P2/P3 da revisão anterior
não fazem parte deste lote. Os widgets legados de ranking/atividades continuam
sem ser acrescentados à tela principal.

## Arquivos principais

- `apps/api/internal/app/routes.go` e novo teste de rotas/sessão auxiliares.
- `apps/api/internal/analytics/business_repository.go`, `business_scope.go`,
  `handler.go` e testes de acesso/fixture/integração.
- `apps/api/internal/financial/dashboard_access.go`: interface pública que
  reutiliza a autorização do domínio financeiro, acompanhada de testes.
- `apps/api/internal/leads/dashboard_commissions.go`, `dashboard.go`,
  `dashboard_types.go` e testes de comissões.
- `lib/validation/final-domains.ts`, `hooks/use-vgv.ts`,
  `components/features/dashboard/TopBrokersWidget.tsx` e teste runtime:
  compatibilidade com comissão nullable, preservando respostas numéricas.
- `packages/contracts/openapi/v1.yaml`: contrato nullable documentado.
- `supabase/migrations/20261018210058_restrict_activity_reads_to_visible_leads_and_active_session.sql`,
  duas fixtures/testes SQL e `scripts/supabase/test-activity-read-scope-postgres.mjs`.
- `supabase/migrations.source-lock.json`: somente a nova migration acrescentada.
  Os inventários gerados em `docs/audits/` refletem o checkout atual, incluindo
  alterações anteriores ao lote; não representam novas mudanças funcionais.

## Validação executada

- Reprodução antes da correção: nove rotas ignoravam a verificação de sessão;
  SQL de Analytics retornava dados fora do corretor/líder; atividades expunham
  histórico de terceiros e aceitavam sessão de recuperação. Também foi
  reproduzida a enumeração de nomes após a mudança de vínculo.
- Testes Go finais dos quatro pacotes `app`, `analytics`, `financial`, `leads`:
  exit 0; 750 testes de nível principal aprovados e zero falhas. As duas novas
  integrações P1 foram habilitadas e executadas contra PostgreSQL descartável.
  Houve 70 testes opcionais preexistentes pulados por falta de suas configurações
  de integração; eles não são contados como aprovados.
- Analytics: 13 cenários SQL, incluindo duas organizações, perfis, retirada de
  permissão, filtros adulterados, comissões e vínculos renovados/removidos.
- TopBrokers: 18 cenários SQL, incluindo leitura própria/ampla, gate do módulo,
  outro tenant, comissão ligada a lead fora do alcance, filtros e fallback.
- Atividades: 39 assertions SQL em PostgreSQL 17.10. Pré-requisito ausente
  rejeita a migration sem criar policy nem alterar as anteriores; depois da
  restauração, o caminho válido passa. Fingerprint das policies antigas intacto.
- Frontend: 12 testes focados aprovados, sem skips; `npm run typecheck` exit 0;
  `npm run lint` exit 0, com sete warnings de variáveis não utilizadas em arquivos
  preexistentes fora do lote.
- Verificador de migrations: 253 migrations não vazias com source-lock válido;
  nenhum hash histórico alterado.
- Inventários CRM/Home atualizados e conferidos; quatro testes do contrato de
  inventário aprovados. `git diff --check` dos arquivos do lote passou; todos
  os arquivos Go do lote estão formatados. Os bancos/containers descartáveis
  próprios foram removidos ao final, sem remover serviços já existentes.
- Lint suplementar dos novos scripts/testes JavaScript passou sem warnings.
  O OpenAPI foi interpretado com `js-yaml` já instalado e confirmou
  `DashboardTopBroker.totalCommissions` como `number | null`.

Warnings de lint: `scripts/supabase/queue-browser-cleanup.test.mjs` 15:9, 15:47,
16:9; `scripts/supabase/queue-postgres-races.mjs` 7:36;
`supabase/functions/_shared/property-inventory-eligibility.test.ts` 24:18;
`supabase/functions/ai-agent-responder/public-property-catalog.test.ts` 21:16,
27:12. Não foram adicionadas supressões.

## Reexecução local

As integrações Go exigem um PostgreSQL descartável exclusivo em loopback,
sem dados de clientes. As variáveis abaixo são somente de teste; não se deve
carregar `.env` de produção. A fixture Analytics exige o banco vazio de nome
`dashboard_p1_analytics`; TopBrokers cria e remove seu próprio banco aleatório.

```powershell
# Em apps/api, com banco descartável já conferido e preparado:
$env:DASHBOARD_ANALYTICS_TEST_DATABASE_URL = 'postgres://postgres@127.0.0.1:53344/dashboard_p1_analytics?sslmode=disable'
$env:VIMOB_RUN_DASHBOARD_FINANCIAL_DB_TESTS = 'LOCAL_WRITE_TEST'
$env:DASHBOARD_FINANCIAL_TEST_ADMIN_URL = 'postgres://postgres@127.0.0.1:53344/postgres?sslmode=disable'
go test ./internal/app ./internal/analytics ./internal/financial ./internal/leads -count=1

# Na raiz, Docker desktop-linux local com postgres:17-alpine já disponível:
node scripts/supabase/test-activity-read-scope-postgres.mjs LOCAL_WRITE_TEST
node scripts/supabase/verify-migrations.mjs
node --test components/features/dashboard/dashboard-financial-visibility.runtime.test.mjs components/features/dashboard/dashboard-ui.runtime.test.mjs
npm run typecheck
npm run lint
npm run audit:check
```

O runner SQL não aceita URL ou container existente: cria container próprio sem
rede, sem portas e com tmpfs; verifica o identificador de propriedade antes de
removê-lo. As fixtures Go representam leads sem pool gerenciado; a fixture RLS
usa policies/helpers reais da baseline local e roster de pool controlado vazio.

## Limites, compatibilidade e reversão

A migration está preparada e testada exclusivamente no ambiente descartável.
Não foi aplicada em produção. O lote não valida replay completo do Supabase,
PostgREST HTTP, entrega Realtime em canal já aberto, implantação real, Safari
ou carga de 5–6 mil usuários. Não equivale a liberação de produção.

Uma implantação futura requer autorização própria e conferência do ledger e
pré-requisitos, respeitando o bloqueio de `supabase db push` do README. Publicar
o frontend compatível com números e null antes da API evita quebra do contrato
durante troca de versões. A nova policy é compatível com os papéis de serviço
já usados pela API; clientes diretos passam a respeitar o lead e a sessão.

Reversão local: retirar seletivamente apenas os hunks/arquivos deste lote,
comparando com os backups, sem restaurar o checkout inteiro. Em uma implantação
futura, reverter somente o frontend após a API nullable exige compatibilidade.
Uma reversão da policy deve ser uma migration futura aprovada e específica;
removê-la reabre a exposição identificada. Não há rollback automático ou
autorização de executar qualquer etapa remota neste documento.
