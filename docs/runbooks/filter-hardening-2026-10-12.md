# Correções dos filtros do Vimob CRM

As correções desta revisão foram aplicadas em `D:\Vimob\workspaces\vimob-crm`, na branch `main`, preservando as alterações anteriores do checkout. O escopo inclui contratos de consulta, integração dos filtros gerais, seletores, busca, datas, paginação e acessibilidade. A estrutura das páginas foi preservada; a ligação de pipeline na Dashboard passou a usar o contexto geral.

Esta entrega é local. Este trabalho não fez commit, push, deploy, migration ou alteração em produção. As auditorias paralelas da Dashboard e do WhatsApp têm seus próprios documentos e alterações.

## Inventário dos grupos de filtros

| Superfície | Critérios e controles considerados | Escopo |
| --- | --- | --- |
| Filtros gerais do CRM | Período relativo ou personalizado, pipeline, equipe, responsável ou sem responsável, origem, página, campanhas, conjunto, anúncio, tags, negociação e busca | Estado por conta e organização; seleções explícitas compartilhadas entre telas consumidoras |
| Dashboard | Filtros gerais, pipeline e critérios próprios das métricas de entrada | Leads e métricas; os modos históricos da Dashboard conservam sua semântica |
| Pipeline | Filtros gerais e escolha do pipeline do board | Pipeline padrão continua local; seleção humana publica o critério geral |
| Contatos | Filtros gerais, pesquisa, lista, contagem e exportação | Consulta do servidor com critérios coerentes |
| Marketing e Meta | Período, origem, página, campanhas, conjunto, anúncio, equipe e responsável; pipeline na coorte CRM da Meta | Dados de mídia conservam seu escopo; pipeline não é atribuído artificialmente a gastos publicitários |
| WhatsApp principal | Filtros gerais do lead, conta, última mensagem, arquivadas, somente leads, sem lead e resposta pendente | Critérios antes da paginação; período do lead separado do período da mensagem |
| Chat flutuante | Filtros gerais, busca, conta, grupos e arquivadas | Lista e contador seguem o mesmo recorte autorizado |
| Carteira de imóveis | Busca, tipo, negócio, situação, localização, responsável, condomínio, valores e características | Validação numérica e localização por identidade |
| Escolha de imóvel | Busca, páginas e imóvel já vinculado | Consulta própria no servidor, independente das primeiras linhas carregadas pela página |
| Empreendimentos e unidades | Busca, estados e planta | Grade adaptável e critérios existentes no backend |
| Localizações e proprietários | Cidade, bairro, busca por nome e contatos conforme permissão | Relação cidade e bairro coerente; nomes e UF preservam identidade legada |
| Agenda | Equipe, usuário, origem, período e modo de visualização | Período exibido corresponde à consulta |
| Financeiro | Status, tipo, vencimento, contratos, comissões e DRE por mês, trimestre ou ano | Filtros próprios do domínio e valores pagos coerentes |
| Automações | Busca da automação e histórico por status, período e páginas | Filtragem no servidor antes do limite |
| Gestão CRM | Busca de equipes, filas e nomes | Seletores e listas existentes |
| Galeria | Busca de mídia | Consulta do servidor com paginação |
| Notificações | Categoria e somente não lidas | Filtragem antes de cursor e limite |
| Tabelas administrativas | Busca e páginas | Apenas tabelas permitidas, com autorização de SuperAdmin e redação preservada |

## Correções funcionais

As prioridades abaixo descrevem os achados dos filtros: P0 é risco crítico; P1 é bloqueio grave; P2 é resultado incorreto; P3 é uso, acessibilidade ou comportamento visual; P4 é manutenção; P5 é melhoria operacional; P6 é evolução que depende de medição ou novo modelo de dados. Os achados comprovados da primeira etapa se concentraram em P2 e P3; o fechamento complementar abaixo inclui o P1 encontrado na revisão posterior. Isso não equivale a uma certificação de ausência de P0 ou P1 em todo o CRM.

