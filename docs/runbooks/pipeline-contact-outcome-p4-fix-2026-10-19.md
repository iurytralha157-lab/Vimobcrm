# Pipeline: repetição segura dos resultados rápidos de ligação e e-mail

19/10/2026. Item 07/P4 da auditoria t927. Checkout principal
`D:/Vimob/workspaces/vimob-crm`, main, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, preservando o trabalho local anterior.
Evidências externas: `D:/Vimob/outputs/pipeline-contact-outcome-p4-fix-20261020-z077`.
O nome da pasta de evidências contém dia20 por engano; o lote é de19/10.

## Causa e solução

LeadCard e LeadDetailDialog registravam o resultado pelo POST genérico de
atividades. Cada confirmação fazia um INSERT independente. Se a transação
concluísse e a resposta se perdesse, repetir a confirmação criava outra atividade.
Busy no componente impedia alguns cliques simultâneos, mas não resolvia esse
resultado incerto, nem coordenava dois componentes do mesmo lead.

As duas entradas agora usam POST `/v1/leads/{id}/contact-outcomes`. O comando
contém UUID, canal, resultado e anotações; o servidor deriva o tipo, conteúdo e
metadados da atividade. Aceita cinco resultados de ligação e três de e-mail,
com até 2.000 caracteres Unicode nas notas, sem NUL. Não aceita tipos de tarefa,
conteúdo ou metadados arbitrários.

Uma transação bloqueia e autoriza o lead atual, verifica o bolsão, reserva um
recibo privado, insere a atividade e completa o recibo antes do COMMIT. A chave
organização/ator/comando é única. O hash vincula lead, canal, resultado e notas
normalizadas. Repetir o mesmo comando devolve o ID e horário originais. Alterar
seu payload retorna 409. Falta de tabela/esquema/ACL retorna 503, sem fallback
para o INSERT genérico. O recibo não guarda notas nem possui FK/cascade ou TTL:
excluir uma atividade não permite que a repetição a recrie. Replay passa pelas
mesmas verificações atuais de acesso; o recibo não concede uma permissão.

O QueryClient do acesso guarda o comando imutável até confirmação. Filtros,
realtime, remontagem do card e fechamento/reabertura do popup preservam essa
identidade. Um mutex compartilhado por organização/ator/SID/lead/canal cobre
também a espera pelo primeiro contato. Novas notas após falha ficam separadas
do payload pendente: a repetição confirma o registro anterior, mantém o texto
novo e informa isso sem enviá-lo automaticamente. Um gesto posterior à
confirmação recebe outro UUID, permitindo duas tentativas legítimas iguais.

O ACK precisa corresponder ao comando, lead e canal e conter ID/data válidos.
Callbacks de acesso aposentado não podem restaurar cache, limpar outro draft
ou iniciar envio. O hook novo invalida o histórico no bloco protegido, sem
agendar um timer que sobreviva à sessão. Comandos pendentes permanecem em
memória; os confirmados e locks liberados não ficam presos indefinidamente.

O diálogo de resultado compõe seleção e notas com a última edição síncrona,
evitando que a notificação assíncrona do cache faça uma digitação rápida apagar
a seleção. Limites, cancelamento e busy existentes continuam valendo para os
outros consumidores; seus testes precisam passar sem enfraquecimento.

## Escopo e limites

Primeiro contato continua uma operação separada, somente após ACK do resultado.
Seu botão de repetição executa apenas a métrica. Telefone/Gmail não são abertos
pelo replay. Cadências continuam no endpoint por tarefa; WhatsApp e o POST
genérico de atividades não foram redirecionados. O item seguinte da auditoria
e a restrição de tipos reservados continuam fora deste lote.

A identidade pendente fica no QueryClient, sem localStorage/IndexedDB. Um
reload completo, fechamento do navegador ou substituição desse cliente perde
essa identidade. Uma nova ação depois disso pode ser outra tentativa; este
lote não promete reconciliação offline entre sessões/abas ou após reload.
Não remove duplicatas históricas e não altera a semântica temporal anterior do
primeiro contato, que pode ser registrado depois de um ACK recuperado.

Os componentes legados recebem apenas o wiring necessário. API, validação,
estado e persistência ficam em módulos do domínio. O crescimento dos arquivos
legados não inclui refatoração incidental; a extração futura dos handlers pode
reutilizar esta matriz de regressões. Primitivos de components/ui preservados.

## Entrega futura, sem execução neste lote

