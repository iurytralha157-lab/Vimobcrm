# Contatos: correções locais de 12/10/2026

As seções seguintes registram a etapa P1. A etapa P2/P3 está documentada ao
final e no runbook, incluindo a nova migration de recibos de importação.

## Reentrada por importação

Uma linha de importação que corresponde a um contato existente na mesma
organização e no mesmo escopo de entrada registra uma reentrada sem alterar
pipeline, estágio, ordem no Kanban, responsável, equipe, status do negócio,
motivo/datas de ganho ou perda, valores, imóvel e dados de perfil. A política
da fila não redistribui esse contato durante a importação. Novos contatos
continuam usando os destinos e a distribuição escolhidos.

O nome informado é atualizado. E-mail e mensagem são atualizados quando
informados; campos opcionais ausentes/vazios preservam os valores anteriores.
O histórico registra o destino efetivo preservado e guarda as opções comerciais
solicitadas separadamente, com `import_state_preserved=true`.

As autorizações e os locks de identidade/conversa existentes continuam sendo
validados. Importar não passa a autorizar edição de contatos fora do escopo.
O fluxo manual de reentrada não foi redefinido nesta correção.

## Confirmação após criação

A API prepara o resultado da criação/reentrada dentro da transação, antes de
confirmá-la. Uma leitura posterior à gravação não pode transformar o sucesso
em um falso erro de contato inexistente.

Se o contato final estiver fora da visibilidade de quem criou/importou, a
resposta confirma `leadId`, `leadVisible=false` e `data=null`, sem expor o
registro completo. Quando houver visibilidade, `data` contém o contato.
Consultas e atualizações conservam seus próprios contratos e permissões.
Quando houver uma publicação futura, API e frontend precisam suportar esse
contrato de confirmação em conjunto; o frontend anterior não aceita `data=null`.

Essa confirmação não é uma garantia de processamento exatamente uma vez:
perdas de resposta HTTP e resultado incerto de commit ainda precisam de
reconciliação. Não repetir automaticamente um POST com resultado desconhecido.

## Sessão ativa e validação

Leitura/exportação e as mutações usadas em Contatos passam pela proteção de
sessão ativa, além de organização, escopo e permissões de cada operação.
`lead_import` continua separado de `lead_create`.

Regressões locais cobrem ausência de campos, preservação comercial, sessão
revogada, duas organizações, visibilidade após atribuição e falhas antes do
commit. O teste PostgreSQL só aceita banco vazio descartável com prefixo
`vimob_contacts_p1_`, acesso loopback e autorização de teste explícita.

Não há migração de schema. Estas mudanças são locais; testes com fixtures não
comprovam o estado do banco completo, Safari/Mac, homologação ou produção.
As demais pendências P2/P3 não faziam parte da etapa P1.
As políticas novas ficam em helpers pequenos de reentrada e resultado da
criação. A integração no repositório legado preserva seus locks e efeitos;
uma divisão futura por criação/reentrada deve manter essas interfaces e ser
validada separadamente, sem refatoração incidental neste pacote.
Para reversão local, remover somente os trechos e arquivos destas correções;
não restaurar arquivos inteiros sobre alterações concorrentes. Há snapshots
pré-edição em `D:\Vimob\_safety\contacts-p1-20261012-182445` para comparação.

### Resultado desta execução

- A suíte Go de `leads`, `distribution`, `app`, `httpserver`, `tenant` e
  `authorization` passou; 45 eventos de teste foram pulados por falta de
  fixtures/configuração de banco. O log está em
  `D:\Vimob\_safety\contacts-p1-20261012-182445\contacts-p1-go-suite.jsonl`.
- Os testes JavaScript de schema/cliente/hooks/formulário/Realtime e os testes
  Go de permissões, resposta limitada, falhas de transação e sessão passaram.
- Os dois novos testes PostgreSQL compilaram, mas não foram executados.
  Tentativas limitadas de inspeção/exportação do container descartável local
  não responderam. Não houve criação de banco, carga de dados ou migração.
