# Filtros do CRM: adoção local da lateral e compatibilidade de tags

Rodada autorizada em 17/10/2026, no checkout principal `main`, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. O checkout já continha 2.349
entradas modificadas/não rastreadas. As alterações desta rodada são incrementais;
não restaurar arquivos inteiros nem misturar as outras auditorias.

## Comportamento entregue

`SharedFilters` passa a abrir a lateral por padrão. Isso alcança os seis
consumidores reais: Contatos, Dashboard, Pipeline, Marketing, Campanhas Meta
e Conversas. A opção explícita `presentation="popover"` continua disponível
para compatibilidade. Não se alteram os critérios, permissões, busca aplicada,
OR de tags/campanhas, paginação ou políticas dos relatórios.

Os botões de período e filtros usam o mesmo `FILTER_UI.trigger`, conforme
Contatos: fonte de 10 px, altura de 32 px, ícone de 14 px, raio de 6 px e
superfície suave. Foram removidas diferenças de fonte/cor nos consumidores;
as adaptações existentes para ícones e espaço no mobile permanecem.
O calendário de período continua em popover. Seus dias passaram de 14 para
12 px, mantendo áreas de toque de 36 × 36 px, mês, atalhos, seleção e ações.

A lateral conserva o visual do piloto: largura `min(400px, 90vw)`, transparência,
campos ativos em laranja a 50%, X e Limpar filtros cinza e Buscar laranja.
O coordenador já existente mantém a posição temporária do balão do WhatsApp.
Os filtros salvos e links de filtros removidos na rodada anterior não voltam.

## Causa do erro de tags

O filtro usava `useTags()` em modo de gerenciamento. Seu schema completo exige
`updated_at`, usado como revisão nas gravações CAS. O DTO antigo da API Go não
inclui essa revisão. Reexecutar o hook anterior com esse DTO reproduziu o erro
exato: `tags.list: data.0.updated_at: Required`.

`useSharedFilters` agora solicita `useTags({ catalog: true, ... })`. O catálogo
existente valida os campos de seleção e aceita tanto o DTO antigo quanto o
catálogo enxuto atual. Mantém escopo de organização, usuário, sessão e transporte
cancelável. Não inventa timestamp, não transforma falha em lista vazia e não
relaxa o contrato de criação/edição/exclusão de tags.

Falhas reais continuam sinalizadas, com tentativa de recuperação. O toast de
atualização de opções da Pipeline não apresenta detalhes técnicos do contrato.
Os erros e validações permanecem disponíveis no estado da consulta.
Nenhum servidor, schema de banco, configuração remota ou API implantada foi
alterado ou consultado para comprovar esta correção.

## Menus dentro da lateral

`advancedContent` aceita um renderizador que recebe o identificador da camada.
Marketing propaga esse escopo aos seus seletores e campanhas. Conversas propaga
ao seletor de conta e calendário de última mensagem. Esses portais mantêm o pai
aberto e a acessibilidade/foco do menu. O calendário aninhado é identificado
separadamente para não herdar a largura de um dropdown simples.

Os labels ativos dos quatro critérios de conversa, a conta e a última mensagem
também recebem o destaque do painel. As condições de lead, conversa sem lead,
criação do lead e última mensagem continuam independentes como antes.

As mudanças nos legados grandes `SharedFilters` e `MarketingScreen` limitam-se
ao padrão de apresentação e à ligação de escopo do conteúdo. Separar seus campos
e cabeçalhos em componentes menores é um trabalho posterior; fazê-lo aqui
misturaria as auditorias paralelas.

## Evidências e limites

Pasta desta rodada:
`C:\Users\andre\AppData\Local\Temp\vimob-filters-rollout-20261017-023020`.
Contém baselines, hashes de congelamento, logs e capturas. O piloto anterior
está descrito em `contacts-filter-sidebar-pilot-2026-10-17.md`.

Os testes usam componentes, hooks e validadores reais com identidade, dados e
transporte sintéticos. Não houve chamadas externas, envio de mensagens,
exportação real, alteração de banco, serviço, commit, push ou deploy.
Capturas são de fixtures locais, não de uma sessão autenticada em produção.
Safari/Mac, VoiceOver e aparelhos físicos não foram verificados.

O teste responsivo de Conversas cobre o componente de filtros isolado. A tela
completa ainda escolhe subárvores distintas entre mobile/desktop; este ensaio
não comprova preservação do editor durante o resize dessa tela inteira.
O teste estático confere os seis consumidores e o provider; não equivale a
um teste ponta a ponta de cada tela.

### Resultado da verificação

| Conjunto | Casos únicos aprovados |
| --- | ---: |
| Regressão do piloto, chat real, edição/IME, layout, períodos, sessão e UI | 119 |
| Adoção da lateral, tokens, portais de Marketing e Conversas | 17 |
| Compatibilidade do catálogo e erro real do hook anterior | 15 |
| Fonte e ações do calendário | 5 |
| **Total** | **156** |

A execução conjunta dos 119 teve 117 aprovações e duas falhas de seletores
antigos: um procurava o popover substituído pela lateral; outro encontrava o
novo botão X em vez do trigger, que fica fora da árvore acessível no mobile.
Os alvos foram atualizados, mantendo as asserções de geometria e estado aberto
e acrescentando a visibilidade da lateral. Ambos os casos foram reexecutados
e passaram. A contagem acima considera cada caso apenas uma vez, sem pulos.
As quatro repetições para capturar imagens não foram somadas.

`npm run typecheck` passou (exit 0). `npm run lint` terminou com exit 1: dois
erros `react-hooks/refs` em `components/features/leads/LeadDetailDialog.tsx:1525`
e sete avisos em scripts de fila e testes de imóveis. Esse componente não foi
alterado nesta rodada; os erros fora do escopo foram preservados para não
interferir nas outras auditorias. O lint global não apontou erro nos arquivos
de produto dos filtros. Não se apresenta o gate global como aprovado.

Os 12 arquivos de produto ficaram congelados entre os testes e os gates.
Sheet, CSS global, FilterContext e manifests de dependências foram conferidos
por hash e preservados. Os arquivos de teste alterados também receberam
verificação de lint; os logs da rodada identificam cada conjunto.