| Prioridade | Problema | Resultado local |
| --- | --- | --- |
| P2 | Mais de uma campanha se perdia nos consumidores que liam apenas `campaignId` | Arrays chegam ao board, Contatos, Marketing, Meta, contagens, exportação e cache; contrato singular antigo continua compatível |
| P2 | Meta descartava o responsável `unassigned` ou aceitava identificadores incompatíveis | Sem responsável é tratado como critério próprio; IDs, tamanhos, Unicode e NUL são validados |
| P2 | Pipeline da Dashboard estava isolado do contexto | Dashboard recebe seleção externa e filtros salvos; o board não publica seu padrão ao ser visitado |
| P2 | Campanha, conjunto, anúncio e página podiam combinar projeções históricas diferentes | Cada alternativa de atribuição é verificada como uma tupla coerente; fallback do primeiro toque funciona com conjunto e anúncio sem inventar página |
| P2 | `%`, `_` e barra invertida podiam mudar o significado da busca | Pesquisa literal e parametrizada, com normalização para nomes e contatos |
| P2 | Presets relativos ficavam no dia anterior depois da meia noite ou suspensão da aba | Relógio civil atualiza o contexto e os consumidores relativos; foco e visibilidade retomam o cálculo |
| P2 | Contatos truncava filtros aceitos no cliente ou aceitava datas incoerentes | Limites e intervalos são validados; critérios inválidos não são silenciosamente convertidos em outra consulta |
| P2 | Número inválido na carteira desaparecia do filtro | O campo informa erro e impede aplicação de valor inválido ou faixa invertida |
| P2 | Cidade e bairro por `LIKE` confundiam homônimos | IDs são usados na carteira; fallback legado compara nome e UF de forma exata |
| P2 | Trocar cidade mantinha bairro da cidade anterior | Seleção de bairro é limpa junto da alteração da cidade |
| P2 | Picker procurava apenas nos primeiros 50 ou 1.000 imóveis | Pesquisa paginada independente; CreateLead, Agenda, detalhe do lead e WhatsApp recuperam o imóvel escolhido por ID |
| P2 | Agenda consultava um intervalo e mostrava outro | Lista, navegação civil e consulta seguem o período selecionado, sem o corte arbitrário das primeiras dez linhas |
| P2 | DRE comparava períodos com dias faltantes | Mês anterior, trimestre e ano usam limites civis completos, incluindo fevereiro e ano bissexto |
| P2 | Pagamentos parciais eram excluídos ou contados como pagamento total | Caixa usa o valor pago disponível, limitado ao total; dado parcial ausente não é inventado |
| P2 | Histórico de automações filtrava depois das primeiras 50 a 200 execuções | Status e período entram na consulta antes da paginação |
| P2 | Favorito aplicado perdia filhos em efeitos assíncronos de cascata | Restauração atômica; mudança humana de equipe, página, campanha ou conjunto limpa os dependentes correspondentes |
| P2 | Link podia conservar anúncio depois de descartar o nome livre da campanha | Geração elimina filhos órfãos; abertura inicial e `hashchange` usam a mesma normalização |
| P3 | WhatsApp usava catálogos cortados em 300 ou 500 opções | Catálogo expandido com busca no servidor e carregamento de mais páginas; resposta antiga permanece compatível |
| P3 | Tags do WhatsApp apareciam com cor vermelha fixa | Cor real do catálogo é preservada, com fallback neutro |
| P3 | Limpeza do WhatsApp e do chat não removia a busca ou não a contava | Busca participa do contador e da limpeza; lista e contador incluem as novas dimensões no cache |
| P3 | Sem lead apagava ou aparentava aplicar critérios que exigiam lead | Critérios gerais ficam preservados e explicitamente pausados; favorito ou seleção positiva retomam o recorte do lead |
| P3 | Seleção desaparecia quando não estava nas opções carregadas | Seleção indisponível continua visível e removível; equipe indisponível produz erro de escopo, sem ampliar silenciosamente a consulta |
| P3 | Identificadores opacos podiam colidir ao mesclar opções com `:` | Identidade das tuplas usa serialização de arrays; homônimos continuam distintos por ID |
| P3 | Galeria, notificações e tabelas administrativas buscavam só nas linhas já carregadas | Critérios são enviados ao servidor antes do limite, com paginação |
| P3 | Proprietários não eram encontrados por acentos ou formatação do telefone | Busca normalizada conserva o guard de permissão de contatos e o caminho de índice existente |
| P3 | Comissões canceladas e lançamentos parciais eram difíceis de consultar | Estados pertinentes estão disponíveis nos filtros |

## Interface e uso dos filtros

`config/filter-ui.ts` concentra a densidade dos controles compartilhados: trigger de 32 px, controle de 36 px, texto de 11 ou 12 px e ícone de 14 px. Os seletores conservam a linguagem visual existente. A busca nos catálogos, os títulos acessíveis e os chips removíveis permitem identificar e limpar uma seleção mesmo quando sua opção não está disponível.

Os painéis respeitam a altura disponível e a largura da janela. O calendário apresenta ano no período personalizado, distingue limpar o rascunho de limpar o período aplicado e mantém saída por teclado. Os seletores usam IDs estáveis, mantêm a opção de limpar mesmo sem correspondências e preservam foco ao abrir controles internos. A grade dos empreendimentos deixa de forçar todas as colunas em janelas intermediárias; botões móveis da Agenda receberam nomes acessíveis.

A busca geral informa quando aplicar com Enter ou ao fechar o painel. Ela aceita até 180 caracteres Unicode; excesso não é truncado nem aplicado em silêncio. Campos de busca mais rápidos conservam debounce e o contrato próprio de cada domínio. Criar tags fica desabilitado nos seletores usados apenas para filtrar.

Os favoritos guardam até vinte conjuntos por conta e organização neste navegador. Salvar, carregar e excluir usam o mesmo schema e limite de armazenamento; conjuntos maiores que o limite produzem mensagem antes da gravação. A seleção da organização anterior não aparece durante a troca. Favoritos são locais ao dispositivo, sem sincronização entre navegadores.

O link de filtros inclui a organização e critérios por ID. Buscas por texto, nomes livres de campanhas e origens privadas não são colocados na URL. Um link de outra organização não é aplicado. O link não concede acesso: APIs continuam responsáveis por autorização e isolamento.