A migration append-only
`20261019214356_add_lead_contact_outcome_command_receipts.sql` foi criada pelo
CLI e ficou somente no código local. A entrega futura precisa aplicar essa
DDL pelo processo aprovado do projeto, validar a role backend autorizada,
publicar a API compatível e depois disponibilizar o frontend. Não usar
`supabase db push`: o ledger do projeto continua bloqueado conforme seu README.

O frontend novo com servidor antigo ou recibos ausentes falha de modo seguro e
preserva a tentativa; não se deve publicar apenas essa metade da mudança.
Nenhum deploy, migration aplicada, commit, push, dado real ou serviço iniciado
faz parte desta autorização. Resultados locais não certificam o banco/versão
instalados em produção, iPhone físico ou carga de 300 usuários.

## Verificação e preservação

Os logs e recibos em z077 registram a reprodução, regressões, testes de navegador
com transporte sintético, testes Go e SQL em PGlite efêmero. PGlite executa SQL
real sequencialmente; não prova concorrência entre sessões PostgreSQL reais.
Testes pgx simulam concorrência, ACK perdido, rollback e revogação. Os testes
Go opt-in que exigem banco/fixtures devem aparecer como skips, nunca como pass.

Snapshot inicial: 4.100 fontes. A comparação final deve permitir somente arquivos
deste lote e relatórios derivados revisados, preservando os seis itens anteriores
e as outras abas. Para reverter, comparar os hunks com before/ e hashes, sem
resetar o checkout ou restaurar arquivos inteiros com trabalho anterior.

O fechamento deste item significa 7/14 corrigidos localmente, com sete pendentes;
não representa aceite da Pipeline inteira para publicação. Os totais finais e
comandos verificados estão nos recibos de fechamento deste lote.

## Resultado dos testes

- Reprodução RED com os handlers anteriores: os dois casos de COMMIT incerto
  terminam com duas atividades em vez de uma. Mesmos casos corrigidos aprovados.
- Cliente: 160/160 testes de runtime aprovados (57 primeira resposta, 23 draft,
  15 ações rápidas, 21 mutation hook, 44 API/validação), sem skips. Incluem perda
  de ACK, comandos concorrentes, notas alteradas, reabertura, troca de acesso,
  ausência de fallback e ACK inválido. NUL, calendário/hora inválidos e offset
  impossível são rejeitados antes de confirmar ou prender um comando inválido.
- Chromium isolado: 18/18 cenários novos aprovados em 390 e 1366 px, card/popup,
  ligação/e-mail, cancelamento/reabertura, remount, replay e novo gesto legítimo.
  Os 56 cenários existentes do diálogo/cadência e quatro de draft/preview também
  passaram. Total: 78 casos de navegador e 160 de runtime; não somar repetições.
  Sem pageerrors ou rede externa. Transporte/ledger são sintéticos: esses testes
  executam UI/handlers reais, mas não uma API ou banco de CRM autenticados.
- O harness antigo de draft/preview precisou acompanhar o acesso protegido já
  existente no viewer. Auth/assinatura foram isolados sinteticamente, mantendo
  hook, viewer e as 15 assertions originais. Nenhum ajuste no produto de anexos.
- Go novo: 11 testes principais e 43 subtestes aprovados, sem skips. Pacotes
  leads/app completos: 703 principais e 2.633 subtestes aprovados; 66 principais e
  86 subtestes opt-in pulados por ausência de banco/fixtures. Zero falhas. Não
  contar testes focados novamente no total dos pacotes completos.
- SQL: 26 grupos em PGlite 0.5.9/PostgreSQL 18.6 aprovados com migration literal
  e SQL extraído de Go. Verifica PK/isolamento, ACL/RLS inclusive service_role,
  rollback, retenção e replay. A concorrência Go é simulada; PostgreSQL real
  com várias conexões permanece fora da prova deste lote.
- Typecheck, ESLint e audit:check aprovados. Lint global mantém sete avisos
  anteriores, zero erros; os arquivos deste lote não acrescentam avisos. Os
  inventários foram regenerados e comparados: mesmas rotas, regras, contagens e
  controles; somente digests, IDs derivados e localizações acompanham o código.

A revisão independente final conferiu as fontes finais do draft e do schema,
inclusive guard de acesso, busy após ACK e data parseável do recibo. A comparação
SHA256 final preserva 4.086 das 4.100 fontes anteriores; 14 existentes alteradas
conforme allowlist e 14 novas. Git anterior: 2.589 entradas locais; nenhuma foi
removida. O relatório preservation-receipt.json contém a matriz e os hashes.