## Reversão

Para reverter somente a adoção visual, inverter os hunks de apresentação e
tokens ou definir `presentation="popover"` nos consumidores pertinentes.
Reverter escopos de portais exige revalidar os menus e foco em mobile/desktop.
Preservar a leitura de tags pelo catálogo: ela corrige o erro de contrato
independentemente do transporte visual. Para reverter somente a fonte dos
dias, inverter os dois estilos locais do calendário.
Não reativar filtros salvos e não restaurar arquivos inteiros neste checkout.

## Refinamento visual do período (17/10, após a expansão)

Aplicado somente ao `DateFilterPopover`, com CSS escopado por `data-date-filter`.
A primitiva Calendar e os calendários de outros formulários continuam intactos.

- Hoje, quando não selecionado: laranja a 50% e texto branco.
- Hover nos dias e atalhos: laranja a 50% e texto branco. A seleção prevalece:
  todos os dias do intervalo e atalhos ativos usam 100%, inclusive no hover.
- Dias de meses adjacentes conservam as mesmas cores efetivas quando marcados
  como hoje ou selecionados, sem a opacidade adicional dos dias externos comuns.
- Espaço entre o cabeçalho do mês e os dias da semana: 16 para 8 px. Os números
  continuam em 12 px e os alvos de toque em 36 × 36 px.
- Ações Limpar seleção/Aplicar: 12 px, peso 500, sem transformação em maiúsculas
  e sem redução de espaçamento das letras. Aplicar usa laranja a 50% e texto
  branco; no hover habilitado passa a 100%.
- Limpar período foi retirado da coluna de atalhos abaixo de Este ano. O reset
  aplicado permanece no rodapé, inclusive no modo sem calendário. Mantém o
  mesmo handler, condição e ordem de callbacks. Limpar seleção continua apagando
  apenas o rascunho, sem alterar o período já aplicado.

A revisão reproduziu dois problemas de apresentação intermediários: regras
`!important` da camada utilities sobrepunham o preenchimento dos dias internos
do intervalo; dias externos selecionados tinham opacidade herdada de 30%.
O CSS local passou para a mesma camada, com especificidade escopada e opacidade
explícita para dias selecionados/hoje. Não se alteraram regras de data, busca,
permissões, transporte ou critérios do CRM.

Os 16 testes visuais dedicados passaram nos temas claro/escuro e larguras de
320, 390, 1024 e 1440 px. Incluem cores computadas, opacidade dos ancestrais,
hover, mês adjacente, tipografia, callbacks de limpeza e comparação com um
Calendar independente. A primitiva permaneceu idêntica por hash.

Validação desta revisão: **77 casos únicos confirmados** — 61 regressões de
período/UI/relatórios/lateral e 16 casos visuais novos. Na execução conjunta,
59 dos 61 passaram; dois testes de hover exigiam mouse num contexto configurado
com toque (`hover: none`). A pré-condição do ensaio foi corrigida somente nesses
dois casos, que passaram com mouse real emulado, os mesmos valores esperados e
restauração do toque no `finally`. Os 77 casos foram executados, sem pulos;
repetições de diagnóstico/captura não foram somadas.

`npm run typecheck` passou na versão final (exit 0). O lint global foi executado
novamente e continuou com dois erros `react-hooks/refs` em
`components/features/leads/LeadDetailDialog.tsx:1538` e sete avisos externos.
Esse arquivo não foi alterado por esta revisão. Não se considera o lint global
aprovado; nenhum erro foi apontado nos produtos do período, e os testes
alterados passaram também no lint focado.

Os dois arquivos de produto permaneceram congelados durante a validação final.
Calendar, Button, Sheet, CSS global, SharedFilters, hook de critérios, contexto
compartilhado e manifests de dependências foram preservados por hash.

Evidências desta revisão, baselines, reproduções negativas e capturas:
`C:\Users\andre\AppData\Local\Temp\vimob-period-style-20261017-024553`.
São ensaios locais em Chromium com dados sintéticos e rede bloqueada; não
comprovam comportamento nativo no Safari/Mac ou em aparelho físico.
Para reverter somente esta revisão, inverter seus hunks em DateFilterPopover
e retirar o estilo local, preservando o catálogo de tags e a lateral entregues
antes. Não houve serviço, banco, instalação de dependências ou deploy.

## Revisão com os três perfis e respostas reais (17/10, manhã)

Escopo: checkout principal, sem deploy. A interface local continua usando a API
publicada em modo de consulta. O usuário autorizou testar contas existentes da
Vetter Co.; foram usadas sessões temporárias de administrador, líder e usuário
padrão, confirmadas por `/v1/me` com organização explícita. Não foram alteradas
senhas, papéis, equipes, leads, integrações ou configuração remota. As sessões
criadas para os ensaios foram encerradas individualmente; nenhum token ou senha
foi gravado nos relatórios.

### Recorrência do alerta de opções

A primeira rodada de GETs retornou HTTP 200, mas isso não comprovava a aceitação
dos DTOs pelo frontend. O confronto posterior com os schemas reais reproduziu
a falha de equipes em administrador e líder: `data.0.revision` ausente. Tags,
opções Meta e usuários passaram pelos respectivos contratos com respostas reais.
O erro anterior de tags e este erro de equipes têm o mesmo acoplamento entre
contrato de edição e leitura para seleção, em recursos diferentes.

O modo `useTeams({ catalog: true })` passa a usar `teamsAPI.catalog` e uma
projeção mínima validada: id, nome, organização, atividade e membros com
`user_id/is_leader`. A revisão não é inventada nem tornada opcional na gestão.
`useTeams()` e as mutações continuam exigindo o contrato completo e CAS.
Foram migrados SharedFilters, useSharedFilters, useUserAccessScope e o filtro
de equipes da Agenda. Formulários e editores de equipes foram preservados.