- O typecheck geral falhou em alterações paralelas de tags, imóveis, filas,
  equipes e testes de imóveis; esses trabalhos foram preservados.
- O lint geral foi iniciado e interrompido durante a concorrência de outras
  verificações, sem diagnóstico. A tentativa dirigida aos arquivos alterados
  também não concluiu e foi interrompida; nenhum lint foi considerado aprovado.

Antes de homologar, executar os testes PostgreSQL guardados e obter os checks
gerais aprovados em uma árvore reproduzível. Perda de resposta na rede segue
fora da garantia desta correção.

## Etapa P2/P3: seleção, edição e transferência

- Seleção limitada à página/recorte atual, com reset imediato e âncora de Shift
  limpa, inclusive na troca de organização/usuário. Cabeçalho indica IDs visíveis e seleção parcial. Exclusão em lote
  bloqueia dados em transição e IDs ocultos; a confirmação apresenta nomes.
  Cards mobile permitem seleção e ordenação. A barra não cobre o rodapé.
  Abertura de detalhes e exclusão individual também bloqueiam linhas antigas
  durante transição; confirmação exige alvo visível e o escopo revisado.
- O editor mantém a base durante atualizações externas. Recarregar exige
  confirmação de descarte. PATCH envia somente alterações, com a revisão
  original; interesse/perfil não alterados não são reenviados. Rascunhos novos
  pertencem a usuário e organização; chaves antigas não são adotadas por outro
  usuário e seus dados não foram apagados por esta etapa.
- Documentação distingue consulta pendente, ausência e falha. Links não são
  abertos com URLs anteriores quando a atualização falha. Após salvar, os
  documentos malsucedidos podem ser reenviados sem criar outro contato; fluxo
  bloqueia fechamento durante reenvio e callbacks duplicados/tardios.
- Atalhos de chat foram retirados da listagem e do cabeçalho de detalhes de
  Contatos. As variantes de detalhes dos outros consumidores são preservadas.
  Detalhes de Contatos usam drawer em larguras intermediárias e colunas
  flexíveis no desktop; não houve edição de primitivas UI ou CSS global.
- CSV/XLSX rejeitam cabeçalhos repetidos/equivalentes e células excedentes;
  aliases antigos/atuais de estágio e mensagem são reconhecidos. Origem usa
  código canônico; destinos por nome ambíguo são rejeitados, com suporte a ID
  e email inequívoco. Leituras grandes não usam spread dos argumentos.
- Exportação oferece 93 colunas fixas e campos dinâmicos opcionais. A
  importação suporta 11 campos de negócio e identificadores de destino;
  colunas adicionais são declaradas como ignoradas antes da gravação. O
  arquivo é relatório detalhado, não backup restaurável de todo o CRM.
- Tags usam lista JSON reversível na exportação e aceitam o formato legado na
  importação. Catálogo fresco e conflito concorrente são reconciliados sem
  repetir automaticamente criação incerta. Tags criadas na preparação são
  operações separadas; falha do contato não as remove automaticamente.
- Resultado de importação mostra linhas, motivos e relatório de falhas. A
  repetição manual conserva a chave da linha; resultados sem confirmação
  continuam exigindo conferência. Fechar/recarregar não retoma um job durável.
- Exportação conserva campos como texto, inclui filtros de todas as páginas e
  distingue perguntas por identidade exata. Confere versão do conjunto antes
  de baixar e respeita cancelamento durante carregamento/preparação e após a
  geração do arquivo. Datas continuam no formato local do relatório.

Contratos, migration não aplicada, ordem de ativação, testes de PostgreSQL
guardados e reversão seletiva estão em
[`contacts-p2-local-2026-10-12.md`](../../../docs/runbooks/contacts-p2-local-2026-10-12.md).
Os helpers de edição/transferência isolam a lógica nova; os componentes legados
maiores recebem somente a ligação desses fluxos, sem uma refatoração conjunta
que interferiria nas outras auditorias.