## Contrato do WhatsApp

A data geral enviada ao WhatsApp é a criação do lead. O filtro de última mensagem continua separado. Isso evita transformar um período do CRM em um recorte de atividade da conversa. A contagem de conversas não precisa igualar a contagem de leads ou entradas históricas da Dashboard, porque as unidades de contagem e as permissões das telas são diferentes.

Sem lead pausa pipeline, equipe, responsável, origem, atribuição, tags, negociação e criação do lead nessa visualização. Conta, última mensagem, arquivadas e resposta pendente continuam locais ao inbox; a busca geral permanece compartilhada. Sair desse modo recupera os critérios gerais, sem destruir a seleção das outras telas.

As chaves da lista, do contador e do catálogo incluem organização, usuário, escopo de acesso, contas e critérios pertinentes. Catálogos participam da invalidação geral do inbox. A seleção de mensagens, o vínculo do lead e os fluxos de envio e confirmação conservam os contratos da auditoria específica do WhatsApp.

## Evidências de validação

- TypeScript do projeto e lint geral passaram; os pacotes Go `whatsapp`, `admin`, `leads`, `analytics`, `searchtext`, `properties`, `financial` e `automations` passaram nos testes sem banco externo.
- Os testes focados de relógio, favoritos, links, catálogos, critérios compartilhados e cache passaram em quarenta casos; contratos adicionais de Contatos, Pipeline, Marketing e OpenAPI passaram em suas suítes. Essas contagens têm escopos distintos e não devem ser somadas como casos únicos.
- Quatorze testes em Chromium offline usaram React, Radix, CSS, `SharedFilters`, `ConversationFilters`, favoritos e `FilterContext` reais, com autenticação e dados sintéticos. Incluem teclado, foco, homônimos, critérios pausados, restauração atômica, duas organizações, favoritos maiores que 200 kB e virada do dia em São Paulo. Janelas de 360 × 480 e 768 × 480 foram verificadas para os painéis; a suíte não representa todas as páginas completas.
- No clone descartável local, leituras completas de Contatos, exportação, contagem, board e Meta/CampaignInsights executaram com organização sintética e conexão somente leitura. `EXPLAIN` validou os SQLs de catálogo WhatsApp, carteira por IDs e fallback, proprietários, histórico de automações e DRE. Casos sintéticos de atribuição WhatsApp confirmaram pares válidos, incompatíveis, OR de campanhas e página ausente.
- A integração completa do WhatsApp passou em 3,466 segundos, sem skips, incluindo catálogo de 601 campanhas, busca antes da paginação, permissões, mídia e retenção. Todas as páginas foram percorridas sem duplicação; conta privada sem concessão e período sem leads não expuseram opções. O teste preserva a autorização atual de proprietário ou responsável com concessão explícita e o histórico CRM autorizado. Foram corrigidas expectativas antigas e papéis inconsistentes da fixture, sem alterar a autorização da API. A limpeza confirmou zero organizações e usuários públicos ou Auth do namespace sintético. Essa duração descreve o teste local, sem representar latência de produção.
- Os inventários de superfícies e de dívida visual foram atualizados; `npm run audit:check` passou com quatro contratos. Seu gate verifica atualização e invariantes; não significa ausência de toda dívida visual fora dos filtros. `git diff --check` também passou.

## Limites e homologação

Safari no Mac, zoom real do sistema, páginas completas em todas as resoluções, comportamento em produção e carga de 5 a 6 mil usuários simultâneos continuam fora das provas desta entrega. `EXPLAIN` valida plano e esquema do clone, sem medir a latência de produção.

O financeiro tem um único `paid_date` por lançamento. A correção do valor parcial não reconstrói datas de vários pagamentos: esse histórico depende de um ledger de pagamentos e de uma decisão separada de modelo de dados. Favoritos sincronizados entre dispositivos, índices novos e métricas de uso dos filtros também exigem escopo e medição próprios.

Na homologação, conferir a navegação Dashboard → Pipeline → Contatos → WhatsApp com múltiplas campanhas, sem responsável e filtro salvo; trocar organização; testar vazio, falha de catálogo, limpeza e Sem lead. Conferir imóveis além da primeira página, fevereiro e dezembro no DRE, categorias antigas de notificações e histórico antigo de automações. Medir o catálogo com o volume da organização antes de uma publicação autorizada.

## Fechamento da revisão complementar — 12/10/2026

Esta etapa corrige os achados confirmados da última revisão dos filtros, após autorização do usuário. Foi realizada no checkout principal `D:\Vimob\workspaces\vimob-crm`, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. As alterações anteriores foram preservadas. Não houve commit, push, deploy, migrations, acesso a banco ou mudança em produção nesta etapa. As evidências com banco descritas acima pertencem à primeira etapa e não foram repetidas aqui.