O catálogo tem cache por organização, usuário, sessão e includeInactive, com
identidade esperada e AbortSignal no transporte. A atualização de gestão não
injeta seu DTO completo nesse cache; a invalidação continua alcançando ambas
as leituras. Isso também evita reutilizar o erro da antiga query de gestão.

O confronto pós-correção aceitou as três equipes visíveis ao administrador e a
equipe visível ao líder, tanto pelo schema mínimo quanto pela função real
`teamsAPI.catalog`, usando apenas substituição do transporte em memória. A
gestão continuou rejeitando esses DTOs sem revisão, como esperado. O usuário
padrão recebeu 403 na consulta direta de equipes, conforme sua permissão; o
hook de filtros não solicita esse catálogo para esse perfil.

### Ajustes visuais e seleção restaurada

- Buscar: laranja 50% e texto branco; hover/active em 100%.
- Campos ativos da lateral: texto e ícones brancos sobre o laranja existente.
- Intervalo no calendário: extremos/dia único em 100%, interiores em 50%,
  números brancos. O TD interior fica transparente para não acumular 15% sob
  os 50% do botão. A regra é local ao DateFilterPopover.
- Somente Limpar período e Aplicar: 12 px/peso 300. A ação única usa o handler
  já existente para limpar rascunho e critério aplicado; a ação duplicada foi
  removida, inclusive do DOM. O modo sem calendário conserva um único reset.
- Um líder com equipe indisponível restaurada não recebe mais os corretores
  dessa equipe na lista: availableUsers consulta availableTeams. O estado é
  preservado como indisponível, sem ampliar autorização ou apagar a seleção.

### Evidências e limites

A matriz visual de três perfis em 390/1024 passou em 15/15 casos após o ajuste
de equipe indisponível. O calendário passou em 29/29 testes visuais/comportamentais
e 30/30 compartilhados, cobrindo temas claro/escuro e 320/390/1024/1440. As
suítes de domínio e contratos executadas separadamente passaram em 84 casos.
No backend, 177 testes principais em 14 pacotes e 632 cenários sintéticos
adicionais de filtros/escopo passaram; estes últimos usam builders reais e
duas organizações, sem conexão PostgreSQL. Não somar pais/subtestes ou rodadas
repetidas como novos casos.

Os GETs reais cobriram cada critério do conjunto compartilhado em Contatos,
Dashboard, Pipeline, Conversas e Marketing quando permitido. Usaram valores
existentes dos catálogos; as respostas e dados pessoais não foram persistidos.
Os bloqueios 403 de Marketing para líder/usuário foram esperados. As consultas
reais e a UI com transporte isolado são evidências distintas; esta rodada não
comprova todos os cliques no navegador autenticado do usuário, Safari/Mac ou
aparelho físico. O aviso não foi ocultado nem convertido em catálogo vazio.

Também foram validadas 24 respostas reais dos oito domínios pelos parsers
exatos do frontend: catálogos de pipelines, Contatos, quadro Pipeline, Dashboard,
Conversas, catálogo de Conversas, Marketing e vínculos equipe/pipeline. As 21
respostas permitidas passaram; as três restantes foram os 403 esperados de
Marketing (líder/usuário) e vínculos de equipe (usuário). O catálogo mínimo de
equipes foi confrontado separadamente com a resposta real, preservando a
rejeição do contrato de gestão sem revisão. Isso não substitui a matriz de
GETs por critério nem a prova visual; são verificações adicionais de contrato.

Regressões novas do catálogo de equipes: 20/20 passaram, incluindo reprodução
anterior vermelha do hook compartilhado para administrador/líder, painel real,
escopo do líder, DTO antigo/atual, organização incorreta, UID/SID, abort, 403,
retry limitado e projeção dos dois caches após atualização de gestão. O gate
de transporte também passou (um pai e oito subcasos, incluindo os dois de tags
que antes não inicializavam por dependência ausente no harness). O reparo do
harness carrega os schemas reais, sem remover assertivas.

`npm run typecheck` final passou. O lint global desta manhã passou com sete
avisos externos; o lint final dos arquivos alterados também passou após a
correção de nomes de variáveis locais nos helpers de teste, sem supressões.
A falha de contraste solicitada pelo desenho continua registrada abaixo e não
foi convertida artificialmente em teste verde. Produto permaneceu congelado
durante os gates finais; os manifests em TEMP registram hashes e baselines.

Pontos encontrados que permanecem fora do ajuste visual/catálogo:

| Prioridade | Constatação | Limite e encaminhamento |
|---|---|---|
| P2 | Marketing/Meta usam o ramo sem verificação de sessão ativa. | Canário local com sessão revogada chegou ao handler em seis requisições, sem chamar o checker; não houve consulta SQL/payload real. Requer correção/revisão do backend. |
| P2 | `userId=unassigned` em campaign-insights retorna 400 na API publicada. | O checkout aceita e testa o caso; há divergência de contrato com a API publicada. Nenhum deploy foi realizado para reconciliá-la. |
| P3 | Dashboard de campanhas anuncia a busca global como aplicada, embora seu contrato não a envie. | Cadeia estática e probe do hook real; definir apresentação/semântica antes de mudar o relatório. |
| P3 | MetaInsights transforma data inválida em HTTP 500. | Canário local interrompeu antes do SQL; mapear entrada inválida para 400 no backend. |
| P3 | Texto branco em laranja 50% não atinge contraste AA no tema claro. | Axe confirmou 2,04:1 em Buscar; o teste original foi preservado e a aparência explicitamente pedida foi mantida. |

Evidências principais desta rodada:
`C:\Users\andre\AppData\Local\Temp\vimob-filter-role-review-20261017-101709`;
domínios: `vimob-general-filter-audit-20261017-101654`;
backend: `vimob-filter-role-validation-20261017-015d2395` (ambos em TEMP).
Os manifests e logs identificam os arquivos incrementais; a árvore principal
contém muitas alterações preexistentes de outras auditorias. Reversão somente
por hunks desta etapa, preservando esses trabalhos e o catálogo de tags.

## Correções pontuais de Marketing/Meta e nova rodada real (17/10, fim da manhã)

