# Fundação da plataforma imobiliária

Status: fundação de imóveis e primeira vertical de lançamentos implementadas em 31/07/2026.

## Decisão

O domínio imobiliário separa os conceitos que antes conviviam na tabela
`properties`:

1. o ativo físico (`properties`, mantido como fachada de compatibilidade);
2. a oferta comercial (`property_offers`);
3. a participação dos proprietários (`property_ownerships`);
4. a operação e distribuição do ativo (mídia, documentos, chaves e canais);
5. o empreendimento e seu estoque estruturado, em um domínio próprio de
   lançamentos.

As migrations são aditivas. Nenhuma coluna legada é removida ou renomeada
enquanto importadores, site e integrações ainda dependerem dela.

## Invariantes

- Todo registro imobiliário pertence exatamente a uma organização.
- Toda referência entre registros deve pertencer à mesma organização.
- `property_view` libera o módulo, mas não amplia o escopo de registros.
- Visão de toda a carteira exige `property_manage` ou papel owner/admin.
- Corretores comuns veem seus próprios imóveis; líderes podem ver a equipe.
- Dados de contato do proprietário nunca dependem apenas de ocultação visual.
- Venda, locação e temporada são ofertas independentes do mesmo ativo.
- Disponibilidade do ativo e publicação em canal são estados diferentes.
- Imóveis reservados, vendidos, alugados, inativos ou arquivados não são
  exportados para portais.
- Novos cadastros nascem não publicados até passarem pela validação de
  completude.

## Compatibilidade

Durante a transição, `properties` continua sendo a fonte consumida pelas telas
legadas. As novas tabelas recebem backfill conservador dos campos canônicos e
passam a ser adotadas por fluxos novos. Escrita dupla só deve ser introduzida
com teste de reconciliação; não deve existir trigger bidirecional entre legado
e modelo novo.

## Mídia

O bucket público legado `properties` continua temporariamente disponível para
não quebrar site e feeds já publicados. Novos documentos e originais privados
devem usar o bucket `property-private`, com acesso autenticado por organização.
A promoção de uma mídia privada para uma versão pública será uma operação
explícita da central de publicação.

## Lançamentos e empreendimentos

A primeira vertical de lançamentos está implementada com a hierarquia:

`incorporadora -> empreendimento -> fase -> torre/bloco -> tipologia -> unidade`

Ela inclui:

- catálogo paginado de empreendimentos com busca, filtros e totais globais do
  resultado filtrado;
- workspace do empreendimento com estrutura, tipologias, tabelas comerciais,
  histórico recente e resumo agregado do estoque;
- estoque de unidades paginado no servidor, com filtros por torre/bloco,
  tipologia, status e busca;
- geração em lote de até 500 unidades, com validação de pavimentos e preço
  inicial obrigatório;
- tabelas de preço versionadas, imutabilidade de versões históricas e ativação
  com cobertura obrigatória de todas as unidades comercializáveis;
- edição de preço por unidade em tabela de rascunho, sem sobrescrever a tabela
  ativa nem o histórico comercial;
- reservas comerciais com criação idempotente, listagem paginada, cancelamento,
  conversão em venda, prorrogação e expiração automática;
- concorrência otimista na alteração de unidade e na ativação de tabela;
- trilha de eventos de unidade para mudanças operacionais relevantes;
- checklist de completude e indicador de prontidão para publicação.

As unidades geradas permanecem não publicadas enquanto a tabela comercial está
em rascunho. Ao ativar uma tabela completa, o estoque novo coberto é publicado
atomicamente. Uma unidade ocultada deliberadamente não volta a ser publicada ao
ativar outra versão de preço. Estados terminais ou de bloqueio também retiram a
unidade da publicação. O status `reserved` não pode ser definido pela edição
genérica de unidade.

### API disponível

As rotas usam o contexto da organização autenticada e exigem
`property_view` para leitura ou `property_manage` para mutação:

- `GET /v1/property-developments`
- `POST /v1/property-developments`
- `GET /v1/property-developments/{developmentId}/workspace`
- `GET /v1/property-developments/{developmentId}/units`
- `GET /v1/property-developments/{developmentId}/reservations`
- `POST /v1/property-developments/{developmentId}/phases`
- `POST /v1/property-developments/{developmentId}/buildings`
- `POST /v1/property-developments/{developmentId}/floor-plans`
- `POST /v1/property-developments/{developmentId}/units/bulk`
- `PATCH /v1/property-developments/{developmentId}/units/{unitId}`
- `PUT /v1/property-developments/{developmentId}/units/{unitId}/price`
- `POST /v1/property-developments/{developmentId}/units/{unitId}/reservations`
- `POST /v1/property-developments/{developmentId}/reservations/{reservationId}/cancel`
- `POST /v1/property-developments/{developmentId}/reservations/{reservationId}/convert`
- `POST /v1/property-developments/{developmentId}/reservations/{reservationId}/extend`
- `POST /v1/property-developments/{developmentId}/price-tables/{priceTableId}/activate`

