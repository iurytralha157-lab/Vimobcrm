# Google Calendar e Tasks: saida por tipo

Implementacao opt-in; o Vimob continua sendo a origem. Atividades task,
message, email e call vao ao Tasks somente quando a conexao tem routing_v2
e tasks_authorized. Meeting e visit continuam Calendar. Conexoes anteriores
mantem o protocolo Calendar ate o consentimento adicional. Nao ha importacao,
watch, convites nem exportacao automatica de historico na conexao.

## Contrato e dados

- O servidor deriva o destino; o navegador envia apenas o tipo CRM existente.
- google_sync_target informa calendar/tasks. google_task_id nunca ocupa o
  campo google_event_id. Respostas antigas sem os campos novos sao aceitas.
- A fila existente guarda protocol_version=2, target, event_id, owner,
  connection_id e IDs duraveis dos vinculos. A insercao e transacional com a
  mutacao CRM. O trigger valida tenant/dono e enriquece produtores anteriores.
- google_tasks_links separa tasklist_id/task_id, tentativa opaca de criacao,
  estado e versao da origem. vimob_event_id sobrevive ao hard-delete;
  schedule_event_id usa SET NULL. RLS e grants impedem browser/anon/auth.
- A lista dedicada tem nome Vimob, empresa e identificador opaco da tentativa.
  Esse identificador permite reconhecer uma criacao cuja resposta se perdeu;
  nao e token nem concede acesso. Uma lista pessoal de mesmo nome nao e adotada.
- O envio conserva a filtragem existente de dados autorizados do lead. Nao
  exporta propriedades nem transforma auxiliares em destinatarios.

## Autorizacao

O primeiro Conectar da interface solicita Agenda e Tasks juntos somente quando
o status do servidor informa tasks_available=true. Status antigo sem esse campo
ou com false conserva o login Calendar-only; o cliente de API tambem mantem esse
padrao. Conexoes antigas somente Calendar oferecem Autorizar Google Tasks como
upgrade explicito, preservando a conexao existente. Uma conexao ja autorizada
nao pede consentimento a cada login no Vimob.

