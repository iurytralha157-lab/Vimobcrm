# Colunas da Pipeline — encerramento das correções de P4 a P8

Rodada local de 20/10/2026 no checkout principal. Não autoriza publicação,
migration ou alteração do banco operacional. Evidências externas:
`D:/Vimob/outputs/pipeline-columns-remaining-fixes-20261020-l913`.

Correções COL-03/P4, COL-04/P5, COL-05/P6, COL-06/P6 e COL-07/P8 encerradas,
com gates finais aprovados. Os sete achados da auditoria têm aceite local de
correção; a homologação integrada tem os limites indicados abaixo.
COL-01/P2 e COL-02/P3 permanecem cobertos pelos runbooks anteriores.

## COL-03 / P4 — regras operacionais e respostas antigas

O domínio de cadências captura organização, ator, SID, etapa, visita e lease do
QueryClient antes da espera de `onMutate`; copia a entrada profundamente e
propaga intenção/AbortSignal ao GET/PUT. A escrita não tem retry automático.
Etapa/pipeline da resposta são conferidas e o ACK precisa avançar a revisão
submetida. O DTO não contém organização; o tenant é fixado no transporte.

Revisões são monotônicas no commit da query, no sucesso da mutation e na entrega
ao chamador, inclusive após callbacks globais assíncronos do React Query.
Resposta R2 superada por R3 não vira sucesso R2 no editor. Um conflito conserva
o rascunho. Troca de acesso não escreve/recria/invalida cache aposentado nem
publica callbacks ou avisos. Refresh do token com o mesmo SID continua válido.

Fechar apenas o painel permite reconciliar o próprio acesso sem refetch ou
notificação. O editor protege submit/recarga por visita e exclusão síncrona;
campos ficam bloqueados na recarga explícita. Uma operação antiga não limpa
nem libera um formulário novo. Classes, estilos e textos foram preservados.

Prova do ponto: 86 testes únicos, zero falhas/pulos; 54 novos de sessão/cache/
editor e regressões de modelo, validação e configurações. RED e controle do
hook anterior preservados. Revisões independentes de core e UI aprovadas.

Fontes: `hooks/cadences/use-stage-operational-rules.ts`, seu helper de escopo,
GET/PUT em `lib/api/cadences.ts` e editor em `components/features/cadences/`.

## COL-04 / P5 — snapshot do quadro e recuperação da coluna vazia

Resolver a pipeline, listar colunas, buscar a primeira página e calcular
contadores/valores agora compartilham uma transação curta RepeatableRead e
ReadOnly, na mesma conexão. Commit ocorre antes de enriquecimentos e assinatura
de avatares. A garantia de snapshot abrange colunas/cards/métricas, não os
enriquecimentos posteriores nem páginas de requisições diferentes.