### Limites da validação

Testes focados de lógica, funções reais de diálogo/cliente e mocks Go foram
executados. Não houve SQL em banco, deploy, produção ou homologação autenticada.
A ferramenta de navegador não abriu a aba isolada; Mac/Safari, Excel/Numbers,
dispositivos físicos e desempenho de grandes volumes continuam pendentes.
Gates gerais e suas falhas em alterações concorrentes devem ser registrados no
runbook; não considerar testes PostgreSQL pulados como aprovados.

## Correções da revisão de 13/10/2026

Os dois P1, seis P2 e o P3 da revisão seguinte receberam correções locais de
sessão, negação de leitura, URLs do histórico, texto XLSX, upload, efeitos
tardios e retenção da recuperação. O fluxo de contato novo Ganho reutiliza a
transição comercial canônica na mesma transação e depende de uma migration
nova **não aplicada**. Reentrada e importação histórica mantêm seus contratos.

O recovery é limpo no lifecycle global de autenticação e conserva A→B→A entre
organizações na mesma sessão. Relatórios concluídos têm TTL e orçamento de
arquivos em memória; esses limites não alteram a quantidade importável de linhas.
Refresh de token no mesmo SID continua válido. Paginação permite quebra em
telas estreitas; dispositivos físicos ainda não foram validados.

Matriz de correções, evidência, gates, dependência comercial e reversão seletiva:
[`contacts-review-fixes-local-2026-10-13.md`](../../../docs/runbooks/contacts-review-fixes-local-2026-10-13.md).

### Compatibilidade da listagem com a API anterior

O modo compacto aceita o envelope paginado atual e o formato legado `{ data }`
com `total_count` validado. Página posterior vazia consulta uma única linha da
primeira página com os mesmos filtros para obter o total, sem confundir página
fora do intervalo com ausência de contatos. Resposta parcial/inválida continua
rejeitada; `full` e `export` não usam essa adaptação nem recebem versão fabricada.
Esse caminho foi acrescentado após reproduzir o erro `contacts.list-page` que
impedia a tela de exibir contatos válidos com a API anterior.

Evidência e limites:
[`contacts-page-compatibility-local-2026-10-13.md`](../../../docs/runbooks/contacts-page-compatibility-local-2026-10-13.md).

### Lista compacta e tags — 13/10/2026

As tags da tabela e dos cards de Contatos usam fonte de 10 px, conservando as
cores e o texto branco. A tabela mostra somente o estágio, em cinza conforme a
preferência revisada; o tooltip informa o funil e o nome completo do estágio.
`Resp.` mostra o avatar, com nome completo no tooltip e identificação acessível.

Responsável, tags, data/hora de criação e ações usam larguras compactas para
liberar espaço a Nome e Contato. Cabeçalho, linhas e skeleton compartilham as
mesmas larguras, incluindo seleção e motivo de perda quando aplicáveis. A data
mantém o horário e as ações continuam fixas na lateral durante a rolagem.

Validação local desta alteração: 18 testes de modelo, ações/seleção e cores de
tags, cinco testes das cores de estágio e lint dos arquivos alterados passaram.
A lista autenticada local foi conferida com 50 linhas e os dois tooltips.
`npm run typecheck` e `npm run lint` excederam o limite de 180 s sem diagnóstico;
os gates globais ficaram inconclusivos nesta rodada. Não houve deploy nem
alteração em produção ou na interface de Conversas.

Na rodada posterior, somente o estágio voltou ao cinza. Os sete testes do modelo,
o lint do arquivo alterado e `npm run typecheck` passaram; a lista local confirmou
os 50 badges em cinza. O lint global terminou com um erro em
`lib/api/tag-catalog.runtime.test.mjs` (`no-assign-module-variable`) e seis avisos
em arquivos fora deste ajuste, preservados para as alterações paralelas.

