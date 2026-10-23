# Dashboard principal — correções locais de 12/10/2026

Este lote trabalha no checkout principal, preserva a barra lateral e não publica código nem altera o Supabase de produção. Os filtros compartilhados também estão recebendo alterações em outro trabalho; a validação final precisa considerar o estado conjunto do checkout.

## Comportamento esperado

- Administrador/proprietário: dados da organização conforme as permissões do servidor. Gestor mantém o contrato de acesso amplo já existente, sem criar novas operações administrativas.
- Usuário comum: seus próprios leads. Líder: leads atribuídos aos membros atuais das equipes que lidera, incluindo cards cuja equipe histórica seja outra. Filas sem responsável não são acrescentadas ao recorte da Dashboard do líder.
- JWT sem sessão ativa: rejeição antes de executar o handler. Falha 401/403: esconder números, nomes, detalhes e URLs antigos; falha transitória: última consulta identificada como tal.
- Origem: no máximo sete categorias mais Outras, com soma preservada, legenda e lista completa pesquisável. Valores aceitos mantêm sua identidade; origens incompatíveis com o filtro permanecem visíveis apenas para consulta. Dashboard/Pipeline/Contatos e presets aceitam até 4.096 pontos Unicode, sem truncamento.
- Campanhas: busca e páginas de 25 linhas na apresentação, com total completo. Criativos: invalidação com leads/equipes, miniatura compacta e recuperação de mídia com prazo total e compartilhamento de chamadas dentro da mesma organização.
- Evolução: limites civis no fuso válido da organização, incluindo horário de verão; rótulos de ano e intervalos quando necessário. Filtros relativos acompanham a virada do dia/retorno ao foco.
- Densidade: KPIs, fontes e gráficos compactos no desktop de menor largura/altura e no mobile; dimensões específicas da Dashboard centralizadas.

## Contratos de dados preservados

O KPI Leads conta entradas/reentradas. Ganhos, perdidos, em aberto e conversão usam cards únicos da coorte de captação e seu estado atual. As contagens não se tornam automaticamente iguais entre Dashboard, Pipeline e WhatsApp.

Visitas conta eventos visit/meeting **criados** no período, conforme o filtro de visibilidade da Agenda. VGV continua sendo uma estimativa baseada no valor do lead e, quando ausente, no preço atual do imóvel; não foi criado um histórico financeiro retroativo. Campos legados de comissões ainda não calculados no contrato não devem ser interpretados como movimentação zero.

## Banco e ordem de implantação

O código depende de `membership_generation` em `organization_members`, `team_members` e `round_robin_members`. Uma consulta anterior ao ambiente remoto encontrou essas colunas ausentes; esse estado não foi revalidado nesta rodada. Não se deve publicar a API que depende delas antes de conferir/aplicar a migration `20261009030225_membership_access_generation.sql` e suas dependências no ambiente escolhido.

A migration nova `20261012181651_enforce_own_lead_read_permission.sql` alinha o ramo de leitura própria no Supabase com uma negação explícita de `lead_view_own`. Papéis personalizados continuam aditivos; a ausência de um grant explícito no papel não remove a permissão própria herdada. A migration exige as proteções anteriores de associação ativa e geração de equipe, verifica o formato do helper e as ACLs e falha se o preflight não corresponder. Também revoga PUBLIC/anon/authenticated nas RPCs antigas da Dashboard e seus overloads, inclusive `get_dashboard_stats`, preservando service_role. Não concede novas permissões. Nenhum consumidor dessas RPCs foi localizado no runtime web/Go/Edge.

Antes de liberar uma versão:

1. Conferir o inventário de migrations do ambiente e os pré-requisitos; não executar este lote remotamente por inferência.
2. Validar duas organizações, usuário comum, líder, gestor/administrador, membro inativo, associação removida e reinvitação com geração diferente; testar API e leitura direta no Supabase.
3. Confirmar que `get_dashboard_stats` e RPCs antigas permanecem fora do gateway cliente, conforme o retirement anterior e a nova migration deste lote.
4. Publicar apenas um artefato com o conjunto revisado, verificar sessão revogada e estados 401/403 no ambiente de homologação e confirmar o SHA efetivamente executado.

## Validação reproduzível