Autorização: continuar os P2/P3 de Marketing/Meta no checkout principal, sem
deploy e preservando as auditorias paralelas. Esta seção atualiza a situação
dos quatro pontos de Marketing/Meta da tabela anterior; não representa uma
mudança na API publicada nem o fechamento do contraste visual solicitado.

### Código corrigido no checkout principal

- As duas rotas de leitura `analytics/meta-insights` e
  `analytics/campaign-insights` usam `withActiveModulePermission`. A sessão
  ativa é verificada antes do tenant, da permissão e da validação dos filtros;
  os controles de módulo e permissão continuam em vigor. Sessão revogada não
  pode alcançar o handler com um JWT ainda dentro da validade.
- `MetaInsights` converte `ErrInvalidInput` em HTTP 400 com o código
  `invalid_analytics_filters`. A mudança é específica desse handler;
  `writeRows` e os demais relatórios foram preservados.
- Meta projeta a busca compartilhada como vazia apenas para sua apresentação
  e relatório, calcula o estado ativo pelos critérios suportados e oferece a
  opção existente `Sem responsável`. A busca global não é apagada ao entrar
  na página: continua disponível em Contatos e nos outros consumidores que
  a aplicam. Marketing já fazia essa projeção; seu componente foi preservado.
- O valor exato `userId=unassigned` já era aceito no checkout e segue intacto
  até o SQL, onde seleciona `assigned_user_id is null`. Valores como
  `%20unassigned%20` agora são rejeitados com 400 antes do SQL: o validator
  anterior removia os espaços apenas para validar, mas o bind recebia a
  entrada original, que não correspondia ao literal especial. Não foi criado
  fallback que remova silenciosamente o critério nem retorno vazio artificial.

São quatro arquivos de produto nesta etapa: `routes.go`, `handler.go`,
`validation.go` e `MetaCampaignsDashboardScreen.tsx`. SQL, dependências,
calendário, estilos, SharedFilters e MarketingScreen não foram editados por
esta etapa. O monitoramento de hashes detectou uma alteração concorrente no
DateFilterPopover; ela foi preservada, sem atribuí-la a esta correção.

### Testes locais do backend

Os testes de regressão reproduziram os problemas antes dos patches. Depois,
18/18 testes principais passaram, incluindo 178 novos cenários HTTP de folha
nas duas rotas: GET/HEAD, administrador/líder/usuário sintéticos, duas
organizações, sessão revogada/ausente/de outro ator, recovery, consulta de
sessão indisponível, visitante, permissões/módulos e datas inválidas. Não
somar os 350 eventos de pais/subtestes como 350 testes independentes. O teste
de normalização também conserva o caso exato `unassigned` válido.

Os ensaios usam o mux e a verificação de JWT reais, com consultas de sessão e
tenant sintéticas; os filtros inválidos param antes de PostgreSQL. O build
completo da API Go passou. Isso comprova o código local e não substitui a
execução do backend corrigido contra o banco real.

### Reteste com os três perfis e os dados reais da Vetter Co.

Foram abertas novas sessões temporárias de contas existentes, confirmando
organização, papel e liderança por `/v1/me`, sem superadministrador. Os testes
fizeram somente GETs na API publicada; não houve mudança de senha, papel,
equipe, lead, integração ou configuração remota. Todas as três sessões foram
encerradas individualmente. Tokens, senhas e payloads pessoais não foram
gravados nos relatórios.

| Perfil real | GETs em Marketing/Meta | Comportamento esperado confirmado | Divergências conhecidas na API publicada |
|---|---:|---:|---:|
| Administrador | 29 | 24 | 5 |
| Líder | 29 | 27 | 2 |
| Usuário padrão | 29 | 27 | 2 |

Total: 87 GETs nas duas rotas. As 21 respostas HTTP 200 passaram pelos schemas
exatos do frontend. Os 54 bloqueios de permissão dos perfis sem
`dashboard_campaigns_view` foram esperados; não se concedeu permissão para
forçar um resultado. Outros três casos de entrada inválida retornaram o 400
esperado. A matriz cobriu pipeline, equipe, responsável, origem, tag, página,
campanha(s), conjunto, anúncio, status, período e combinações. Conta de
anúncios e objetivo ficaram explicitamente sem verificação por não haver
valor disponível no catálogo real dessa organização.

Os GETs verificam aceitação dos critérios, autorização e contrato da resposta;
sozinhos, não comprovam a exatidão de todos os números agregados do relatório.
A prova de UI, os testes sintéticos do backend e essas consultas reais são
evidências complementares, com limites diferentes.

As nove divergências foram: dois 400 de `Sem responsável` para o
administrador, um 500 de data inválida em Meta e seis chamadas com sessões
já encerradas que ainda alcançaram permissão/handler em vez de retornar 401.
Nas chamadas após encerramento, uma data inválida impediu consulta SQL pelo
handler antigo. Esses resultados demonstram a diferença entre o código local
e o serviço publicado; não são falhas ocultadas ou testes aprovados.

O endereço privado PostgreSQL e o acesso SSH existente expiraram por tempo
limite nesta máquina. Assim, a API Go corrigida não foi conectada ao banco
real e nenhum serviço/túnel novo foi deixado em execução. A prévia de rede na
porta 3000 continua usando a API publicada, sem reinício e sem troca de
backend. A opção `Sem responsável` em Marketing/Meta depende da API com o
contrato corrigido: a prévia que usa o serviço antigo ainda pode retornar o
400 já documentado. A homologação ponta a ponta da API corrigida com dados
reais permanece pendente de conectividade, sem exigir deploy nesta etapa.

Evidências novas: TEMP `vimob-marketing-meta-fix-20261017-110223`
(`vetter-marketing-real-results.json`, manifesto de preservação e build);
`vimob-marketing-session-fix-20261017-44220d3b` (baseline, RED/GREEN e plano
exato dos testes Go).

### Regressão visual e comportamental do frontend