### Importação e exportação compactas — 17/10/2026

Os dois pop-ups usam largura máxima de 960 px (revisada em 18/10) e altura de até 760 px ou 82dvh,
mantendo o limite da tela e as áreas de rolagem. As etapas selecionadas, o hover
e a área de arquivo destacada usam laranja a 50% com texto branco. Os botões
principais e indicadores de progresso mantêm o mesmo tom. Novidades aparece em
um bloco cinza no rodapé.

Esses estilos ficam em `ContactTransferDialog.module.css`, usado somente pelos
diálogos de Contatos. O layout compartilhado recebe apenas a prop opcional
`newsButtonClassName`; os outros formulários mantêm seus padrões. Parsers,
validações, permissões, cancelamento e handlers de importação/exportação não
foram alterados.

Validação local: 24 testes dos fluxos de Contatos, oito testes de UI do formulário
de imóveis e lint dos três arquivos TSX alterados passaram. Os pop-ups de
importação e exportação foram conferidos no navegador local, incluindo as cores
calculadas e o hover. Em 390 × 844, a importação mede 366 × 692 px, sem overflow
horizontal e com rodapé visível. Os gates globais de lint/typecheck excederam o
limite de 180 s sem diagnóstico e ficaram inconclusivos. Não houve importação,
exportação, deploy ou alteração de dados durante essa conferência visual.

### Confirmação de exclusão — 18/10/2026

As confirmações individual e em lote usam Cancelar com o fundo cinza translúcido
`--app-surface-soft` e hover `--app-surface-hover`, conservando a opacidade do
texto. Títulos usam 14 px; descrição, lista e botões usam 12 px. Os botões têm
36 px de altura. O ajuste fica nas classes locais de `ContactsOverlays.tsx`,
preservando permissões, bloqueio durante execução e callbacks de exclusão.
Os 14 testes de ações/seleção passaram; o diálogo individual foi conferido no
navegador local e cancelado, sem excluir registros.

### Espaço do arquivo e seleção de filas — 18/10/2026

A etapa Arquivo usa a altura disponível no desktop: a área de arrastar cresce
e reserva espaço para o modelo no mesmo painel. Em telas menores a rolagem
continua disponível. O download não encolhe com o texto (36 × 36 px), e o fechar
dos dois pop-ups usa bloco cinza de 32 × 32 px. A largura máxima de 960 px e as
colunas locais de 160 px/centro flexível/260 px preservam os demais formulários.

Na distribuição, o catálogo informa carregamento, erro com recarga, ausência de
filas ativas e restrição de permissão. Uma fila específica sem validação impede
avançar e iniciar a preparação, inclusive com cache antigo após falha. O usuário
pode escolher manualmente as regras automáticas; não há troca silenciosa. A fila
explícita conserva o comportamento de destino escolhido, sem filtro novo por
funil. Hook, API, backend e configuração das filas não foram alterados.

Foram aprovados 31 testes de importação, seleção da fila, parsing, prévia e sessão
de exportação, incluindo seis regressões novas; o lint dos arquivos TS alterados
passou. A conferência local mediu 960 px, com a área do arquivo e o modelo juntos,
sem rolagem na coluna central. Typecheck e lint globais excederam 180 s sem
diagnóstico e ficaram inconclusivos. Não houve importação, exportação ou deploy.
Os hunks no diálogo legado ficaram limitados a esta apresentação e à validação
do catálogo; uma extração futura deve separar etapas e preparação sem mudar os
contratos de sessão, retomada e envio das linhas.

### Resumos e seleção de campos — 18/10/2026

As prévias de importar e exportar usam cartões compactos com estados explícitos.
Na importação, arquivo, padrões e atribuição aparecem primeiro; amostra e
explicações ficam recolhidas. Alertas da amostra, colunas ignoradas e pendências
da fila continuam identificáveis sem abrir as explicações. Distribuição ativada
representa a opção selecionada, não uma atribuição já concluída.