As suítes do lote incluem modelos e renderização real dos componentes com dados sintéticos, testes Go de escopo/rotas/mídia/fuso e pgTAP de RLS. Integrações locais usam bancos descartáveis exclusivos em loopback; não devem apontar para banco remoto nem reutilizar dados de clientes.

`scripts/load/dashboard-read-local.mjs` faz somente GET nas rotas fixas da Dashboard em loopback, com confirmação `LOCAL_READ_TEST`, duração/concorrência limitadas e sem imprimir tokens ou dados dos resultados. Medição sintética local não demonstra capacidade de 5–6 mil usuários simultâneos em produção.

Os resultados efetivamente executados, dimensões da verificação visual e eventuais limitações são registrados no fechamento deste lote. Chrome local ou WebKit automatizado não equivalem a uma sessão real do Safari no Mac do usuário.

A seleção de período mantém o contrato compartilhado de instantes calculados pelo dispositivo. O agrupamento da evolução usa o fuso da organização; ele não redefine silenciosamente as datas escolhidas quando o dispositivo está em outro fuso.

## Evidências locais concluídas

- 63 regressões frontend aprovadas, incluindo componentes reais, modelos, estados de cache e harness visual. Cinco larguras (320/390/1024/1280/1440), bloqueio de acesso e medição de carregamento foram executados; o teste de evolução também cobre 12 combinações de anos/horas/DST em quatro larguras, sem sobreposição ou recorte dos ticks. Auth, dados e shell compartilhado são sintéticos no harness visual.
- Oito pacotes Go envolvidos passaram; as 17 rotas da Dashboard rejeitam sessão revogada antes do tenant/handler. A prova Go de geração de associação passou no PostgreSQL descartável via runner Linux.
- 31/31 assertions pgTAP em schema reduzido, com definições/migration reais; preflight sem generation rejeitado sem alterações parciais e limpeza verificada, exit 0. O teste não demonstra a cadeia completa Supabase.
- 8/8 casos PostgreSQL de snapshot seguro passaram: imagem, permalink e fallback preservam registro anterior válido quando o recente é rejeitado.
- A seleção em conjunto do primeiro initial mantém a equivalência com o lookup lateral anterior nos três perfis, inclusive initial ausente e duplicatas com primeira ocorrência não contável. A ordem continua `occurred_at/created_at/id`; reentradas continuam limitadas ao ledger contável.

A fixture de desempenho contém 20.001 leads e 709 reentradas, com os índices existentes reproduzidos. Depois de preparar a base e encerrar DDL concorrente, 60 GETs (10 por endpoint), 10 workers e pool de oito conexões passaram com HTTP 200:

| Endpoint | p95 local |
| --- | ---: |
| Stats | 343,8 ms |
| Origens | 182,5 ms |
| Campanhas | 221,8 ms |
| Criativos | 418,4 ms |
| Evolução | 180,1 ms |
| Distribuição | 205,4 ms |

O plano de criativos passou de 849,1 ms para 251,4 ms após substituir buscas laterais individuais do primeiro evento por seleção em conjunto; o plano novo dispensa JIT, sem alterar a configuração do PostgreSQL nem criar índice. A medição cobre SQL e handlers com contexto sintético e amostra pequena; exclui Auth, proxy, rede de produção, Meta e CDN reais. Não certifica 5–6 mil usuários simultâneos.

Os primeiros ensaios ocorreram durante restauração pesada do fixture e não foram usados como medição final. Houve timeouts de preparação/limpeza no Docker local; a restauração completa foi interrompida e substituída por fixture reduzido vazio. As limpezas posteriores e o replay final foram conferidos. Safari/macOS/iOS, publicação e comportamento real de produção permanecem sem validação neste lote.

A checagem global também encontrou um acesso anulável no painel compartilhado de lead; foi acrescentada uma guarda mínima, preservando o trabalho simultâneo do WhatsApp. O resolver de testes passou a deixar diretórios de pacotes com o resolver do Node, corrigindo o EISDIR observado ao executar o harness de navegador junto aos testes TypeScript.

Campanhas/criativos sobrepõem os defaults globais que desabilitam atualização ao montar/retornar ao foco. O teste usa os hooks reais e QueryObserver: cache antigo atualiza nesses eventos, escopo indisponível não faz requests e dados frescos não causam recarga/polling.