O novo ensaio isolado passou em nove regressões atuais: Meta em 390/1024,
contagem/chips/ação de limpar coerentes, busca global conservada ao voltar ao
consumidor geral, Sem responsável herdado e selecionável no controle real,
transporte do literal exato e cinco abas de Marketing sem busca anunciada.
São usados os componentes, hooks, API e schemas do checkout, com transporte,
identidades e folhas de gráficos sintéticos; zero chamadas externas e zero
erros do navegador. Não são cliques autenticados na conta real do usuário.

A reprodução anterior no mesmo bundle mostrou o chip e o contador de uma
busca sem suporte: a assertiva esperada de zero falhou explicitamente. Essa
prova adicional explica o décimo caso aprovado no log; não é uma décima
regressão do produto atual. Uma primeira tentativa expirou durante o setup
e está registrada como falha de infraestrutura, sem contá-la como RED
comportamental. Evidências: TEMP
`vimob-meta-applied-search-fix-20261017-124000/runtime-green.log`.

Na revisão independente, o isolamento de contexto/cache passou em 7/7 e os
contratos do frontend em 14/14. Nenhum novo problema foi confirmado no fluxo
normal de Marketing/Meta dentro desse escopo. `npm run typecheck` passou.

O primeiro lint global foi inconclusivo: Node/V8 encerrou com exit 134 e
`Zone Allocation failed - process out of memory`, antes de emitir um relatório
de regras. O lint duplicado dos quatro arquivos foi interrompido de forma
coordenada, somente no processo desta etapa, para permitir uma única repetição
global com heap de 1024 MiB. Nenhuma configuração, regra ou dependência foi
alterada para obter aprovação. O resultado dessa repetição é registrado abaixo.

Reexecução do novo ensaio de frontend, no checkout, com Chromium do Playwright
disponível: `node --test scripts/tests/meta-applied-search-runtime.test.mjs`.
Sem a variável opcional que aponta para o baseline capturado, esse comando
executa as nove regressões atuais e não depende dos arquivos TEMP desta máquina.
Os testes Go novos são descobertos pelo gate existente de `go test` dos
pacotes da API; o workflow não foi editado nesta etapa.

