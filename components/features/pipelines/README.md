# Pipeline

A rota `/crm/pipelines` usa `PipelinesScreen` para o quadro, `LeadDetailDialog` para o lead e `StageOperationalRules` para a cadência da etapa. As leituras e mutações passam pelos hooks e por `lib/api/`; as permissões, o escopo da organização e as transações são conferidos novamente na API Go.

## Contratos que precisam permanecer alinhados

- O quadro consulta `/v1/pipeline-board` e as rotas de contagem, paginação e filtros da etapa. O filtro de equipe considera a equipe atual do responsável, com tratamento próprio para leads sem responsável. A chave de cache inclui organização, usuário, visibilidade e filtros efetivos.
- Abrir um lead exige uma leitura recente autorizada. Perda de acesso fecha o detalhe e remove sua cópia do cache. Erro temporário também fecha o detalhe até nova confirmação.
- Na Pipeline, o clique inicia o download do detalhe e mostra um carregamento sem dados pessoais enquanto confirma acesso. Essa leitura alimenta o cache e entrega ao pop-up um snapshot vinculado a organização, lead, versão da seleção e visibilidade. Se o snapshot e o cache ainda corresponderem, a montagem dispensa o segundo GET; o handoff vence em 30 segundos. Contatos mantém sua leitura nova ao montar. Revalidação em andamento bloqueia ações e transferência continua exigindo nova confirmação da capacidade de operação.
- O quadro mede a própria largura e altura, incluindo o espaço liberado pela sidebar, e adapta as colunas entre 240 e 288 px. Reduz espaçamentos em janelas baixas e mantém a tipografia legível. Medidas ficam congeladas durante o arraste; nenhum containment novo envolve os cards. O detalhe usa uma variante exclusiva da Pipeline com grade fluida, sem o salto de largura das laterais em XL. O drawer e as demais entradas do detalhe mantêm seu layout existente.
- No celular, as setas de etapa ficam sobrepostas nas laterais ao centro da altura visível da tela, fora do cabeçalho e da árvore de arraste. A superfície visual mede 36 px e a área de toque 44 px; os valores ficam em `config/pipeline-layout.ts`. Somente os botões recebem eventos, o espaço entre eles permite interagir com o quadro e cada extremidade desativa sua seta. A camada fica abaixo dos modais/drawers e respeita as margens de área segura. Erro crítico ou transição do quadro oculta a navegação. Para reverter apenas este ajuste, recoloque os botões no cabeçalho da coluna e remova as classes e constantes de navegação mobile.
- Mover um lead envia a etapa e a revisão exata (`updated_at`, sem conversão por `Date`) do snapshot que iniciou a ação. O arraste preserva essa revisão também durante a escolha do motivo de perda; uma atualização externa não a substitui. A API compara os dois campos sob o lock e retorna conflito antes de qualquer efeito comercial; o quadro desfaz a alteração otimista e atualiza os dados, exigindo uma nova decisão em vez de repetir o gesto antigo. Movimentos locais enfileirados só podem usar a resposta canônica do seu próprio predecessor. Clientes antigos sem revisão recebem conflito ao tentar mover um lead ganho/perdido para outra etapa.
- O movimento visual `move_lead` compartilha a transação comercial manual; lease, grafo imutável, autorização vigente do autor e ledger protegem os efeitos. Motivo de perda é configurável no nó e validado pela mesma regra. Código, configuração preparada, migração local e reversão estão no [runbook do comando](../../../../docs/runbooks/pipeline-stage-command.md), sem aplicação remota.
- Reordenar ou editar etapas envia a versão original de cada etapa. A API salva a lista em uma transação e recusa versões antigas, exclusões com histórico ou configurações vinculadas. O editor mantém o rascunho quando há conflito.
- Regras operacionais de cadência aceitam `pipeline_manage` ou `automations_manage`. A revisão impede sobrescrever a configuração de outra sessão; o editor preserva o rascunho e solicita atualização explícita.
- `stage_entered_at` mede o tempo na etapa atual. `first_response_at` e `first_response_seconds` são métricas distintas; a atividade de contato pode ser salva mesmo se o registro da métrica falhar, com aviso e repetição apenas da métrica.

## Impacto e validação