| Prioridade | Achado confirmado | Correção complementar |
| --- | --- | --- |
| P1 | Imóveis e execuções de automações exibiam resultados da organização anterior durante a troca | Chaves e placeholders protegem organização e assinatura de acesso, incluindo usuário, papel, permissões, módulos, liderança, impersonação e políticas. O provider recria os observers ao trocar a assinatura, para que invalidações usem o cliente novo |
| P2 | Fechar os filtros Meta, sem campo de busca, limpava a pesquisa geral | O fechamento aplica a busca somente quando há um input montado; cobre também painéis que contêm apenas campos avançados |
| P2 | Equipe no Meta consultava a equipe da fila, divergindo do responsável atual | A coorte CRM usa vínculos atuais, ativos, da organização e generation correspondente. `EXISTS` evita duplicação. A equipe da fila permanece válida no recorte explícito de sem responsável |
| P2 | Período compartilhado longo provocava erro opaco em Marketing/Meta | As duas telas explicam o limite de 366 dias inclusivos antes da consulta. Refetch manual e sincronização também ficam protegidos; o período geral do CRM continua preservado |
| P2 | Cabeçalho do DRE recuava um dia em São Paulo | Datas civis são interpretadas com `parseISO`, conservando início e fim exibidos |
| P2 | Favoritos aceitavam Unicode e depois removiam página/campanha ao aplicar | Normalização e validação usam o mesmo schema por pontos de código, também na hidratação da sessão |
| P2 | Enter durante composição aplicava a busca antes da confirmação | `isComposing` e código 229 preservam o rascunho; Enter normal continua aplicando. O nome do favorito recebe a mesma proteção |
| P3 | Cache otimista removia cards válidos por equipe ou atribuição histórica ausente no DTO | O matcher distingue correspondência, incompatibilidade e informação desconhecida. Desconhecido preserva o snapshot, marca stale sem GET antecipado e aguarda a reconciliação coordenada após persistência |
| P3 | Tuplas de campanha/conjunto/anúncio com hífens colidiam no catálogo Go | Chaves JSON de tupla substituem a concatenação ambígua; os dois lookups dependentes no teste da Dashboard foram atualizados |
| P3 | Um link gerado com seleções válidas era rejeitado ao abrir | Gerador e leitor compartilham limite de 32.000 caracteres, cobrindo 50 campanhas de 255 caracteres e 50 tags. Excesso produz erro explícito antes da cópia |
| P3 | Seletores financeiros não tinham propósito acessível associado | Tipo, status, período, mês e regime têm nomes ou labels associados; teclado e foco foram verificados |
| P3 | Ocultar os campos do picker ocultava a indicação dos filtros ativos | Contador, aparência e nome acessível acompanham os critérios efetivos, independentemente da expansão dos campos |

Em P4, a cobertura passou a incluir regressões reproduzíveis para os casos acima, em vez de depender somente de contratos estáticos. Em P5, o texto existente foi conferido: favoritos pertencem à conta e organização neste navegador; filtros próprios do WhatsApp continuam identificados separadamente. Em P6, sincronizar favoritos entre dispositivos permanece uma evolução opcional de modelo de dados, sem implementação nesta correção. Nenhum P0 foi confirmado neste recorte.

### Evidência complementar e limites

- `scripts/tests/filter-ui-runtime.test.mjs`: 20/20 em Chromium offline. Inclui busca oculta, composição, Unicode, favoritos e sessão, link com capacidade máxima, 50 tags, calendário e seleções internas do WhatsApp. Painéis de período e filtros foram medidos em 21 combinações: larguras 320, 360, 390, 768, 1024, 1280 e 1440, com alturas 480, 600 e 900; as 42 medições passaram, inclusive largura interna do painel.
- `scripts/tests/tenant-placeholder-runtime.test.mjs`: 18/18 com provider, três hooks e FilterProvider reais. Dois tenants, A → B → A, saída com profile antigo, troca de usuário, papel/permissões, paginação no mesmo escopo e invalidação no cliente novo foram verificados. Antes da correção, o cliente B não tinha os três observers; depois, cache e refetch pertencem ao escopo B.
- `scripts/tests/filter-domain-ui-runtime.test.mjs`: 4/4 com telas reais e dados sintéticos. Financeiro em 320 e 1024 px, foco/teclado, DRE em São Paulo, indicador do picker e períodos de 366/367 dias nas duas telas de Marketing/Meta passaram. Período inválido não chama transporte, mesmo em refetch/sync, e reduzir o período recupera os indicadores.
- `components/features/leads/lead-detail/pipeline-cache-scope.runtime.test.mjs`: 5/5 com consumidor e QueryClient reais em memória. Nenhum GET ocorre antes da persistência; contagem, valor e posição permanecem intactos; outro board não recebe o card. Sucesso reconcilia pela resposta, falha restaura o snapshot. A fronteira de notificação é substituída por um equivalente do sinal de conclusão; o transporte Realtime real não foi testado.
- Os testes Node focados, incluindo links, cache, filtros, datas, Marketing, acessibilidade e contratos OpenAPI, passaram. As contagens dos conjuntos se sobrepõem e não devem ser somadas como casos únicos. Os oito pacotes Go `whatsapp`, `admin`, `leads`, `analytics`, `searchtext`, `properties`, `financial` e `automations` passaram; testes que exigem banco ficaram skipped por ausência de ambiente isolado nesta etapa.
- Gates finais desta etapa: `npm run typecheck`, `npm run lint`, `npm run audit:check` (4/4 contratos) e `git diff --check` dos arquivos alterados passaram. Os inventários de superfícies e dívida visual foram regenerados a partir do checkout atual, preservando também as contribuições anteriores das outras auditorias. O gate de inventário não certifica a ausência de dívida visual em todo o CRM.

