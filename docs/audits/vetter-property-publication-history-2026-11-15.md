# R2-PROPERTY-PUBLICATION-HISTORY — histórico de publicação

## Diagnóstico e evidência

Na produção FBD, a ficha AP0379 exibiu na Central os pedidos de publicação
(20:30) e retirada (20:31), ambos concluídos na versão 1. O histórico geral
mostrou quatro eventos de cadastro/valor/status e três movimentos de chaves;
o filtro Publicação ficou vazio. Evidências operacionais ADM091/099/100 e
`ap0379-final-state.sanitized.json` corroboram a diferença. Esse snapshot contém
contagens de jobs, não seus UUIDs. Não houve nova consulta remota nesta correção.

`ListHistory` consultava eventos de imóvel, criação sintética e Agenda. O
workspace acrescentava chaves, enquanto a Central lia seus jobs canônicos.
O worker atualiza `published_on_site` diretamente como projeção de
compatibilidade; não chama o gravador de eventos de edição. O classificador
legado de publicação não liga esses dois caminhos, e a API atual recusa a
escrita direta desse booleano. Os jobs não foram perdidos.

## Mudança mínima

O GET `/v1/properties/{id}/history` projeta também
`property_channel_publication_jobs`. O CTE passa pelo mesmo `visible_property`
e exige organização e imóvel iguais; a versão é vinculada por ID, organização,
imóvel e publicação. A autorização, os eventos anteriores, a ordenação por
criação decrescente e o limite global de 100 permanecem.

Cada job é uma linha com ID `publication-job:<uuid>` e tipo
`property_publication_job`. A identidade é a do pedido, não a tentativa.
Publicar e retirar na mesma versão são pedidos distintos. Retry atualiza o
estado da mesma linha; nova solicitação mantém seu próprio ID. Eventos legados
continuam visíveis, sem deduplicação especulativa por título, minuto ou versão.

O título explicita solicitação, canal e estado. Pendente, processando, retry,
falha e substituição não são chamados de conclusão. O horário principal é o
da criação do pedido, como na Central; `completed_at` segue separado nos
metadados. Isso é uma projeção do estado atual de cada pedido, não uma nova
auditoria imutável de cada transição/tentativa.

A projeção usa somente job_id, canal, ação, estado, versão, contadores,
requested_by e completed_at. Não copia snapshot, URL, caminho Storage,
idempotency key, hash, erro bruto, e-mail ou dados de proprietário. O diálogo
legado usa o título desse tipo e identifica o usuário resolvido como
**solicitante**, sem atribuir a execução do worker a ele e sem fallback para
e-mail. A categoria Publicação do workspace já reconhece o tipo.

Os consumidores verificados são HistoryTab na ficha e PropertyHistoryDialog
na lista e no editor, todos pelo hook/cliente de histórico existentes. O
contrato Go/TypeScript/Zod já aceita tipos e metadados abertos, sem novo campo
obrigatório. Web nova aceita API anterior sem jobs; API nova mantém os campos
anteriores. Uma Web antiga ainda pode usar a frase genérica no diálogo para
o novo tipo durante troca gradual: coordenar a atualização de Web/API.

Não há migration, backfill, escrita de evento, mudança no worker, permissões,
grants, dependências ou estado de publicação. A Central continua sendo a fonte
operacional. O invalidator existente já alcança o histórico após comandos e
quando o polling da publicação termina; não foi criado polling paralelo.

O acréscimo ao repositório legado acima de 800 linhas limita-se ao CTE da mesma
consulta. Uma divisão futura pode extrair leitura/escrita de histórico como
responsabilidade, preservando seus filtros; não houve refatoração incidental.

## Verificações

- RED PostgreSQL anterior ao produto: a consulta real retornou 2 linhas em vez
  de 9; retry e limite também omitiram os jobs. Controles de legado e visibilidade
  permaneceram aprovados. O primeiro ensaio de fixture abriu `postgres` em vez
  do banco próprio e foi preservado separadamente como falha de harness,
  corrigida antes do RED válido.
- RED UI anterior ao produto: 9 casos, 6 falhas e 3 controles aprovados. SSR e
  diálogo Radix real exibiam “Editou o imóvel”. Uma falha anterior de empacotamento
  sem `process.env` também foi separada da evidência do defeito.
- PostgreSQL final: query real de `Repository.ListHistory`, pool ForceReadOnly
  e banco aleatório próprio no cluster descartável PostgreSQL 17.11/57924,
  identidade 7708517508995572152 conferida antes da execução. Nenhum SQL de
  produção foi copiado para o teste.
- A fixture mantém o predicado canônico completo de own/team/all, com duas
  organizações, próprios/outros imóveis e atores, negativas entre tenants,
  legado, campos nulos, todos os estados, duas ações versão 1, retry, releitura,
  metadados permitidos, ordem e limite 100. Não substitui autorização por função
  permissiva; as tabelas de equipe existem vazias. O ramo de liderança não é
  provado por essa fixture, nem HTTP/JWT/RLS integral.
- Runtime usa HistoryTab, classificador, controles de filtro, Zod e diálogo
  Radix reais, com transporte/hooks e dados sintéticos, rede bloqueada. SSR
  do diálogo mantém primitivas externas inertes. Não é E2E do aplicativo ou
  conexão com o provedor. Os testes não publicam nem retiram imóveis.
- GREEN final: PostgreSQL 16 testes/subcasos contando o pai, zero pulos;
  runtime novo 10/10 dentro do runner de formulários 144/144; imóveis 253/253;
  SSR legado 2/2; typecheck exit 0; lint exit 0, zero erros e oito avisos legados;
  auditoria 4/4 e `git diff --check` exit 0.
- `go test -count=1 -json ./apps/api/internal/properties ./apps/api/internal/publications`
  terminou em exit 0: 361 e 127 testes/subcasos aprovados, respectivamente.
  Houve 34 e três pulos: um é o teste novo sem opt-in no gate genérico,
  executado explicitamente acima; as outras 36 integrações não são declaradas
  aprovadas. A primeira auditoria apontou inventários antigos; os geradores
  existentes com `--write` e o gate final passaram, sem mudar verificadores.
- Logs, hashes e contagens finais constam em
  `D:/Vimob/outputs/vetter-property-publication-history-20261115/verification-summary.json`.

O runtime entra no runner de formulários existente, executado após Chromium.
O teste PostgreSQL tem step explícito no job PostgreSQL existente, opt-in de
escrita local e URL administrativa loopback; cria/remove somente seu próprio
banco aleatório. Nenhum job/dependência/serviço novo foi acrescentado.

## Impacto e reversão

Há uma leitura adicional dos jobs/versões no endpoint existente e novas linhas
na janela dos 100 eventos mais recentes. Jobs podem ocupar posições antes
ocupadas por eventos antigos; não se trata de exclusão de histórico. As colunas
e índices canônicos já existem. Não foi medido desempenho sob carga real.

Reverter o CTE/UNION e a apresentação do novo tipo restaura o readmodel anterior.
Preservar integralmente jobs, versões, eventos e estado do imóvel. Não há
replay, limpeza ou reversão de dados a executar. Sem commit, push, deploy ou
reteste de produção pelo autor nesta entrega.