As proteções de cache e autorização evitam mostrar um detalhe antigo após mudança de equipe ou organização. Os conflitos impedem perda silenciosa de mudanças de etapa e cadência. O histórico ordena os eventos pela ocorrência e restringe os campos de auditoria retornados ao cliente.

Ao validar uma publicação, testar com administrador, líder e corretor em duas sessões; criar e editar cadência; mover o mesmo lead simultaneamente; conferir tempos, histórico e filtros com os dados reais; e observar carregamento inicial, reconexão e paginação em desktop e celular. Testes locais sem acesso ao banco operacional não comprovam esses fluxos integrados.

As regressões locais de abertura usam hooks e React Query reais com respostas sintéticas em `hooks/pipelines/pipeline-lead-opening.runtime.test.mjs`, sem servidor ou banco. Os helpers de handoff e autorização são cobertos por `lib/lead-read-snapshot.test.ts` e `lib/lead-operation-capability.test.ts`. O componente legado `LeadDetailDialog` integra os controles já existentes; novas responsabilidades de hidratação, rascunho e consulta foram colocadas em helpers/hooks separados. Sua divisão futura deve separar resumo, ações e overlays preservando os contratos de Contatos, Agenda e WhatsApp, sem refatoração incidental nesta correção.

A compactação tem testes de cálculo em `pipeline-screen/pipeline-layout.test.mts` e um harness Chromium com Board, LeadCard, Radix e arraste reais em `pipeline-screen/pipeline-board-responsive.runtime.test.mjs`. O teste `components/features/leads/lead-detail/pipeline-detail-layout.runtime.test.mjs` verifica a geometria com classes extraídas do componente e CSS compilado; ele não monta todos os hooks e fluxos do detalhe. Os três arquivos `*.runtime.test.mjs` podem ser executados com `node --test <arquivo>` e bloqueiam requisições externas. As imagens são sintéticas; o destino opcional `PIPELINE_VISUAL_ARTIFACT_DIR` substitui o diretório temporário padrão dos testes visuais.

Para reverter esse comportamento, remova somente os hunks de abertura verificada e as classes da variante Pipeline, restaurando a leitura na montagem e as dimensões anteriores; preserve alterações simultâneas de filtros e imóveis nesses mesmos arquivos. Não há migração, alteração de dados ou configuração remota associada a este ajuste.

## Correções da auditoria de 12–13/10/2026

Todas as alterações estão no checkout principal. Não houve deploy, migração operacional ou alteração de dados operacionais. "Implementado" abaixo significa código candidato e regressões locais; não representa homologação no banco operacional. As migrações candidatas foram exercitadas somente em fixtures sintéticas de um PostgreSQL temporário em loopback.