A troca de organização ou de assinatura de acesso reinicia o estado transitório dentro do QueryProvider. Filtros de sessão foram restaurados por conta e organização nos testes; edição de filtros e paginação comuns não recriam esse provider. Quando faltam fatos no DTO do Pipeline, a atualização visual aguarda a resposta do servidor em vez de estimar a participação no recorte.

Estas provas usam autenticação e dados sintéticos; não representam navegação autenticada completa, Safari/Mac, zoom nativo, carga ou produção. O SQL da equipe Meta foi conferido pelos contratos Go, sem nova execução contra PostgreSQL. Achados próprios das auditorias da Dashboard e do WhatsApp continuam nos recortes desses trabalhos; esta seção não certifica todo o CRM.

Para reversão local, reaplicar somente o inverso dos diffs incrementais desta etapa, conferindo alterações posteriores antes. Os baselines estão em `D:\Vimob\tmp\filter-close-20261012-5086a7b7`, `D:\Vimob\tmp\filter-audit-fixes-baseline\core\tenant-placeholder-20261012-current`, `D:\Vimob\tmp\filter-audit-fixes-baseline\final-ui` e `D:\Vimob\tmp\filter-audit-confirmed-fixes-baseline\domain`. Não restaurar arquivos inteiros nem o checkout, pois contêm trabalho de outras auditorias. Inventários gerados devem ser regenerados conforme o código resultante.

## Fechamento dos resíduos confirmados — 12/10/2026

Após a revisão seguinte e autorização do usuário, os resíduos abaixo foram corrigidos no mesmo checkout principal, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. Esta rodada não fez commit, push, deploy, migration, acesso a banco ou inicialização de serviços. A auditoria da Dashboard continuou ativa; os diffs foram aplicados sobre o conteúdo atual, preservando suas alterações.

| Prioridade | Resíduo confirmado | Resultado desta rodada |
| --- | --- | --- |
| P2 | Favorito com a mesma busca aplicada conservava o rascunho do input e o fechamento sobrescrevia o favorito | Aplicações completas incrementam uma revisão do contexto; o input e seu erro acompanham essa revisão. Digitação e mudanças isoladas de critérios não reiniciam o rascunho |
| P2 | Equipe e catálogos WhatsApp excluíam um membro válido de outra organização porque seu cadastro principal apontava para a primeira organização | Filtro e catálogos usam membership ativa da organização da conversa. Equipes exigem geração atual e equipe, vínculo e usuário ativos. A visibilidade operacional das contas e o escopo de leads foram preservados |
| P2 | Período geral acima de 1.830 dias provocava erro opaco em Contatos e Dashboard | Calendário informa o limite destas telas antes de aplicar. Período herdado continua visível, com aviso e ação de limpar; consultas, registros anteriores e exportação ficam protegidos. Limpar remove somente as datas, conservando os demais critérios |
| P2 | Catálogo carregado sem limite continuava visível ao voltar a um relatório com período bloqueado | Observers limitados separam sua política na chave de cache; as cinco coleções de metadata ficam ocultas durante o erro. O prefixo de invalidação e as chaves dos consumidores sem limite permanecem compatíveis |
| P2 | Origem válida nos filtros gerais era rejeitada em Marketing ou WhatsApp | Cliente, parsers/builders Go e OpenAPI aceitam o mesmo teto de 4.096 pontos de código. NUL, UTF-8 inválido e excesso continuam rejeitados. O contrato de gravação de origem do lead não foi ampliado |
| P3 | Popover de proprietários ultrapassava a altura de janelas menores | Painel usa a altura disponível, mantém a busca e permite rolar a lista e alcançar a paginação |
| P3 | Viewport da galeria de automações era maior que sua raiz e ocultava arquivos finais | Galeria tem altura própria de 180 px, limitada a 40dvh; últimos arquivos e carregamento de mais resultados ficam alcançáveis. O primitive compartilhado de rolagem foi preservado |
| P3 | Enter com código 229 selecionava tag ou campanha durante composição | Picker protege `isComposing` e código 229; Enter normal conserva a seleção |
| P3 | Calendário histórico reabria no mês atual | Calendários mobile e desktop abrem no mês do intervalo selecionado |

Pipeline e WhatsApp continuam permitindo períodos gerais maiores; a restrição de cinco anos pertence a Contatos e Dashboard. Marketing/Meta conservam seu limite próprio de 366 dias inclusivos. “Todos os dados” continua disponível sem um intervalo arbitrário, e favoritos ou links antigos não são truncados para satisfazer o limite de uma tela.