Os wrappers usados pelo Dashboard foram preservados. As quatro consultas
mantêm SQL, parâmetros, filtros, visibilidade, projeção e scans anteriores;
apenas o queryer passa a ser explícito na composição do quadro. O padrão de
isolamento segue a [documentação PostgreSQL](https://www.postgresql.org/docs/17/transaction-iso.html).

Uma coluna vazia com `has_more` oferece o botão de recuperação. A página validada
nesse caso não faz append nem esgota a coluna por deduplicação: reconcilia o
quadro exato, mantendo filtros e guards de acesso, snapshot e movimentos
pendentes. A deduplicação entre colunas continua ativa. O observer de mutation
é reiniciado na troca de acesso; a conclusão antiga não destrava a nova ação.
Erro/página vazia não cria repetição automática de carregamento.

Prova do ponto: frontend 90/90, zero pulos, incluindo botão real desktop/mobile,
IDs ainda presentes na coluna antiga, erro/retry manual, filtros/lease e SID.
Backend 29 testes principais / 35 folhas, zero falhas/pulos. O ensaio real com
duas conexões e barreira após ler os cards cobriu mover, inserir e remover o
último lead. O controle externo que troca somente o isolamento por ReadCommitted
reproduziu as três inconsistências; a fonte corrigida passou novamente.

Fontes: `apps/api/internal/leads/pipeline_board_snapshot.go`, helpers do quadro,
`useLoadMoreLeads` em `hooks/use-stages.ts` e `buildStageCountMetaMap`.

## COL-05 / P6 — chaves limitadas e identidade persistida

Nomes válidos permanecem completos. Novas chaves têm limite 80, reservando
comprimento para sufixos `_2`, `_10` e seguintes. A busca inclui arquivadas;
novas chaves do mesmo lote também são reservadas. O servidor faz a alocação
sob o lock da pipeline e mantém CAS/revisões e rollback. Chave explícita acima
do contrato é rejeitada; não é truncada silenciosamente.

O editor omite chaves de colunas persistidas no pedido e conserva as chaves no
rascunho local. O novo transporte envia `preserveStageKeys: true`; a API atual
preserva exatamente as chaves existentes nesse modo, incluindo aliases legados.
Sem o modo, chaves explícitas de clientes anteriores continuam suportadas.
Omissão de chave existente não gera outra a partir do nome.

### Compatibilidade de versões

A API anterior interpretava omissão como geração pelo nome. Seu decoder estrito
rejeita a indicação nova antes de qualquer gravação; o cliente não repete sem
essa indicação e mantém o rascunho. Não retirar o campo como fallback. Em um
rollout futuro, concluir a atualização da API antes de liberar o frontend novo.
Versões mistas podem recusar o salvamento; não devem renomear identidades.
O OpenAPI do endpoint foi atualizado no mesmo recorte.

Prova do ponto: frontend 179/179, zero pulos; pacote Go pipelines completo com
PostgreSQL próprio: 53 testes principais / 260 folhas, zero falhas/pulos.
Inclui chaves legadas 81/120, aliases de cadência, colisões com arquivadas/lote,
UUIDs, CAS, locks, exclusão e rollback. O corpo real do handler legado, em
controle externo com modelo anterior, rejeitou o campo antes do repositório.
OpenAPI 7/7 e revisão independente aprovados. Apresentação do editor preservada.

Fontes: geradores `lib/pipeline-stage-key.ts` e `apps/api/internal/pipelines/stage_key.go`,
editor de colunas, schema/transporte de reordenação e `ReorderStages` Go.

## COL-06 / P6 — geometria do clone no arraste

A origem medida pelo dnd-kit continua em estado lógico de arraste, mas não
recebe a rotação/escala decorativa que alterava sua medição. A apresentação do
LeadCard separa essa decoração por uma opção de valor padrão verdadeiro; o
caminho Pangea e o clone mantêm o comportamento anterior. Refs, sensores,
permissões, opacidade, transições e proteção do clique residual foram mantidos.

O clone no portal conserva os pesos e a altura de linha do contexto da app-shell
por um wrapper local mínimo, usando as mesmas variáveis e sem herdar o layout
da shell. Nenhuma fonte, padding, gap ou CSS global foi alterado para esconder
a diferença. Em 1280px a origem e o clone mantêm 232×154px e duas linhas de
ações; em 1440px mantêm 272×134px e uma linha. As propriedades tipográficas
computadas são iguais. O deslocamento do pointer é o hover de 2px já existente.

Prova do ponto: 8/8 cenários novos e 68/68 regressões, zero pulos, typecheck e
lint do recorte aprovados. Há teclado/mouse, Escape, Enter sem abertura
indevida, gesto seguinte, resize da sidebar, reduced-motion, aceite/rollback
sintéticos e caminho Pangea. O controle externo que reintroduz somente a
decoração da origem falha nos quatro cenários de geometria. Duas revisões
independentes e inspeção da captura compacta aprovadas. Os conjuntos de testes
desta documentação têm sobreposição; não somar como um total global.

## COL-07 / P8 — fixtures e gate reproduzível

As fixtures de interações/responsividade usam o writer atual na fronteira de
serviço, ator/SID e QueryClientProvider. Componentes, CSS, Radix e sensores são
reais nos harnesses; não foi adicionado um polyfill global de process. Os
asserts da benchmark que dependiam de uma flag agora são obrigatórios.

Contratos obsoletos de fonte mínima 12 e ações mobile 40 foram substituídos pelo
mapa aprovado: nome 13, telefone 12, tag 9, origem/valor/idade 10 e ações/avatar
mobile 32. Navegação/menu 44 e demais verificações permanecem. O teste de ações
do card usa o comando de resultado atual, mantendo os três casos de bloqueio e
verificando payload, receipt, ACK, primeiro contato e liberação do envio. As
suítes reais de draft/writer também entram no gate; a fixture de seis casos não
é apresentada sozinha como prova de SID, retry ou idempotência.

O comando `npm run test:pipeline-columns` seleciona 59 arquivos explícitos do
checkout, com concorrência padrão 1, limpeza de overrides de fonte/opt-ins de
serviços/DB e falha em teste pulado, TODO, cancelado ou Chromium ausente. Não
altera dependências, lockfile ou CI. Smokes dos originais: 12/12, zero pulos;
comparação de AST e revisão independente aprovadas. O gate completo original do
checkout passou com 751/751 testes, zero falhas/pulos/TODOs/cancelamentos. Os 61
hashes de testes/runner/loader continuaram iguais ao manifesto congelado.

## Gates finais e aceite

| Verificação | Resultado |
|---|---|
| `npm run test:pipeline-columns` | 59 arquivos; 751/751, zero pulos |
| Go de regressão, seis pacotes, `-count=1` | 159 principais / 670 folhas únicas, zero falhas/pulos após executar os três opt-ins em banco próprio |
| PostgreSQL completo de pipelines | 53 principais / 260 folhas, zero falhas/pulos; grupo com sobreposição aos testes Go anteriores |
| `npm run typecheck -- --incremental false` | Aprovado |
| `npm run lint` | Zero erros; os mesmos sete warnings anteriores, nenhum novo |
| `npm run audit:check` | Aprovado; quatro contratos |

Os três opt-ins de stageconfig inicialmente pulados foram executados em seguida
no banco próprio, sem mudança de fonte: edição após lock e preservação de
configuração nativa/legada. O recibo combinado substitui o veredito SKIP pelo
PASS executado usando Package+Test; não soma pais com filhos nem duplicatas.

O inventário global mudou somente posições/IDs e digests autorizados; rotas,
acesso, contagens, alcance e gaps permaneceram iguais. A comparação das fontes
e do Git está em `D:/Vimob/outputs/pipeline-columns-remaining-fixes-20261020-l913/preservation-final.json`.
O resultado completo e os logs estão em `RESULTADO.md` na mesma pasta externa.
O checkout mantém os ajustes preexistentes; nenhum commit os consolidou ou
descartou. O manifesto registra as fontes testadas, sem alegar um build de
commit limpo ou comprovação de uma instalação publicada.

Não resta implementação pendente nos sete achados dentro do recorte testado.
O próximo aceite é homologação integrada com o conjunto compatível de fontes,
salvamento/releitura reais e os aparelhos/carga indicados abaixo. O cenário de
criação sem ACK exige validação/decisão antes de ampliar a produção; não foi
declarado resolvido por estas correções.

## Banco, preservação e limites

Os ensaios PostgreSQL usaram um cluster novo restrito a 127.0.0.1:56520, bancos
aleatórios próprios e dados sintéticos, sem credenciais ou acesso ao banco
operacional do CRM.
A identidade do alvo foi verificada por SQL. O cluster foi encerrado após P5/P6
e retomado exclusivamente para os três opt-ins de stageconfig encontrados no
gate final. Eles passaram, sem edição de fonte. Scaffolds/migrations da fixture
foram aplicados somente nos bancos aleatórios próprios; as três roles NOLOGIN
exigidas pela fixture foram criadas somente no cluster sintético confirmado.
O cluster foi encerrado novamente, sem bancos de fixture residuais; dados/logs
locais foram preservados como evidência.
As prévias e serviços do CRM não foram reiniciados. Não houve deploy/push/commit.

Os testes de browser são isolados/emulação Chromium, com serviços sintéticos
nas fronteiras indicadas pelos recibos. Não comprovam Safari físico, instalação
do schema/RLS/workers em outro ambiente, persistência de movimentação no CRM
operacional nem capacidade de 300 usuários. Esses itens pertencem à homologação
integrada, que deve usar API e frontend compatíveis do mesmo conjunto de fontes.

Resultado desconhecido depois de um commit não é rollback. A ausência de retry
automático reduz reenvios, mas não é recibo durável de criação; o cenário de
repetição manual após ACK perdido continua sendo um risco de homologação já
registrado pela auditoria, sem ocorrência operacional demonstrada nesta rodada.

## Reversão

Reverter seletivamente os deltas desta rodada. Não restaurar arquivos inteiros
do checkout com alterações anteriores. Transporte, schemas, helper e servidor
do contrato `preserveStageKeys` devem ser tratados juntos; não remover a proteção
para conseguir salvar contra servidor antigo. Manter P2/P3 e os rascunhos/CAS.
Reverter o cliente não desfaz qualquer commit já aceito pelo servidor.