| Ponto | Resultado local / pendência |
| --- | --- |
| Salvar colunas existentes | Adapter e editor preservam `updated_at` original, inclusive microssegundos; a versão segue obrigatória no Zod e no servidor. |
| Reentrada manual de ganho/perdido | A regra já estabelecida nos ajustes paralelos de Contatos conserva o encerramento, imóvel e reserva. A reabertura continua explícita e executa seus efeitos próprios. Regressões Go de entrada/importação verificam essa preservação. |
| Ganho, perda e reabertura concorrentes | Serialização por organização/lead, revisão do GET autorizado, retorno canônico e rollback somente do patch próprio, inclusive se o card fechar durante a resposta. Timeout exige reconciliação e não declara que o banco desfez a escrita. |
| Status automático versus etapa terminal | Novas configurações e edições recusam resultado incompatível com `is_won`/`is_lost`. Configurações legadas requerem inventário no banco antes de correção de dados. |
| Alerta simples de inatividade | Executor, writer/API, controles e startup estão no código local. Permanecem desativados por padrão; ativação exige readiness e ação explícita. O editor preserva campos adicionais e `action_config`, com revisão da política e da automação. Ver limites abaixo. |
| Histórico omitindo eventos | Identidade, ator e contexto da transição impedem que feedbacks/atribuições distintos sejam descartados por texto ou fila iguais. Hidratação do histórico paginado e legado omite nome/avatar de participante estranho à organização, preservando participantes históricos legítimos. |
| Alteração de valores de negócio ganho | O salvamento preserva lançamentos/comissões existentes e informa que eles não foram recalculados, tanto no detalhe quanto no formulário real de edição. O resumo financeiro é invalidado no cache correto e atualiza ao retornar à aba. Não existe recálculo financeiro autorizado ou implementado nesta correção. |
| Salvar contato e selecionar imóvel | Trava síncrona impede envio duplo; revisão original evita sobrescrever outra sessão. Refetch conserva o rascunho e respostas antigas não fecham nem apagam uma edição nova. Rollback de imóvel remove somente o patch da própria operação. |
| Reabrir histórico e hidratar relações | Leitura cancelável e atualização ao montar; a revisão mais recente prevalece sem descartar detalhes omitidos pelo quadro. GET traz tags canônicas na mesma query; DTO legado sem tags não fabrica uma coleção vazia. |
| Quantidade e valor das colunas | Patch e rollback atualizam os dois agregados ao remover/reintroduzir o lead em uma visualização filtrada. |
| Cache após movimento/distribuição | Chaves de organização/lead/quadro corretas e reconciliação de `already_assigned`. Cache de tags/responsável também evita restaurar o quadro inteiro. |
| Remover a última tarefa da cadência | Confirmação explica que salvar cancela obrigações pendentes; rascunho é preservado se o salvamento falhar. |
| Desativar cadência | Texto corresponde ao cancelamento efetivo no servidor e distingue edição local de salvamento. |
| Coluna com histórico | Arquivamento de coluna vazia preserva histórico e permite reativação. Leads vinculados ou entradas ativas que usam esse destino bloqueiam a operação; erro lista categorias de dependências. |
| CRUD de automações | Erro de leitura deixa de parecer lista vazia; guardar/excluir/ativar têm bloqueio de concorrência, erros visíveis e controles identificáveis. |
| Registro manual de ligação | Resultado salva a atividade manual; não chama a API de telefonia indisponível. A métrica do primeiro contato continua separada e permite repetição só dessa métrica. |
| Anexo pelo histórico consultivo | `readOnly` impede a ação de anexar; capacidade de operação do lead não é substituída por permissão global. |
| Consultar tarefas/compromissos | Tarefas encerradas mostram roteiro e resultado sem ações; agenda pode abrir consulta sem liberar edição. |
| Rascunho de feedback | Cache observado, restrito ao QueryClient de acesso e organização/lead. Conserva rascunho por até 30 minutos sem observador; não usa armazenamento do navegador. Confirmação antiga não apaga texto novo. |
| Duplo registro de resultado | Ref e estado de envio cobrem toda a confirmação, inclusive a espera pela métrica de primeiro contato; formulário permanece ocupado. |
| Rascunhos e nome da coluna | Nome aceita 2–120 caracteres e conserva edição em erro. Configurações coordenam salvamento filho e confirmação de descarte. |
| Tipografia, documentos e carregamento | Portais do detalhe respeitam a variante Pipeline. Viewer tem cancelamento, timeout, download ocupado e erro PDF. Histórico da Pipeline usa paginação opcional no servidor e janela de renderização; SQL foi exercitado em fixture isolada. Paridade com dados operacionais permanece sem verificação. |
| Fuso, tracking e proposta | Escala manual usa fuso comercial e contempla a virada da madrugada. Tracking não confunde termo UTM com nome do formulário. Mudar para uma coluna chamada Proposta registra movimento, sem afirmar envio de proposta. |

O pop-up usa `useLeadSchedulePreview`: consulta 50 compromissos por página e identifica a lista parcial. A ordenação opcional `leadPreview=true`, restrita a `leadId`, traz abertos primeiro e encerrados recentes depois; projeção, autorização e mascaramento são os mesmos da Agenda. Demais consumidores mantêm `getScheduleEvents` e sua ordenação completa. Replicas antigas que ignoram o parâmetro conservam acesso pela paginação, mas só a API nova garante a prioridade dos abertos.