A autorizacao e mantida por tokens no servidor e pode exigir reconexao se
expirar ou for revogada. Em um app OAuth External com publishing status Testing,
o Google expira a autorizacao e o refresh token em sete dias para os escopos
Agenda/Tasks. Isso e uma regra do ambiente de testes, nao de cada login CRM.
Referencia oficial: [Manage App Audience](https://support.google.com/cloud/answer/15549945?hl=en).
Esta alteracao nao publica o app Google nem muda seu audience/publishing status.

Habilitar Tasks API apenas no projeto Google do ambiente. O login opt-in pede
https://www.googleapis.com/auth/tasks alem de Calendar owned, openid e email.
O escopo Google permite todas as tarefas da conta; a aplicacao restringe suas
operacoes a lista e aos vinculos registrados para o tenant/conexao/dono.

O estado OAuth persiste enable_tasks. Permissao Tasks parcial falha antes de
qualquer escrita de token/conexao. Uma conexao routing_v2 sempre pede Tasks
tambem na reconexao. Vault e revisao da credencial continuam no servidor.
O SQL confirma o escopo no Vault antes de ativar o roteamento. Nenhuma chave
nova, credencial no browser ou permissao Data API e necessaria.

## Ciclo e resultados desconhecidos

Tasks recebe dia civil no fuso da organizacao; a API publica descarta horario.
Inicio/fim e lembretes continuam no Vimob; as notas informam o horario previsto.
Concluir produz completed; corrigir status para aberto produz needsAction e
limpa completed. Cancelamento historico remove a copia externa sem apagar o CRM.
Nao e adicionado botao de cancelamento para atividades simples.

Recorrencias sao ocorrencias materializadas pelo CRM, sem segunda serie no
Google. Regras existentes de historico e remarcacao continuam validas.
Meeting/visit nao podem virar atividade simples. Na direcao permitida, o novo
destino e confirmado e a copia anterior e removida antes de marcar synced.
Falha intermediaria mantem erro/pedencia; duas copias podem existir durante
a recuperacao. Transferencia de dono conserva a intencao de limpar a conta antiga.

Antes de um POST, uma RPC fenced registra reserved -> started. Somente a
transicao inicial permite criar. Timeout/5xx deixa started: a proxima tentativa
pagina a lista incluindo completed/hidden/deleted e procura o marcador exato.
Nao repete POST sem saber o resultado. Zero ou varios candidatos exigem revisao;
nao ha promessa de exactly-once da API externa. Resposta 4xx definitiva, exceto
408, permite resetar a intencao de tarefa sem efeito remoto.

Leases, revisao da credencial e snapshot sao conferidos antes de HTTP e commit.
Heartbeat invalida trabalho antigo apos reconexao. TaskID confirmado pode ser
retido para limpeza apos exclusao/troca local, sem marcar snapshot antigo como
synced. DELETE valida lista, identidade opaca e ETag; 404/410 confirma ausencia.
Uma identidade editada/ambigua para em conflito. Cada transporte Tasks tem
budget de 75s e paginacao de 60s; chamadas individuais tem deadline existente.
Se autorizar Tasks mudar o destino de um envio ja enfileirado, o worker confirma
uma nova intencao transacional com o destino derivado pelo servidor antes de
reconhecer o trabalho anterior. Falha ao confirmar essa intencao exige retry;
a troca de permissao nunca descarta silenciosamente uma atividade pendente.

## Publicacao somente no ambiente autorizado

1. Confirmar sentinel, ledger, SHA Web/API, bundles OAuth/sync e fila em voo.
   Preservar o SHA de reversao e a configuracao do ambiente. No piloto, conferir
   Calendar API, Tasks API, os escopos e o callback do cliente OAuth do ambiente.
   O servidor recebe `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e
   `GOOGLE_CALENDAR_REDIRECT_URI` pelo canal seguro do ambiente. Um novo cliente
   exige novo consentimento quando o anterior emitia os tokens existentes.
2. Confirmar os prerrequisitos Calendar de outubro no catalogo e no ledger.
   Depois reconciliar os tres forwards Tasks em ordem (`foundation`,
   `fenced_delivery`, `schedule_fk_index`). Aplicar somente o delta revisado.
   As consultas da API nova dependem dessas colunas mesmo com OAuth desativado.
3. Publicar OAuth/sync com os imports Tasks e comparar os arquivos efetivos.
   Worker usa claim v3; claim v2 continua callable mas nao recebe protocolo2.
   Os dois compartilham a exclusao por tenant+atividade.
4. Publicar Web/API compativeis com os novos campos; manter routing_v2 false.
5. Drenar leases anteriores. Concluir consentimento Tasks de uma conta piloto.
   Aumentar acesso exige consentimento pessoal no Google.
6. Criar dados sinteticos, verificar os seis tipos no provedor e testar edicao,
   conclusao, reabertura e exclusao. Para compromissos, preservar regras de
   historico: usar amostras distintas para concluir e excluir.
7. Conferir filas, IDs e ausencia de copias abandonadas, erros e vazamentos de
   tenant. Nao declarar E2E aprovado apenas por HTTP202 ou status do OAuth.

Rollback: impedir novas adesoes e pausar o produtor/worker de forma controlada.
Conservar schema, grants e vinculos. Nao voltar ao worker Calendar antigo com
intencoes Tasks pendentes. Reconciliar/concluir limpeza com worker compativel
antes de restaurar imagens anteriores. Gate OAuth nao pausa contas/fila existentes.

## Verificacao

Executar npm run test:agenda, validation:test, typecheck, lint; testes Go de
schedule/app/integrations; verificadores de migrations e Edge e semantic check.
O runner SQL Tasks aceita somente modulo PGlite absoluto e memory://, sem URL
CRM. Ele cobre SQL/ACL/duas organizacoes, mas nao prova concorrencia em Postgres
nativo. Concorrencia nativa e entrega Google sao verificacoes separadas.

Os adaptadores Tasks foram separados por responsabilidade em api, delivery e
runtime, todos abaixo de 400 linhas. O shared Calendar legado acima de 800 linhas
recebe apenas a ligacao ao fluxo atual; sua divisao completa fica fora deste corte.