Typecheck, lint global sem warnings, oito pacotes Go e inventários estáticos passaram no fechamento; a source-lock contém 196 migrations. O checkout mantém o trabalho preexistente e simultâneo, sem commit/push deste lote. Containers e bancos descartáveis próprios foram removidos, incluindo o banco de geração que havia ficado após timeout de limpeza no Windows; o cache Go local foi preservado.

## Correções após a nova auditoria do checkout principal

Os resultados acima pertencem à primeira rodada. A revisão seguinte encontrou e corrigiu estas bordas no mesmo checkout, preservando as alterações preexistentes e a barra lateral:

- Origem acima de 4.096 pontos Unicode, valor reservado ou espaços nas extremidades não despacham um filtro inválido; nome e contagem histórica continuam disponíveis. A seleção atual pode ser limpa nos controles existentes. Presets aceitam origens válidas até o mesmo limite; nomes livres continuam fora dos links compartilhados. A busca/atribuição usam pontos Unicode, coerentes com Go/OpenAPI.
- Uma origem legada formada apenas por espaços Unicode/BOM recebe o nome de apresentação **Não informada**, evitando invalidar a resposta inteira. O valor original, a contagem, o agrupamento SQL e os dois modos de contagem permanecem intactos.
- Pipeline e Contatos receberam apenas o limite de leitura compatível para os critérios compartilhados. Cadastros, importações e permissões de escrita não foram ampliados. Demais consumidores do seletor mantêm seu limite próprio.
- Visitas agrupam a origem integral, sem colidir nomes pelo prefixo de 180 caracteres. Liderança exige equipe/pessoas/memberships atuais e `lead_view_team`; dono, participante, público e administrador mantêm os ramos anteriores. O helper equivalente da Agenda recebeu os joins de atividade, conservando `ScheduleView`.
- Intervalos da evolução avançam datas civis seguras, com geração limitada previamente a 24. Testes Go reais cobrem São Paulo/2018 e Apia/2011; datas inexistentes não produzem bucket fantasma.
- Miniaturas/imagens permitem renovação repetida com cooldown e recuperação manual. O ranking recente prevalece sobre lookup antigo. Negativas 401/403 e `session_check_unavailable` da consulta de mídia ocultam toda a linha, incluindo nome, campanha, posição, números e links; a tentativa manual atualiza também o ranking. Falhas transitórias comuns mantêm os dados com aviso explícito. Chaves de usuário/organização/acesso continuam aplicadas.
- Fragmentos de URL são rejeitados integralmente no frontend, Go e preferência SQL, incluindo snapshots legados com credenciais no hash. URLs assinadas sem fragmento continuam válidas.
- Ganhos mostra sete fontes mais Outras, preservando totais, percentuais, detalhes e o recorte parcial informado pela API.
- As leituras Go de leads/Pipeline passaram a verificar sessão ativa: 25 GETs protegidos, dos quais 24 novos. Autenticação, tenant, billing e permissões continuam na composição; métodos de escrita mantêm seu contrato.

A migração nova `20261012201751_restrict_lead_data_api_reads_to_active_session.sql`, criada pelo CLI, acrescenta policies SELECT **restritivas** em `leads` e `lead_attachments`. O helper privado exige UID/sessão correspondentes em `auth.sessions`, nega recovery e AMR malformado e falha fechado. Não altera `can_read_lead`/`is_org_member`, nem concede acesso à tabela Auth. Owners/admins da aplicação usam sessão autenticada; service_role e administradores PostgreSQL conservam seu bypass normal. Essa política também afeta leituras de clientes Pipeline e subscriptions que usam RLS; um canário real de Realtime continua obrigatório antes da implantação.

### Provas da rodada de correção