O histórico paginado é opt-in apenas na variante Pipeline. O endpoint legado e seu cache completo permanecem disponíveis para os outros consumidores. Projeções paginadas continuam arrays de eventos dentro da família `lead-history-v2`; bruto/cursor ficam separados, com organização e assinatura de acesso. Dois observadores compartilham a leitura; cancelamento, invalidação e Realtime também atingem páginas em andamento. Erros preservam as páginas já carregadas e permitem repetição. Uma página parcial não inventa eventos de criação/atribuição nem afirma que não houve primeiro contato. O cursor limita as seis fontes e usa uma cerca temporal; essa cerca não equivale a um snapshot MVCC. A fixture PostgreSQL verificou 57 ocorrências nas seis fontes, empates, cursores, cerca temporal e escopo da organização. Ainda é necessária a comparação no baseline completo, incluindo mudanças concorrentes e dados legados reais.

Respostas de status, feedback, imóvel, responsável e etapa respeitam a revisão do banco sem perder microssegundos. Relações omitidas conservam a leitura somente quando a FK não mudou; `null` e tags vazias explícitos continuam canônicos. O hook compartilhado de edição captura organização/ator/QueryClient, preserva a proteção de sessão adicionada pelos ajustes paralelos e reconcilia seu cache mesmo após fechar. Mudança de acesso limita a conclusão ao cache anterior. A UI usa uma geração de operação: trocar de organização e voltar não revive callbacks antigos. Rascunhos e eventos otimistas removem apenas seu próprio registro, preservando alterações concorrentes.

Depois do commit, Update/MoveStage/Assign reutilizam somente assinatura de avatar não vencida e validada para organização/lead. Miss não faz chamada ao Storage; GET/quadro continuam renovando assinatura. A transferência consulta a escala do membro escolhido, com cancelamento, sem buscar a semana de todas as equipes ao abrir o seletor. O evento realtime continua durável e síncrono: este ajuste não afirma que toda latência do endpoint foi eliminada.

O PostgreSQL portátil 17.11 foi iniciado somente em `127.0.0.1:58022`, fora do checkout, com dono e diretório de dados identificados. O SQL real passou nos 46 cenários de arquivamento, paginação/hidratação do histórico, tags canônicas e dois subcasos de preview da Agenda. O ensaio negativo de referência corrompida a usuário estrangeiro identificou um vazamento de nome/avatar; a proteção foi corrigida e retestada nos caminhos paginado e legado. Membros antigos/inativos/removidos, usuários legados da organização e administradores de plataforma continuam identificáveis quando legítimos. A fixture de leads usa `membership_generation bigint`, como a migração canônica; a fixture específica da Agenda verifica projeção/ordenação, sem atestar o contrato de geração de acesso.

Esses ensaios usam schemas mínimos sintéticos, não o baseline completo do Supabase nem suas sessões/RLS. A conexão Supabase disponível não autorizou leitura do projeto; não houve contorno por credenciais ou uso de produção como fixture. Permanecem inventário das configurações legadas, medição de volume/latência e validação com as permissões reais. A meta de milhares de usuários simultâneos não foi comprovada. Evidência local: `D:/Vimob/outputs/pipeline-postgres-local-2026-10-12-6fd82f1f/SQL-VALIDATION.txt` e `pipeline-history-participants-final-bigint.log` no mesmo diretório. Após as suítes, o servidor temporário foi encerrado normalmente (`pg_ctl`/foreground exit 0, porta fechada e PID ausente); runtime e evidências foram preservados, sem remoção de pastas ou interferência em outros serviços.

### Limite atual do alerta de inatividade

`stageconfig/inactivity*` possui writer/API, controles e registro no startup, todos condicionados à preparação e aos gates de ativação. A API atual aceita `last_interaction` com início na ativação, cadastro inicial desativado e ativação posterior explícita; não converte silenciosamente outro tipo de regra em alerta. `STAGE_INACTIVITY_WORKER_ENABLED` continua `false` por padrão. `last_interaction` exige cobertura comprovada de fatos; ausência de fatos históricos parciais não comprova inatividade. Editar o alerta preserva `action_config` e extensões não pertencentes a esse editor.