O lint global serial terminou com exit 0, sem erros ou avisos, usando
`node --max-old-space-size=1024 ./node_modules/eslint/bin/eslint.js`, sem cache.
Logs de ambos os gates e da tentativa OOM foram preservados em TEMP
`vimob-campaign-insights-review-20261017`. Não foram encerrados processos das
outras auditorias. A conferência final manteve os hashes dos arquivos
corrigidos e o HEAD principal `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
Sem commit, push, deploy ou migração; o reteste do backend corrigido ligado ao
banco real continua com o limite de conectividade descrito acima.

## WhatsApp: retirar controles locais e conservar filtros entre páginas (17/10, tarde)

Pedido: remover do painel avançado do WhatsApp a busca de opções de filtro e
o bloco Última mensagem/Período, mantendo os filtros interligados entre
Contatos, Dashboard, Pipeline e Conversas. Sem deploy, no checkout principal.

`ConversationFilters` não renderiza mais esses dois controles nem recebe suas
props. `ConversationsScreen` também não guarda os estados, debounce, intervalo
de última mensagem, parâmetros de consulta, contadores ou chave de posição
associados. Isso evita conservar uma restrição local sem controle visível.
O suporte genérico desses parâmetros no transporte/backend não foi alterado.

A busca principal de conversas e o período Criação do lead foram preservados.
Carregar mais opções continua disponível quando o catálogo tem outra página;
a retirada da busca de catálogo não limita o acesso às opções já paginadas.

A revisão dirigida confirmou um `FilterProvider` no layout protegido e os
mesmos critérios compartilhados nos quatro consumidores: pipeline, equipe,
responsável, origem, página, campanhas, conjunto, anúncio, tags, situação,
busca e período. Contatos, Dashboard e Pipeline leem o contexto pelo hook
compartilhado; Conversas o lê diretamente e transforma a data global em
`leadCreatedFrom/To`. A busca principal continua usando `searchQuery`, enviada
como `search` no WhatsApp. A busca removida era exclusivamente `optionsSearch`
do catálogo. Nenhuma alteração foi feita no provider ou no contexto global.

Essa ligação vale na navegação da mesma aba/organização. Não se introduziu
sincronização entre navegadores ou usuários. Arquivadas, Sem resposta e conta
do WhatsApp continuam específicos de Conversas. O modo Sem lead continua
pausando critérios de lead sem apagar o estado compartilhado, com seu aviso
existente; a seleção permanece disponível ao retornar a outra página.

A alteração de produto ficou em dois arquivos do WhatsApp. SharedFilters,
estilos da lateral, calendário e tela Meta conservaram os hashes do início
desta etapa. Os testes existentes foram adaptados à remoção dos controles;
não foi criada nova suíte nem alterado o backend, permissões, dados ou serviços.
Baselines e evidências em TEMP `vimob-whatsapp-filter-remove-20261017-150706`.

Validação isolada, sem rede ou contas reais nesta etapa: rollout da lateral
19/19; fechamento visual WhatsApp 9/9; suíte compartilhada de filtros 29/30.
As provas WhatsApp cobriram ausência dos controles, busca principal/período
no contexto real, seleção de corretor, paginação e resize, incluindo mobile e
desktop. O contexto real e o helper de Conversas conservaram a hierarquia de
pipeline/equipe/responsável/campanhas/anúncios/tags/situação e a pausa Sem lead.
A conferência das quatro telas completas foi estática, complementando esses
runtimes; não se afirma navegação autenticada de quatro telas reais nesta rodada.

A única falha dos 58 casos foi a expectativa da Agenda em
`filter-ui-runtime/period-and-panel-cases.mjs:38`: procura o nome acessível
`Período da agenda: 01 dez 2025`, enquanto o componente atual gera
`Período da agenda: 01/12/2025 - 15/01/2026`. A fixture Agenda e essa assertiva
conservaram o conteúdo do baseline. A prova do mês selecionado, na linha
seguinte, não chegou a executar. Trata-se de incompatibilidade de localizador
com o formato atual, sem evidência nesta execução de regressão do calendário;
Agenda e sua expectativa não foram alteradas para fazer a suíte passar.
Essa falha permanece registrada, separadamente dos 57 casos aprovados.

Para uma reversão local, recuperar apenas os hunks desta remoção nas duas
fontes e seus testes correspondentes, usando os baselines/patches desta etapa.
Não restaurar arquivos inteiros sobre alterações posteriores de outras
auditorias. Não há mudança de banco ou estado global persistido a desfazer.

Gates finais desta etapa: `npm run typecheck` com heap de 2048 MiB terminou
com exit 0; depois, `npm run lint` com heap de 1024 MiB terminou com exit 0,
zero erros e sete avisos fora dos arquivos alterados. As configurações de heap
valeram apenas para os respectivos shells; configuração e regras do projeto
permaneceram iguais. Não houve cache, repetição de testes após aprovação ou
encerramento de processo de outra auditoria.

Os avisos estão em `scripts/supabase/queue-browser-cleanup.test.mjs` (três),
`scripts/supabase/queue-postgres-races.mjs` (um),
`supabase/functions/_shared/property-inventory-eligibility.test.ts` (um) e
`supabase/functions/ai-agent-responder/public-property-catalog.test.ts` (dois).
Foram preservados em vez de ampliar o ajuste para esses arquivos.

Comandos dos runtimes: `node --test scripts/tests/shared-filter-sidebar-rollout-runtime.test.mjs`,
`node --test scripts/tests/filter-ui-runtime.test.mjs` e
`node --test components/features/whatsapp/conversations/visual-closure.runtime.test.mjs`.
Logs, patches e manifesto dos seis arquivos de testes estão em TEMP
`vimob-wa-filter-removal-domain-20261017`; os gates e hashes finais estão em
`vimob-whatsapp-filter-gates-20261017-151339-f7977a97`.
As duas fontes de produto mantiveram os hashes após os testes; SharedFilters,
calendário e Meta também conservaram os hashes capturados para esta etapa.
Nenhuma alteração de banco, autenticação, permissão, serviço ou deploy.

## Agenda e filtros compartilhados: reteste de 18/10

Pedido autorizado: corrigir a falha da Agenda registrada em 17/10 e testar
novamente a ligação dos filtros entre Contatos, Dashboard, Pipeline e
Conversas, no checkout principal, sem deploy e preservando as outras auditorias.

### Correção da falha registrada

A mudança de código desta etapa é uma linha em
`scripts/tests/filter-ui-runtime/period-and-panel-cases.mjs:38`. O localizador
antigo esperava `01 dez 2025`; passou a exigir o nome acessível completo
`Período da agenda: 01/12/2025 - 15/01/2026`, com `exact: true`. Isso confere os
dois extremos do intervalo e o componente certo, em vez de flexibilizar a
assertiva. A verificação de que o calendário abre em `dezembro 2025` e as
larguras 390/1024 foram mantidas. Não foi necessário mudar a interface ou as
regras civis da Agenda, nem o DateFilterPopover compartilhado.

A suíte completa `node --test scripts/tests/filter-ui-runtime.test.mjs`
passou em 30/30, sem falhas ou skips. O caso da Agenda agora executa e aprova
também a assertiva do mês, que antes não era alcançada. O histórico de 29/30
da seção anterior permanece como evidência da execução anterior, não como
pendência atual desse localizador.

### Ligação dos quatro consumidores

Os quatro consumidores continuam sob o mesmo FilterProvider do layout
protegido. A revisão dirigida conferiu a leitura do estado e a tradução para
os parâmetros usados por cada domínio:

| Tela | Tradução verificada |
|---|---|
| Contatos | Período em `createdFrom/To`, responsável em `assigneeId/unassigned`, busca em `search`, campanhas múltiplas e demais critérios. |
| Dashboard | Mesmo contexto em `dateFrom/To`, `userId`, `searchQuery`, `campaignIds`, tags e atribuição. |
| Pipeline | Estado compartilhado no quadro, busca e período, filtros de equipe/responsável/origem e campanhas múltiplas. A pipeline padrão local não sobrescreve a seleção global de todas as pipelines. |
| Conversas | Busca principal compartilhada; período de criação do lead em `leadCreatedFrom/To`. Sem lead pausa critérios de lead sem apagá-los; conta, Arquivadas e Sem resposta continuam locais. |

Além dos 30 casos acima, passaram `filter-state-concurrency-runtime.test.mjs`
em 7/7 e `shared-filter-sidebar-rollout-runtime.test.mjs` em 19/19, executados
serialmente. Os ensaios verificaram providers/contexto reais, persistência e
hidratação, A→B→A entre organizações, troca de usuário, mudança de papel e
permissões, aplicação atômica, limpeza e isolamento, busca/período comuns,
seletores, sidebar e paginação no mobile/desktop. O browser não acessou
servidores externos nem apresentou exceções nessas suítes.

A revisão complementar executou 46 casos funcionais de filtros, mapeamentos,
contratos e cache, todos aprovados, e quatro casos auxiliares de sessão também
aprovados. Os testes usam os helpers/builders/API locais com transporte e
identidade sintéticos. A ligação dos quatro componentes completos foi
conferida por código; não foi executada navegação autenticada pelas quatro
telas com dados reais nesta rodada. Isso não representa certificação de
produção, Safari/Mac, aparelho físico ou autorização remota.

### Falhas auxiliares preservadas

Três testes adicionais falharam e não foram alterados nesta correção:

- `lib/contacts-session-safety.runtime.test.mjs:65`: o harness extrai `useLead`,
  mas não injeta os helpers atuais de leitura consistente. O ReferenceError
  impede exercitar a negativa HTTP esperada; o teste não certificou esse fluxo.
- `lib/contacts-session-safety.runtime.test.mjs:95`: falta injetar o helper
  atual `captureCurrentLeadRequestIntent`; a execução para antes do transporte.
- `components/features/contacts/contacts-screen/model.test.ts:213`: uma regex
  de classes espera o padding antigo, enquanto a toolbar atual usa padding
  responsivo. É uma expectativa de texto da fonte, não uma prova de layout.

O conjunto auxiliar teve 50/53 aprovados: 46 funcionais de filtros e quatro
auxiliares de sessão. Não somar essas falhas aos casos já aprovados nem
apresentar o conjunto inteiro como verde. Os dois fluxos de segurança que
pararam nos harnesses continuam sem certificação por esses testes. Nenhuma
regra de autorização, fonte de produto, teste externo ou classe da toolbar
foi alterada para eliminar esses resultados.

Baselines e logs principais: TEMP
`vimob-agenda-shared-review-20261018-161441`. O relatório complementar, os
comandos exatos, as falhas e o manifesto de leitura estão em
`vimob-shared-filter-readonly-20261018/coverage-summary.json`. O código de
produto, o contexto global, os quatro consumidores, o calendário e as
dependências conservaram os hashes capturados no início desta etapa.

Reversão: desfazer apenas a linha do localizador e os hunks documentais desta
rodada, sem restaurar arquivos inteiros sobre outras auditorias. Não existe
alteração de banco ou estado persistido para reverter. Sem commit, push,
migração, início/reinício de serviço ou deploy.

### Checks finais desta rodada

`npm.cmd run typecheck` terminou com exit 0. `npm.cmd run lint` também
terminou com exit 0: zero erros e sete avisos de variáveis não usadas em
arquivos de scripts Supabase e testes de catálogo, fora da alteração desta
rodada. Nenhuma regra foi desativada para obter esses resultados.

Os checks foram executados em sequência, com limites de heap somente nos
respectivos processos locais, sem mudar configuração ou cache e sem encerrar
processos de outras auditorias. A confirmação de exit, os logs e os hashes
estão em TEMP `vimob-agenda-locator-gates-20261018-161643-5001bb14/results.json`.
Esses checks globais aprovados não eliminam as três falhas auxiliares
documentadas acima, nem substituem a navegação autenticada com dados reais.

## Contatos: correção dos três testes e rodada real de 18/10

Escopo autorizado nesta rodada: corrigir os três testes auxiliares descritos
na seção anterior e repetir a validação de filtros com os perfis existentes
de administrador, líder e usuário padrão da Vetter Co., no checkout principal,
sem deploy e preservando as demais auditorias.

### Correção dos testes

- `lib/contacts-session-safety.runtime.test.mjs`: injeta os helpers reais de
  leitura consistente/cache usados atualmente pelo hook. A rejeição agora deve
  ser o mesmo erro HTTP 403/404/500 lançado pelo transporte, com uma chamada
  na organização e AbortSignal esperados. Um ReferenceError não passa nessa
  verificação; um canário temporário confirmou essa negativa. 403/404 limpam o
  snapshot, enquanto 500 o preserva. O teste de PATCH/DELETE executa o helper
  real de captura de identidade e verifica a identidade congelada da requisição
  mesmo após troca de ator/sessão no ambiente sintético. Nenhuma escrita real
  é feita por esses testes.
- `components/features/contacts/contacts-screen/model.test.ts`: atualiza o
  espaçamento responsivo esperado e verifica o caminho atual do botão: configuração
  sem override em Contatos, Toolbar → SharedFilters → FILTER_UI.trigger →
  Button → SharedFilterPanel. O fundo compartilhado continua exigido, assim
  como as verificações anteriores de scroll, paginação, cabeçalho e ações.
  O teste estático não equivale a uma prova visual de tela completa.

Os REDs reproduziram duas falhas de sessão e uma falha de layout. Dentro do
mesmo caso de layout, corrigir a primeira expectativa revelou a segunda
expectativa antiga do estilo; ambas foram atualizadas, preservando a cobertura.
Resultado final: 6/6 no arquivo de sessão e 7/7 no modelo, sem skips.

Comandos:

```text
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/contacts-session-safety.runtime.test.mjs
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test components/features/contacts/contacts-screen/model.test.ts
node --test scripts/tests/filter-role-matrix-runtime.test.mjs
node --test scripts/tests/filter-state-concurrency-runtime.test.mjs
```

A matriz de interface passou em 15/15 com os três perfis sintéticos nas
larguras 390/1024, incluindo seleção, cascatas, busca adiada, período, limpeza
e opções restritas. A suíte de estado passou em 7/7 com providers reais,
persistência, troca de organização/ator e isolamento. São provas locais,
separadas da rodada de consultas com identidades e dados reais.

Evidências locais em TEMP: `vimob-contacts-real-retest-20261018-163732`
(runtimes e manifesto), `vimob-contacts-session-test-20261018-027b2fac`
(RED/GREEN e canário) e `vimob-contacts-model-assert-20261018-163810-50979ee6`
(RED/GREEN e diff do modelo). Os dois testes receberam revisão independente.

`npm run typecheck` e `npm run lint` terminaram com exit 0, uma execução de
cada em sequência. Lint: zero erros e sete avisos nos mesmos arquivos externos
documentados anteriormente. Os limites de heap foram aplicados somente aos
processos dos checks e restaurados ao terminar; não houve `--fix`, cache novo,
supressões ou mudança de configuração. Resultados e hashes finais desses
checks: `vimob-contacts-session-test-20261018-027b2fac/gates-final-summary.json`.

### Consultas com os três perfis e dados reais

As identidades existentes foram confirmadas novamente por `/v1/me`, exigindo
organização e usuário corretos, papel atual, liderança esperada e ausência de
superadministrador. A organização foi vinculada ao ID conhecido da Vetter Co.
Todas as consultas de negócio usaram JWT do respectivo usuário e o header de
organização; a credencial administrativa foi usada somente no fluxo Auth de
sessões temporárias. Não houve alteração de senha, papel, equipe, lead,
integração ou configuração. Nenhum token, senha ou payload pessoal foi salvo
nos relatórios. A sessão do Chrome em outra organização foi preservada.

Os parâmetros vieram dos builders atuais de Contatos, Dashboard, Pipeline e
Conversas. O adaptador de Dashboard foi executado com transporte bloqueado em
memória para capturar a query; somente depois ela foi enviada à API publicada.
Arrays foram serializados por parâmetros repetidos, como em `buildAPIURL` do
cliente real. O período de Pipeline usa `dateMode=origin`, como a tela atual.
Limite das sondas Meta: o caso `campaign_single` enviou somente o array novo.
A UI de Contatos/Pipeline envia também o singular legado quando há uma única
campanha; esse fallback não foi incluído nessa sonda. Portanto, ela não prova
falha de uma seleção única na UI. Com duas ou mais campanhas, o contexto
define o singular como null, e a sonda OR2 corresponde ao formato usado na UI
(`FilterContext.tsx:379`, `ContactsScreen.tsx:205`, `PipelinesScreen.tsx:555`).

| Perfil real | Consultas de filtros/catálogos | HTTP 200 + schema aceito | Bloqueio esperado |
|---|---:|---:|---:|
| Administrador | 87 | 87 | 0 |
| Líder | 70 | 70 | 0 |
| Usuário padrão | 66 | 65 | 1: catálogo de equipes, HTTP 403 |

A matriz principal teve 223 GETs, sem status inesperado, falha de schema ou
erro de construção do cliente. Isso NÃO significa que todos os critérios
tenham sido aplicados corretamente: o controle semântico abaixo encontrou
uma divergência apesar dos HTTP 200. As 12 consultas iniciais das quatro
rotas nos três perfis passaram pelos schemas. Totais iniciais:

| Domínio | Administrador | Líder | Padrão |
|---|---:|---:|---:|
| Contatos | 128 | 5 | 1 |
| Dashboard | 128 | 5 | 1 |
| Pipeline padrão | 126 | 5 | 1 |
| Conversas: linhas da primeira página | 4 | 0 | 0 |

Pipeline exige um quadro selecionado; seu total não representa todas as
pipelines. Conversas conta outra população e não deve ser comparada como se
fosse o total de leads. As consultas reutilizaram os mesmos critérios nas
quatro traduções, incluindo pipeline, equipe, responsável, Sem responsável,
origem, tags em OR, status, período, página, campanha(s), conjunto, anúncio,
busca textual, combinação e limpeza, conforme os valores acessíveis de cada
perfil. Houve ainda página 2 de Contatos para administrador.

Não foram inventados valores para completar a matriz: campanhas/conjuntos/
anúncios não estavam disponíveis para líder e padrão; equipe não estava
disponível para padrão. A busca por telefone com máscara ficou sem amostra
disponível nos três perfis. Não havia cursor seguinte em Conversas nem dados
suficientes para página 2 de Contatos nos dois perfis restritos. Zero linhas,
atribuição histórica não projetada e métricas agregadas ficaram explicitamente
inconclusivos quanto à exatidão semântica; não são aprovações por vacuidade.

### Pendências reais encontradas: não considerar homologação integral

**P2 confirmado, múltiplas campanhas na UI/API publicada:** `campaignIds` em
Contatos e `filterCampaigns` em Pipeline não restringiram os resultados, mesmo
com somente um ID no protocolo novo. O impacto confirmado na UI é para duas
ou mais campanhas. Um controle adicional com a mesma identidade, rota e
campanha confirmou que o parâmetro singular legado funciona:

| Domínio | Sem campanha | Array com A | Singular A | Array A+B | União completa dos singulares A e B |
|---|---:|---:|---:|---:|---:|
| Contatos | 128 | 128 | 1 | 128 | 2 |
| Pipeline padrão | 126 | 126 | 1 | 126 | 1 |

As páginas dos arrays também coincidiram com a página sem filtro por igualdade
dos conjuntos de IDs, guardando somente os booleanos da comparação. O
controle teve mais 12 GETs, todos HTTP 200 e schema aceito, numa quarta sessão
temporária de administrador. Isso comprova por que sucesso HTTP/schema não
basta para dizer que o filtro foi aplicado. Não é uma comparação entre
denominadores de domínios distintos.

**P2 para investigação, encerramento de sessão na API publicada:** as quatro
saídas individuais `signOut({scope:'local'})` retornaram sucesso pelo SDK,
mas os JWTs antigos ainda obtiveram HTTP 200 em `/v1/me` logo após a saída.
Portanto, a revogação efetiva na API não foi certificada. O fato observado é
limitado a essa rota e a esse instante: não foram medidos duração/cache nem
acesso a rotas de negócio depois da saída. Não houve loop de logout ou
revogação global das sessões do usuário. Os tokens ficaram só em memória e
não foram preservados ao encerrar os processos.

O probe separado de `/healthz` retornou HTTP 200 em 18/10 às 16:57:55, com
`X-Vimob-Release-Sha=7e490c7559b37d058395804b857173fc326e76d6`. O checkout
principal desta rodada permaneceu em `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
Essas identidades são diferentes; isso sozinho não prova a causa de cada
divergência. Não houve deploy para alinhar os ambientes, nem certificação da
API Go local ligada ao banco real. As pendências publicadas não foram
convertidas em alteração incidental de produto ou autorização nesta tarefa.

### Evidência, limites e preservação

Resultados reais e parâmetros usados, sem valores pessoais: TEMP
`vimob-vetter-four-domain-live-20261018-7c42ad91/results.json`, `run-real.log`,
`meta-discriminant.json`, `meta-discriminant.log` e `readonly-manifest.json`.
O probe de release está em
`vimob-contacts-real-retest-20261018-163732/published-release.json`.

As provas de UI/contexto são locais com identidades sintéticas; as consultas
autenticadas usaram os três perfis reais e os dados reais da API publicada.
Não houve navegação autenticada das quatro telas completas, certificação em
Safari/Mac/aparelho físico ou auditoria exaustiva P0–P6 nesta rodada. A ligação
de estado, os payloads e os resultados observáveis foram verificados por
evidências complementares; as limitações acima continuam abertas.

Alterações desta rodada: somente os dois arquivos de testes e esta seção
documental. Reversão seletiva pelos backups/hunks desta etapa, preservando as
alterações anteriores. Sem commit, push, migração, instalação de dependências,
início/reinício de serviços ou deploy. Os demais arquivos de produto e
configuração acompanhados conservaram seus hashes.