Em P4, inventários foram regenerados e a cobertura ganhou regressões de rascunho/favorito, IME, calendário, catálogos, rolagem, limite por consumidor e cache. Os contratos antigos de hidratação e detalhe da Dashboard passaram a exigir hidratação e período válido, conservando a abertura sob demanda. Em P5, nomes e contatos truncados do proprietário receberam títulos. Em P6, sincronização de favoritos entre dispositivos continua uma evolução opcional, sem mudança de banco nesta rodada. Nenhum P0 ou P1 novo foi confirmado neste recorte; isso não certifica a ausência de falhas em todo o CRM.

### Provas e limites desta rodada

- `scripts/tests/filter-ui-runtime.test.mjs`: 25/25 em Chromium offline, sem skips. Os casos novos reproduziram falha antes e passaram depois. Incluem favorito com busca vazia e rascunho inválido, limpeza/hash repetidos, callbacks de favoritos, composição com código 229, calendário histórico e período herdado excessivo. A matriz anterior de 21 tamanhos e 42 medições de painéis permanece na suíte.
- `scripts/tests/filter-domain-ui-runtime.test.mjs`: 8/8; `property-owner-pagination.test.mts`: 1/1. Proprietário e galeria foram exercitados em 320, 390 e 768 × 480, com busca, loading, erro/retry, limpeza/foco, arquivos finais e paginação. Áudio, vídeo e imagem incluem a composição no `NodeConfigPanel` real; os casos anteriores de Financeiro e Marketing/Meta também passaram.
- `scripts/tests/filter-report-period-runtime.test.mjs`: 9/9, sem skips, com FilterProvider, favoritos, aviso, hooks de Contatos/metadata e QueryClient reais, autenticação e APIs sintéticas. Confere bloqueio antes do transporte, refetch manual, ocultação de registros e catálogos de cache, preservação do snapshot e retomada ao limpar datas. O caso de troca de política de cache encontrou e reproduziu o resíduo adicional corrigido nesta rodada. Casos separados verificam as cinco coleções pré-injetadas na chave limitada e a resposta sem limite ainda pendente, protegendo máscara e deduplicação independentemente.
- O conjunto Node de contratos, schemas, links e integração de filtros passou em 43/43 casos; `lib/api/filter-report-period.test.mjs` passou em 3/3. Este último executa funções reais das APIs e schemas Zod, substituindo somente a fronteira HTTP: doze consultas filtradas da Dashboard, o helper de leads da equipe, lista e exportação de Contatos rejeitam excesso antes do transporte. Período válido, todos os dados, busca e origem legada são preservados. Contagens de conjuntos têm escopos sobrepostos.
- Os pacotes Go `whatsapp`, `analytics` e `leads` passaram com `-count=1`. Os cinco testes focados de fonte/membership falharam contra os quatro arquivos de aplicação anteriores via `go test -overlay` e passaram no conteúdo corrigido, sem restaurar o checkout. Foram conferidos os predicados de organização, conta, concessão, lead, membership ativa e geração.
- A nova matriz de duas organizações está compilada no subteste `secondary organization team and catalogs preserve authorization`, mas **não foi executada com banco**. `TestConversationListFiltersSourceAndPeriodIntegration`, `TestConversationExpandedCatalogSQLReadOnlyIntegration` e `TestCampaignInsightsCompleteSQLReadOnlyIntegration` ficaram skipped por ausência de opt-in isolado. Essa rodada prova parsers/builders e regressões locais, sem nova prova de SQL executado ou de autorização com dados reais.
- Gates finais: `npm run typecheck`, lint geral e lint focado após os últimos ajustes passaram. `npm run audit:check` passou com 4/4 contratos após regenerar os inventários. O diff foi conferido contra baselines incrementais, sem arquivos em conflito ou mudança de HEAD; `git diff --check` passou nos arquivos desta rodada. O checkout conserva trabalho preexistente e continua com alterações locais.

Uma revisão independente dos hunks não confirmou regressão material. A borda de receber um hash com período bloqueado enquanto um diálogo de detalhes da Dashboard já está aberto não foi reproduzida em runtime: o aviso pode ficar na tela base, atrás do diálogo. As APIs de detalhes validam o período antes do HTTP; a experiência desse caso permanece fora da prova de interface desta rodada.

As provas de interface usam Chromium, CSS e componentes reais com dados sintéticos. Safari/Mac nativo, zoom do sistema, navegação autenticada completa, produção e carga de 5 a 6 mil usuários continuam fora desta validação. O inventário de dívida visual conserva achados de outras superfícies; suas prioridades automáticas de estilo não equivalem à classificação funcional de riscos dos filtros.

Baselines desta rodada: `D:\Vimob\tmp\filter-residual-fixes-20261012-466fc709` (root), `D:\Vimob\tmp\filter-residual-fixes-20261012-ddf0279b` (contexto/controles), `D:\Vimob\tmp\filter-audit-final-fixes-baseline\domain` (Go) e `D:\Vimob\tmp\filter-audit-fixes-baseline\owner-gallery-20261012` (proprietário/galeria). Uma reversão deve inverter apenas os hunks desta rodada após conferir edições posteriores; arquivos inteiros contêm trabalho anterior e de outras auditorias.

## Fechamento da nova auditoria de filtros — 12/10/2026