O candidato usa episódios duráveis, revisão/época de ativação, dedupe, paginação limitada, transações separadas por política/job e até cinco tentativas com espera crescente. Confere novamente organização, módulo, etapa, automação, lead e destinatário ativo antes da notificação interna. Reabertura renova o episódio; edição comum e troca de responsável conservam o relógio. Imports silenciosos e leads com efeitos suprimidos ficam excluídos. As classificações existentes de interações humanas são preservadas; ações automáticas não reiniciam a contagem. Nenhum envio externo é acrescentado. A ordem lead → job evita disputa com exclusão em cascade; destinatário ocupado é consultado com `SKIP LOCKED` e adia o aviso por dois minutos sem consumir tentativas, permitindo a remoção/transferência de usuário.

O índice da tabela pública de leads foi separado em cutover concorrente fora da transação da migração. A verificação de readiness exige definição exata, índice válido/pronto e tabelas privadas antes de processar jobs. Não aplicar migração/cutover ou ativar esse executor sem revisão de permissões e validação no baseline completo. A aprovação dos testes sintéticos não comprova sua disponibilidade no ambiente operacional.

Contrato, matriz de interações, limites, cutover e reversão: [runbook do candidato](../../../../docs/runbooks/pipeline-stage-inactivity-local-2026-10-13.md). A rodada final executou 32 cenários SQL e terminou com exit 0; o prazo de preparo da fixture é separado dos prazos de operação do worker. A fixture constrói uma URL de banco aleatório próprio e confirma `current_database()` antes de DDL. Log preservado: `D:/Vimob/outputs/pipeline-inactivity-final-2026-10-13.log`.

Os repositórios Go legados receberam somente integração no caminho existente. Novas projeções/políticas foram separadas em `lead_detail_tags.go`, `stage_archive_policy.go` e `schedule/lead_preview.go`; uma divisão futura deve separar leitura, mutações e reentrada sem mudar a transação ou a autorização. Reversão deve remover os hunks por contrato e seus consumidores juntos, preservando mudanças concorrentes de Contatos, Imóveis, Agenda e WhatsApp. Não restaurar arquivos inteiros de `main` nem aplicar reset sobre o checkout compartilhado.

O refresh financeiro depende de três integrações pequenas: invalidação de `financial-dashboard` no QueryClient da operação; invalidação por organização no `LeadRealtimeBus`; refetch de dashboard stale ao montar. Reverter somente esses hunks e seu teste mantém a regra de preservação financeira. `LeadDetailDialog` e `CreateLeadDialog` são legados grandes; receberam integração estreita com helpers separados para salvar, rollback e aviso. A divisão futura deve separar formulário/resumo/ações sem alterar os contratos compartilhados de Contatos.

### Validação desta rodada