O contrato detalhado, incluindo filtros, limites e schemas, está em
`packages/contracts/openapi/v1.yaml`.

### Persistência e segurança

O modelo inclui incorporadoras, empreendimentos, fases, edificações,
tipologias, unidades, tabelas e itens de preço, reservas e eventos de unidade.
Chaves compostas e triggers impedem referências entre organizações. RLS é
mantida como defesa em profundidade, enquanto as mutações do fluxo atual são
executadas pelo backend com validação de tenant e permissão. Tabelas comerciais
ativas/históricas, seus itens e reservas não aceitam exclusão direta pelo fluxo
operacional.

### Reservas comerciais

O fluxo de reservas está disponível na API e no workspace do empreendimento.
A criação exige um `Idempotency-Key` em UUID, o `updated_at` esperado da unidade
e um vencimento futuro de no máximo 30 dias. Repetir a mesma requisição com a
mesma chave devolve a reserva existente; reutilizar a chave com outro conteúdo
gera conflito.

A reserva é uma operação comercial interna e independe de a unidade estar
publicada no site. Ainda assim, a unidade precisa estar disponível ou em
negociação e possuir preço na tabela ativa. O valor, a moeda e as condições de
pagamento dessa tabela são congelados no snapshot da reserva. Cancelar, converter
em venda, prorrogar ou atuar sobre uma reserva concorrente exige o `updated_at`
esperado, evitando sobrescritas silenciosas.

Quando a reserva está vinculada a um lead, criação, filtro, cancelamento,
conversão e prorrogação também respeitam a visibilidade canônica do lead
(`own`, `team` ou `all`). A listagem continua mostrando a ocupação da unidade
para quem pode consultar o estoque, mas remove `lead_id` e `lead_name` quando o
lead está fora do escopo do usuário. Motivos livres de cancelamento seguem o
mesmo limite e não são copiados para o feed amplo de eventos da unidade. Cada
item da listagem também traz `can_operate`, calculado no backend a partir de
`property_manage` e do acesso atual ao lead; a interface não infere autorização
por campos ocultos. O cache do workspace é segregado pela assinatura completa
de organização, usuário, permissões e escopo de equipe.

Reservas vencidas são processadas automaticamente por worker. A configuração
padrão inicia a cada 1 minuto e drena todo o backlog em transações sucessivas
de 100 registros; intervalo e tamanho do lote são configuráveis. O processamento usa transação curta e
`FOR UPDATE SKIP LOCKED`, permitindo múltiplas réplicas sem disputar a mesma
reserva. A expiração muda o status para `expired`, registra o motivo
`ttl_elapsed` e devolve a unidade ao estoque por meio das invariantes e triggers
auditáveis do domínio. Expirações são atribuídas ao sistema, portanto um
corretor histórico desativado não bloqueia nem envenena o lote. Criação,
prorrogação, cancelamento, conversão e expiração possuem eventos explícitos.

### Preço por unidade

A edição individual nunca altera diretamente uma tabela ativa ou histórica. O
backend cria ou reutiliza uma tabela em rascunho, clona a base comercial quando
necessário e grava nela o preço de lista, o preço mínimo e as condições de
pagamento. O espelho de unidades expõe separadamente os campos `draft_*`, para a
interface mostrar o preço vigente e a mudança pendente ao mesmo tempo. Esses
campos, o preço mínimo e os snapshots de eventos comerciais são devolvidos
somente a quem possui `property_manage`; leitores recebem apenas preços de
lista da tabela ativa. A clonagem técnica de uma tabela ativa não gera centenas
de falsos eventos `price_changed`.

Quando já existe uma tabela relevante para a unidade, o cliente envia em
conjunto `expected_price_table_id` e `expected_price_table_updated_at`. A dupla
é validada por concorrência otimista; enviar apenas um dos campos é inválido.
A nova versão somente substitui a vigente após passar pela cobertura de estoque
e pelo fluxo explícito de ativação.

### Próximas fatias

Permanecem como extensões a central completa de publicação e os fluxos de
integração com portais.

## Próximas extensões

A administração de locação será um domínio separado, apoiado pelas ofertas de
locação, e incluirá contratos, garantias, cobranças, reajustes, vistorias,
manutenção, inadimplência e repasses.