Esta etapa implementa os nove grupos confirmados pela auditoria seguinte: quatro P2 e cinco P3, além da fixture P4. As correções foram autorizadas pelo usuário e aplicadas no checkout principal `D:\Vimob\workspaces\vimob-crm`, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, preservando o conteúdo anterior. Não houve commit, push, deploy, migration, acesso a banco ou inicialização de serviços nesta etapa.

| Prioridade | Achado confirmado | Correção nesta etapa |
| --- | --- | --- |
| P2 | Contatos removia buscas literais como `All`, `None`, `null` e `undefined`, ampliando lista, contagem e exportação | Busca conserva texto; origem e atribuição conservam valores opacos, inclusive `__all__`. Apenas `all` exato permanece reservado nestas dimensões. IDs conservam validação e compatibilidade próprias |
| P2 | WhatsApp convertia texto misto, como `Lote123`, em alternativa numérica por telefone | Um helper comum só habilita a alternativa para uma entrada telefônica com pelo menos quatro dígitos. Texto, email e números curtos continuam literais, escapados e parametrizados. Guards de PN, conta, concessão e lead foram preservados |
| P2 | Link antigo reaplicava critérios ao remontar o provider por acesso ou ao voltar A→B→A | Consumo do link e snapshot atual ficam escopados por conta/organização no documento. Edições, favoritos e limpeza atualizam esse snapshot. Novo documento e navegação nativa por hash continuam aplicando links válidos; storage bloqueado não perde as edições em um remount |
| P2 | Salvar ou excluir favoritos numa segunda aba sobrescrevia uma lista antiga | A operação relê e valida o armazenamento sob coordenação entre abas, incluindo o limite de vinte. Web Locks tem fallback por transação IndexedDB do navegador. Dados continuam no mesmo formato localStorage; JSON inválido, excesso e falha de storage não apagam a lista nem produzem falso sucesso |
| P3 | Calendário aberto aplicava rascunho anterior a um novo período ou hash | Uma aplicação externa fecha o calendário e invalida a abertura antiga; reabrir inicia pelo período vigente. Reaplicar o mesmo snapshot também invalida o rascunho. Rerender com datas semanticamente iguais conserva a edição humana |
| P3 | Atualizar o catálogo removia a opção focada e deixava teclado sem destino | O picker recupera foco na busca quando a opção removida ou desabilitada possuía o foco. Não retira foco de outra região; setas continuam navegando nas opções válidas |
| P3 | Agenda com período histórico abria calendário no mês atual | As duas versões do calendário usam o início do intervalo selecionado como mês inicial |
| P3 | Telefone com máscara não correspondia da mesma forma em Pipeline e Dashboard | Contatos, Pipeline, Dashboard e WhatsApp compartilham a regra de entrada telefônica. Pipeline e Dashboard também comparam o telefone normalizado, mantendo parâmetros e predicados de acesso |
| P3 | Favorito em Contatos conservava página antiga e podia recuperar a etapa anterior ao voltar a um pipeline | Página e etapa locais acompanham a revisão da aplicação completa. Restaurar, limpar ou reaplicar favorito reinicia ambos antes de montar a consulta; edições comuns mantêm os resets próprios da tela e o contrato funcional da paginação |
| P4 | Mock de períodos usava `list`, mas a auditoria paralela de Contatos introduziu `listPage` | Fixture usa o envelope paginado `{ data, total }`. Bloqueio, registros anteriores, total, placeholder, cache, exportação e retorno após limpar datas continuam verificados |

A revisão independente identificou, antes da entrega, que apenas derivar o fechamento do calendário permitia reabertura automática ao mudar A→B→A por setters. O fechamento definitivo foi incluído no mesmo ajuste de rascunho, sem callbacks que alterem filtros. Favoritos também receberam proteção para conclusão pendente após troca de conta, organização, permissões, remount ou retorno ao escopo anterior; a gravação captura seu snapshot e sua chave antes da espera.

### Evidências desta etapa

- `scripts/tests/filter-ui-runtime.test.mjs`: 31/31 em Chromium offline, sem skips ou erros de página, com React/Radix, CSS e componentes reais. Inclui calendário externo/hash, reaplicação de valor idêntico, A→B→A, virada civil, rerender equivalente, recuperação de foco sem roubá-lo, Agenda histórica e calendário WhatsApp aninhado. A matriz de 21 viewports e 42 medições de painéis foi preservada. Fixture, harness e casos foram separados por responsabilidade em cinco arquivos de 89–209 linhas; o entrypoint permanece o mesmo.
- `scripts/tests/contacts-filter-application-runtime.test.mjs`: 5/5, sem skips ou erros de página. Monta a tela, modelos, contexto, favoritos e paginação reais, com dados e controles de lista/toolbar sintéticos. Confere que consultas novas não recebam etapa/página antigas, reaplicação idêntica, edição comum e setas de paginação antes/depois de restaurar. Três dos quatro casos iniciais falharam contra a tela anterior; o controle de rerender passou. O quinto caso protege o contrato funcional da paginação.
- `scripts/tests/filter-state-concurrency-runtime.test.mjs`: 16/16 em Chromium offline, sem skips ou erros de página. Usa QueryProvider, FilterProvider, favoritos e storage reais, com identidade sintética. Cobre histórico nativo, documento novo, acesso, duas organizações, duas abas, limite concorrente, storage negado/malformado/excessivo e IndexedDB sem Web Locks. Sete falhas foram reproduzidas contra os dois arquivos anteriores antes das correções.
- `scripts/tests/filter-report-period-runtime.test.mjs`: 9/9 no contrato paginado atual, sem skips. Usa hooks reais e APIs sintéticas, conferindo bloqueio antes do transporte e máscara de registros, total e catálogos em cache. As verificações anteriores não foram retiradas para acomodar a fixture.
- O conjunto de schemas, links, integração de filtros, modelos de Contatos e contratos OpenAPI passou em 41/41; ações de Contatos passaram em 7/7. Os conjuntos têm escopos diferentes e não devem ser somados como casos únicos de interface.
- `go test ./internal/searchtext ./internal/leads ./internal/whatsapp -count=1` passou. O overlay com os arquivos anteriores reproduziu os três grupos de falha: literais de Contatos, máscaras de telefone em dois tenants e texto misto no WhatsApp. As provas executam helpers, parsers e builders em memória; integrações que exigem opt-in de banco não foram executadas nesta etapa.