- `npm run typecheck`: repetição global de 13/10 passou. A rodada anterior encontrou dois erros em fixtures de Gerenciamento; correções estreitas ajustaram o tipo do callback ao contrato real `QueueMemberDraft` e removeram a extensão `.ts` do import, sem relaxar o compilador ou mudar as asserções. Os 17 testes desses arquivos também passaram.
- `npm run lint`: repetição global de 13/10 concluída com zero erros e cinco avisos nos ajustes paralelos de WhatsApp/Imóveis (`ConversationsScreen`, navegação/paginação de mensagens e fixture de elegibilidade de imóvel). O lint focado das últimas integrações de Financeiro e das duas fixtures de Gerenciamento passou sem avisos. Nenhuma regra foi suprimida.
- `go test ./internal/leads ./internal/schedule ./internal/pipelines ./internal/stageconfig`: passou em 13/10. `stageconfig` foi repetido com `-count=1` após os últimos ajustes de locks e passou. Nessas execuções normais os ensaios opt-in de banco não foram habilitados; os resultados SQL abaixo vêm de rodadas separadas com PostgreSQL real local.
- Regressões de UI usam React/Radix/QueryClient reais com transporte, identidade e dados sintéticos. Cobrem falhas, troca de escopo, concorrência, rascunhos, viewer e geometria. Esses testes bloqueiam rede externa e não usam contas reais.
- A abertura/edição passou em 26 cenários com hooks reais; status/escopo passou em 37. Comparação de revisão, hidratação e merge canônico passaram nos 14 testes puros. A paginação passou em 17 testes de coordenação/mutações, 12 de blocos/API, 4 DOM e 8 Go. São resultados de regressões locais desta auditoria, não provas de produção.
- Salvamento/rascunhos/seleção de imóvel: 19 cenários de React e handlers/effects reais; aviso financeiro: seis testes do helper e seis do submit real do formulário. Refresh financeiro: dez cenários com hooks/QueryClient/RealtimeBus reais e transporte sintético, incluindo mudança de organização, cache antigo, falha/incerteza e retorno à aba. Merge do cache passou em cinco casos.
- Três fixtures de regressão de anexos/imóveis corrigiram somente a variável local reservada `module`, preservando os contratos do VM; os 42 testes envolvidos passaram. As proteções paralelas de intenção de sessão e autorização permaneceram nos hooks compartilhados.
- SQL PostgreSQL real local: 46 cenários de arquivamento; seis subcasos de paginação/contexto/tags/hidratação de participantes; dois subcasos de preview da Agenda. O schema é sintético e mínimo. Baseline completo, RLS, configuração operacional e latência real continuam sem verificação.
- Inatividade: `go test ./internal/stageconfig -count=1 -v -timeout=20m`, com opt-in de escrita somente no servidor sintético loopback, passou com os 32 cenários PostgreSQL habilitados (203,207 s do pacote; não é benchmark). Inclui reprodução do deadlock antigo, exclusão/transferência corrigidas, destinatário ocupado, réplicas/dedupe, retry/dead, duas falhas lentas independentes, fairness, liberação de outro lead com NOWAIT, ausência de envio externo e recusa de roles de browser. As falhas anteriores de preparo e os resultados anteriores à correção não foram tratados como aprovação.
- `node scripts/supabase/verify-migrations.mjs`: passou no snapshot com 216 migrações após acrescentar somente o hash da migração candidata de inatividade, preservando todos os hashes existentes. A repetição final terminou com exit 1: os ajustes paralelos criaram os arquivos ainda vazios `20261013033722_management_distribution_read_authorization.sql` e `20261013033953_management_tag_reparent_and_automation_events.sql`. Esses arquivos foram preservados para seus responsáveis; nenhum hash deles foi aprovado nesta tarefa. O hash do candidato de inatividade permanece idêntico ao validado. A cadeia global precisa ser verificada novamente após concluir esses arquivos; não está aprovada no estado final compartilhado. Verificar fontes não autoriza aplicação.
- `git diff --check` dos arquivos relacionados passou. Não há afirmação de build/deploy, funcionamento em produção ou aprovação de todos os pontos pendentes acima.

### Tags compactas — 13/10/2026

As tags dos cards da Pipeline usam fonte de 10 px e altura de 18 px; o contador
de tags adicionais também usa 10 px. O ajuste fica restrito aos seletores de
tags em `PipelineBoard.module.css`, preservando cores, texto branco e os demais
rótulos do card em 12 px. A interface de Conversas não recebeu esse estilo.

Os oito testes existentes de UI da Pipeline passaram com componentes reais e
rede externa bloqueada, cobrindo desktop, telas de 320/390 px, arraste e camadas
dos pop-ups. A fonte e a altura também foram conferidas na Pipeline local.
O lint dos arquivos alterados passou. Os comandos globais de lint e typecheck
excederam 180 s sem diagnóstico nesta rodada, portanto ficaram inconclusivos.
Não houve deploy ou alteração em produção.

### Ações das colunas vinculadas à sessão — 20/10/2026

Criar pipeline/coluna, editar/reativar/arquivar coluna, reordenar e criar
automação comum capturam organização, usuário, SID e acesso ao QueryClient no
gesto, antes dos awaits do React Query. O transporte recebe identidade esperada
e AbortSignal, sem repetição automática de escrita; as respostas também passam
por validação de identidade. Refresh de token no mesmo SID preserva o gesto.

Após troca de acesso, callbacks e respostas antigas não fecham nem limpam um
editor novo, não liberam seu salvamento e não invalidam seu cache. Fechar apenas
o painel mantém a reconciliação do cache do mesmo acesso, sem refetch oculto.
Cancelar no navegador não desfaz um commit já aceito pelo servidor.

Escopo, regressões e reversão conjunta de UI/hooks/transporte estão no
[runbook P3 das colunas](../../../../docs/runbooks/pipeline-columns-session-p3-fix-2026-10-20.md).