- 99 testes selecionados de modelos, contratos e SSR/cache do frontend; 11 testes complementares de contratos/persistência; 33 testes de filtros React/Radix reais em Chromium; 7 testes visuais da Dashboard. São 150 casos sem falhas ou skips. A seleção final do frontend inclui as regressões de negativa de mídia e os guards compostos de hidratação/período; log em `tmp/dashboard-fixes-20261012-frontend.log`.
- Dashboard visual em 320x568, 390x844, 1024x768, 1280x800 e 1440x900, mais 12 combinações de largura/rótulos de anos, horas e DST. Auth/dados/shell e contexto de filtros são sintéticos; TSX, Radix, Recharts e CSS de produção são reais. Screenshots locais: `D:/Vimob/tmp/dashboard-fixes-20261012-visual`.
- TypeScript completo e lint global sem warnings passaram. Nove pacotes Go passaram (`app`, `httpserver`, `leads`, `leadscope`, `tenant`, `permissions`, `authorization`, `meta`, `schedule`). O canário HTTP assinado usa checker/resolver sintéticos, cobre duas organizações e mantém testes negativos de sessão, recovery, HEAD e permissões.
- PostgreSQL 17 descartável: 31 asserts pgTAP de leitura própria + 50 de sessão, com duas organizações. Os dois preflights rejeitaram contrato antigo sem deixar alteração parcial; o banco próprio foi removido ao final. Schema reduzido com helpers/migrações reais; não comprova reset da cadeia completa Supabase.
- 14 cenários SELECT reais de privacidade/origem de visitas + 11 da Agenda + 9 de preferência de snapshots passaram em transações/ambiente somente leitura local. EXPLAIN sintético da primeira consulta de visitas: planejamento 60,694 ms, execução 57,448 ms, sem JIT. Não mede carga de produção.

Houve falha inicial do harness visual ao carregar o Auth/Supabase real após a mudança do contexto compartilhado; a simulação da fronteira de filtros foi atualizada e a rodada visual passou. Testes estruturais ainda exigiam guards antigos e foram atualizados para exigir a validação mais restrita de origem e `isFiltersHydrated && !periodError`, mantendo os testes comportamentais de callback inválido. A regressão da origem só com espaços reproduziu a falha antes do ajuste e passou nos dois modos depois, junto com o pacote Go de leads inteiro. Houve um timeout transitório do transporte Windows/loopback no SQL de visitas; a mesma consulta isolada passou e os cenários finais receberam contextos separados, sem aumento de tolerância ou mudança de JIT.

Testes Go que exigem outros bancos preparados/live continuaram desativados; seus skips não são contados como aprovação de integração. CGO está desativado neste host, portanto esta rodada não executou `-race`. Não houve reset completo Supabase, sessão real de Safari/macOS/iOS, prova de 5–6 mil usuários nem alteração/publicação em produção.

Os inventários foram regenerados e `audit:check` passou, incluindo seus quatro testes de contrato. O verificador confirmou 197 migrações e o manifesto de Edge Functions (41 ativas, 26 tombstones e 15 retiradas); o audit de dependências de produção não encontrou vulnerabilidades conhecidas. O inventário visual mantém o débito existente do CRM inteiro. Na Dashboard principal, os três avisos restantes são caixa alta nas iniciais dos avatares e elevação do tooltip; não são achados de autorização ou integridade dos dados, e não motivaram um redesenho fora deste lote.

O checkout continua em `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com a árvore suja anterior e trabalho simultâneo preservados. Os hashes dos dois sidebars e do contexto de sidebar são iguais ao início da rodada. O banco/container descartável próprio foi removido e `git diff --check` passou. Esta validação é um retrato local, não uma árvore limpa certificada para release; alterações posteriores no checkout exigem repetir os gates.

### Implantação posterior e reversão

Manter o bloqueio de `db push` documentado em `supabase/README.md`. Conferir ledger/pré-requisitos do destino, garantir leitura de `auth.sessions` pelo papel da API e validar sessão regular, revogada, recovery, admin, líder, duas organizações, Data API e Realtime. A checagem de existência de sessão não implementa timeout por inatividade/timebox enquanto a linha persistir; JWT exp/issuer/assinatura são responsabilidade do verificador da API/PostgREST.

Reverter código somente por hunks deste lote, preservando a árvore suja anterior e o trabalho simultâneo. A mudança de banco exige outra migração aprovada: remover primeiro as duas policies novas e depois o helper, sem CASCADE. Essa reversão reabre a janela anterior de leitura por JWT revogado até sua expiração. Não restaurar arquivos inteiros nem alterar migrações históricas.