As revisões independentes conferiram os hunks de contexto, persistência, calendário, foco, Agenda e Contatos. A borda A→B→A do calendário foi reproduzida e corrigida antes da entrega; não foi confirmado outro risco material nestes hunks. Os hashes da interface permaneceram iguais aos da execução final de 31 casos. HEAD e branch permaneceram iguais e não havia arquivos em conflito; `git diff --check` passou nos arquivos da rodada.

### Resultado dos gates gerais

Os gates gerais **não estão certificados como verdes nesta etapa**. As alterações concorrentes no checkout e a latência do host impedem usar as execuções finais como prova geral do projeto. Os testes funcionais acima têm resultados concluídos e escopo explícito.

- A primeira execução de `npm run typecheck` encontrou a incompatibilidade do callback de paginação desta rodada, corrigida com `SetStateAction<number>` e verificada com as setas reais. Também apontou dez diagnósticos fora dos hunks de filtros: `ConversationsScreen.tsx`, `message-experience-model.test.mts`, `round-robin/management-hardening.test.ts`, `management-availability-precision.test.ts`, `whatsapp-draft-store.test.ts` e `whatsapp-message-grouping.test.ts`. Esses arquivos foram preservados. A rechecagem geral final ficou sem resultado e foi interrompida após demora prolongada; não prova aprovação ou falha do código final.
- A execução geral de lint apontou quatro erros fora desta rodada: uso de `module` em `hooks/use-lead-attachments.runtime.test.mjs`, `lib/api/lead-attachments.runtime.test.mjs` e `scripts/tests/property-mutation-intent-runtime.test.mjs`, e acesso a refs em `hooks/use-whatsapp-media-gallery.ts`. Avisos de outras superfícies também foram preservados. Três imports sem uso introduzidos pela divisão dos testes de filtros foram removidos. Lint focado passou nas execuções anteriores de Contatos/contexto/armazenamento; a rechecagem final completa dos arquivos de filtros ficou inconclusiva após demora no carregamento do ESLint. Nenhum resultado pendente foi tratado como aprovação.
- Inventários foram regenerados, mas as últimas execuções de `audit:check` detectaram mudança do digest de fontes entre a geração e a conferência. Arquivos de leads/WhatsApp fora dos hunks desta rodada continuavam recebendo edições. A primeira execução desta etapa passou em quatro contratos; a repetição isolada final passou em três e atingiu o timeout de 120 segundos do subprocesso que confere repetibilidade. Não foi alterado o timeout nem enfraquecido o gate. Atualizar e revalidar os inventários exige um snapshot estável do checkout.

As sessões próprias de validação pendentes foram encerradas; nenhum processo de outra auditoria foi encerrado. Não houve P0 ou P1 novo confirmado no recorte desta auditoria. Isso não certifica ausência de problemas em todo o CRM nem substitui os gates gerais pendentes.

Safari/Mac nativo, zoom do sistema, teclado virtual real, navegação autenticada completa, SQL executado, planos/latência de consultas, produção e carga permanecem fora destas provas. O fallback IndexedDB foi executado no Chromium; aborto tardio da transação após escrita localStorage não foi reproduzido e permanece um limite de validação, sem achado funcional confirmado. O inventário automático de dívida visual conserva achados de outras superfícies e não equivale à classificação funcional P0–P6 dos filtros.

Baselines e evidências incrementais: `D:\Vimob\tmp\filters-adjust-20261012-a02dea9e` (Contatos, fixture, relatório e inventários), `D:\Vimob\tmp\filter-concurrency-fixes-20261012-8c8e0e2a` (contexto/favoritos), `D:\Vimob\tmp\filter-search-fixes-20261012-domain-5f133fd0` (Go) e `D:\Vimob\tmp\filter-audit-fixes-baseline\calendar-catalog-20261012` (calendário/picker/Agenda). Reversão deve inverter somente os hunks desta etapa, após conferir edições posteriores. Não restaurar arquivos inteiros: contêm contribuições anteriores e de outras auditorias.