Na exportação, o resumo mostra modelo, campos fixos, expansão ativada/desativada
e filtros. Listas e limites ficam em detalhes opcionais. O modelo é identificado
pela igualdade dos campos e da expansão; uma alteração manual aparece como
Personalizado. A seleção usa grupos recolhíveis com contagens, nomes completos e
itens marcados em laranja. A busca não modifica a seleção; zero campos fixos
mantém o avanço bloqueado. O conteúdo usa a rolagem do painel, sem uma segunda
área de scroll aninhada.

As prévias continuam passivas. Permissões, handlers, geração do arquivo,
cancelamento e isolamento de sessão não foram alterados. No navegador local,
foram conferidos os estados de distribuição, modelos, expansão, busca sem
resultados e seleção vazia. Em 390 × 844, o exportar mede 366 px de largura,
sem overflow horizontal e com os botões do rodapé visíveis. Não houve importação,
exportação real nem deploy.

Validação desta apresentação: passaram os 31 testes focados de importação e
sessão, os dez testes de exportação/filtros/CSV e o lint dos quatro arquivos TSX
alterados. Os gates globais de lint e TypeScript excederam 180 s sem diagnóstico
e ficaram inconclusivos.

### Revisão funcional e lista mobile — 18/10/2026

A revisão sem acesso remoto aprovou 136 testes de transferência e 32 testes Go
unitários. Duas provas adicionais em memória conferiram os 11 campos e três IDs
na importação CSV/XLSX até o schema do payload e os 92 campos fixos exportáveis
nos dois formatos, com 844 comparações de células, nulos, zeros, booleanos e os
quatro modelos. A exportação completa ainda não possui a coluna Recursos
próprios (`is_own_resource`); essa lacuna anterior ao layout não foi alterada.
O ciclo exportar/importar continua sem equivaler a uma restauração integral.

No mobile, o card separa identificação e dados, com corpo em largura inteira,
estágio cinza, responsável em avatar e datas alinhadas. Tags, motivo de perda,
reentrada e última interação continuam disponíveis. O toolbar alinha filtros e
contador à esquerda, preservando ordem de foco e instância de filtros. A
paginação usa duas linhas e reserva espaço à direita para o chat na posição
padrão; o botão flutuante arrastado para a esquerda continua fora dessa reserva.

A conferência no navegador local em 320, 390 e 500 px não encontrou overflow
horizontal dos cards nem cruzamento dos controles com o chat à direita. Seleção
e menu foram abertos e desfeitos sem alterar registros. Passaram 14 testes de
ações/modelo e três de layout/foco do toolbar, além do lint dos componentes.
Lint e TypeScript globais excederam 180 s sem diagnóstico. Não houve importação
real, exportação de dados reais, edição de registros, migração ou deploy.

### Correções de concorrência e completude — 21/10/2026

A coluna Recursos próprios (`is_own_resource`) agora pode ser selecionada em
Perfil e imóvel e integra o modelo Completo, que passa a ter 93 campos fixos.
CSV e XLSX preservam `true` como `Sim`, `false` como `Não` e `null` como célula
vazia. Os outros modelos mantêm sua seleção anterior. A lacuna registrada na
revisão de 18/10 acima é histórica e foi corrigida nesta etapa; a importação
continua limitada aos campos de negócio e IDs de destino documentados.

A lista de Contatos também reconcilia um evento recebido durante uma leitura
em andamento com uma leitura posterior coalescida, sem polling. Essa
reconciliação respeita a organização e a visita atual da página.

Os testes locais de transferência usam contatos sintéticos, APIs simuladas e
arquivos em memória. Eles verificam os 92 campos anteriores nos dois formatos,
a nova coluna em seleção isolada e no modelo Completo, além das proteções de
texto, precisão numérica, privacidade e cancelamento já existentes. Esses
resultados não representam validação de dados ou funcionamento em produção.
