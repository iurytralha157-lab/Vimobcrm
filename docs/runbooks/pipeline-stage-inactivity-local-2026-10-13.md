# Executor de inatividade das etapas da Pipeline

## Redistribuição por inatividade

O writer aceita `action=redistribute` com `target_round_robin_id` para uma
distribuição ativa acessível no mesmo tenant. Exige permissões de automações e
distribuição. Cada coluna pode ter uma redistribuição ativa junto de uma regra
de mudança de etapa. As duas revalidam o estágio atual e o ciclo do lead no
momento da execução. Sair da coluna encerra a elegibilidade das regras dela.

O worker revalida o gestor, o lead aberto e a distribuição. Usa o alocador
canônico e aceita uma atribuição diferente na distribuição escolhida. O destino
definido pela distribuição pode mover o lead para outra coluna aberta. O
trabalho rejeita destinos terminais e trajetos que voltem para a coluna de
origem por outras automações de inatividade. Atribuições protegidas pela fila
continuam protegidas. Fila sem disponibilidade ou seleção do mesmo
responsável preservam a atribuição e a coluna e seguem as tentativas limitadas
do executor. Alterações no lead, efeitos do alocador e conclusão da tarefa
confirmam na mesma transação.

Aplique `20261108085140_stage_inactivity_redistribution.sql` após a migração
do escopo de novas entradas e antes do binário da API. Ative a ação somente
depois de atualizar todas as réplicas do worker. Para reverter o binário,
pause as regras de redistribuição e desligue o worker em todas as réplicas.
As colunas e o índice adicionados podem ficar no schema para conservar o
histórico. A reversão de schema exige uma revisão separada que preserve os
registros de execução e trate as políticas com o novo tipo de ação.

## Escopo de leads na ativação

A API de configuração aceita `start_mode` com dois valores:

| Valor | Leads considerados |
| --- | --- |
| `new_stage_entries` | Leads que entram na coluna após a ativação. Inclui um lead existente que entrar depois e exclui um lead antigo que apenas seja reaberto na mesma coluna. |
| `activation` | Inclui leads já na coluna. A contagem completa começa na ativação ou na última atividade posterior. |

Uma criação pela API sem esse campo conserva o comportamento `activation`. Uma
edição que omita o campo preserva o escopo gravado quando ele é uma dessas
opções. Alterar o escopo inicia uma nova época e contagem, e os jobs da época
anterior são invalidados. O editor pode oferecer `new_stage_entries` como
seleção inicial segura. A API continua recusando `include_overdue` para
novas configurações. O worker pagina por ID mesmo quando uma página inteira
contém somente leads fora do escopo e revalida o escopo antes de executar a ação.

Aplique `20261108085114_stage_inactivity_new_stage_entries.sql` antes de usar
esse escopo e atualize todas as réplicas do worker antes de ativar regras com
ele. Versões anteriores reconhecem apenas os escopos originais. Para reverter
o binário do worker, desligue-o em todas as réplicas e pause as regras de
novas entradas primeiro. O constraint ampliado aceita as gravações antigas
e pode permanecer. Reverter a migration requer uma nova revisão de schema
depois de resolver explicitamente todas as políticas com o novo valor.

## Atualização local de 16/10: vínculo da captura com a regra atual

O registro original abaixo descreve o candidato de 13/10; não deve ser usado
como inventário atual da integração. O código local agora inclui writer/API,
formulário e registro do worker, mantendo a habilitação explícita desligada por
padrão. Nesta correção nenhuma flag, configuração remota ou serviço operacional
foi alterado.

A migration forward `20261016164738_fence_stage_inactivity_fact_capture.sql`
corrige somente o ramo de inatividade de `private.record_lead_action_fact`.
A política deve apontar para a mesma automação, organização, etapa, revisão
exata e tipo `inactivity`. Uma política antiga deixada após reclassificação da
regra não amplia a captura. Os ramos de atenção/cadência continuam independentes.

Captura de fatos continua permitida com política desabilitada ou automação
inativa, desde que esse vínculo permaneça válido: isso preserva cobertura antes
da ativação e durante pausa. A execução dos alertas mantém seus filtros de
habilitação e atividade. Não há backfill, exclusão de fatos, grant novo ou lock
de automação/política no produtor; ele conserva o lock do lead e a leitura MVCC.

Validação de 16/10: pacote Go `stageconfig` completo com PostgreSQL local e
opt-in explícito, 188 resultados de testes/subcasos, 42 testes principais,
zero falhas/skips. Inclui a reprodução anterior seguida da aplicação real da
migration, identidades inválidas, pausa/ativação, atenção/cadência, concorrência
pré/pós COMMIT e privilégios. Os dois contratos SQL e o source-lock de 240
migrations passaram. [Evidências e limites](../audits/pipeline-detailed-review-2026-10-16.md).

Nenhuma migration foi aplicada ao banco operacional. Publicação futura deve
incluir essa migration na cadeia revisada antes da ativação e respeitar o
bloqueio de `db push`. Reversão deve ser uma nova migration revisada; restaurar
a definição anterior reintroduz o problema, sem apagar fatos já persistidos.

## Registro original de 13/10 — contexto histórico

O checkout principal contém um candidato de executor para as automações simples
de inatividade, com episódios duráveis e notificações internas. Ele permanece
desligado: não existe writer da política, formulário dos critérios novos,
variável de ambiente ou registro do starter em `app.go`. A migration cria
tabelas vazias e não ativa nem converte as regras legadas. Não houve deploy ou
alteração de banco remoto.

O domínio é `apps/api/internal/stageconfig`. O executor de fluxos visuais em
`automations` continua separado. As alterações de outras abas são preservadas.

## Contrato explícito da política

| Campo | Regra |
| --- | --- |
| `clock = stage_entry` | Usa entrada na etapa ou início de um novo ciclo de reabertura. Interações não reiniciam esse relógio. O aviso fala em prazo da etapa. |
| `clock = last_interaction` | Usa a última atividade qualificável canônica, excluindo automação e preservando respostas humanas recebidas. |
| `start_mode = activation` | O relógio nunca começa antes de `activated_at`, mesmo para leads antigos. |
| `start_mode = include_overdue` | Permite prazo já vencido, limitado à cobertura histórica efetivamente comprovada. |
| `interaction_coverage_from` | Obrigatório em `last_interaction`. Ausência de fatos anteriores não comprova ausência de atendimento. O relógio não começa antes da cobertura atestada pelo servidor. |
| `activation_epoch` e `activated_at` | Identidade e data específicas de cada ativação ou reativação; nunca usam `updated_at` como substituto. |
| `automation_updated_at` | Fence exato contra edições da automação legada. Uma configuração diferente impede execução. |
| `revision` | Fence de edição da política. Não repete uma notificação já criada para o mesmo episódio. |
| `duration_days` | Inteiro entre 1 e 3650. Cada dia representa 24 horas de tempo decorrido. |

Não há valor implícito para relógio ou tratamento de backlog. O futuro writer
deve validar organização, etapa, automação de tipo `inactivity`, módulo e
permissão atuais no servidor, além do CAS da revisão. Datas, época e cobertura
não devem ser aceitas como alegações livres do browser.

A cobertura futura de fatos depende de uma política habilitada e da revisão
correspondente da automação. Desativação e divergência do CAS podem criar
lacunas. Reativar exige nova época e uma nova cobertura desde a ativação, ou
prova de captura completa no intervalo. Histórico parcial não autoriza manter
uma cobertura anterior por conveniência.

## Atividades e ciclos

| Origem ou transição | Comportamento |
| --- | --- |
| Ligação, e-mail, mensagem, WhatsApp, conclusão de tarefa, feedback e nota | Seguem `qualifies_stage_inactivity` do classificador de atividades existente. O candidato não redefine os tipos. |
| WhatsApp enviado por humano ou resposta recebida | Preserva a classificação canônica de interação. A definição de fato é atividade persistida; não comprova, por si, entrega por um provedor. |
| Automação ou IA | `is_automated = true` não reinicia `last_interaction`. |
| WhatsApp suprimido, efêmero, promovido, observado sem atendimento ou reação | Os guards atuais dos produtores continuam aplicáveis. Não se fabrica atividade dessas fontes. |
| Importação histórica silenciosa | `operational_effects_suppressed` e o helper de capacidade histórica impedem captura e execução. Um job pendente suprimido depois é cancelado. |
| Mudança de etapa | Um novo scope identifica o episódio; o job anterior falha na revalidação canônica. |
| Ganho ou perdido | A execução deixa de ser elegível. Não reabre o lead nem altera imóvel ou financeiro. |
| Reabertura na mesma etapa | Renova um scope existente e começa no momento da reabertura, inclusive se a política estava desligada. Não cria scope para legado sem política ou scope anteriores. |
| Troca de responsável | Preserva o relógio; resolve o destinatário atual no momento da criação do aviso. |
| Responsável ausente, inativo, removido ou com lock concorrente | Aguarda por dois minutos, sem consumir tentativas de erro. Não escolhe gestor alternativo. |

A notificação é destinada somente ao responsável com conta e membership
vigentes na organização, incluindo `membership_generation`. A transação mantém
o lead e o vínculo protegidos até confirmar o aviso. Não inclui intenção de
WhatsApp, push ou e-mail. O produtor normalizado existente e seus patches atuais
continuam processando `notifications`; a fixture executa esse caminho real.

## Transações e limites

- O ciclo tem limite de 45 segundos, com janela de scan separada de 15 segundos.
  Não inicia outro scan sem reserva para a fase e sua recuperação. Falha de scan
  adia sua próxima consulta por CAS de organização, época e revisão; a fila de
  avisos conserva uma janela de trabalho mesmo com etapas ocupadas.
- Cada scan processa no máximo 100 leads de uma política em uma transação de
  seis segundos. Usa cursor por UUID e advisory lock transacional. O commit
  acontece antes de qualquer criação de notificação.
- Cada job tem sua própria transação de oito segundos, com statement e lock
  timeout de dois segundos. Claims usam `SKIP LOCKED`; uma falha posterior não
  desfaz o resultado ou tentativa de outro job.
- A ordem de locks é organização, pipeline, etapa, automação, política, lead,
  job e destinatário. O lead é adquirido com `SKIP LOCKED` antes de qualquer job,
  preservando a ordem da exclusão e seu `ON DELETE CASCADE`. O claim confirma o
  mesmo `lead_id`. O futuro writer deve preservar etapa, automação e política
  nessa ordem; não pode inverter pais e filhos na limpeza ou no CAS.
- A leitura do destinatário usa `FOR SHARE ... SKIP LOCKED` em usuário e vínculo.
  Se a remoção de um usuário detém esses registros antes de transferir seus
  leads, o job libera o lead e aguarda dois minutos, sem erro nem nova tentativa.
- Época, scope, baseline e identidade do fato formam o episódio. Constraints e
  dedupe da notificação protegem reexecução e concorrência entre réplicas.
- Erros recuperáveis usam retry exponencial limitado a cinco tentativas, depois
  `dead`. Scan ou edição comum não redrive uma falha terminal. Falta de conexão
  pode impedir persistir um erro; nesse caso, o ciclo falha e conserva os commits
  anteriores. Não presume sucesso de um commit com resultado desconhecido.
- Panic é recuperado por fase e ciclo. Os contadores representam somente
  transações confirmadas. O canal retornado pelo starter permite esperar o
  encerramento; logs incluem contadores e códigos genéricos, sem dados pessoais.

## Banco e índice antes da futura ativação

`20261013015858_stage_inactivity_runtime_scaffold.sql` é aditiva, cria tabelas
privadas com RLS e grants restritos e amplia a captura somente para políticas
explicitamente habilitadas. Não contém backfill ou criação de índice na tabela
quente de leads. Os índices existentes de board têm outras ordenações e não
garantem o scan limitado por `(organization_id, stage_id, id)`.

O índice público está no cutover
`supabase/cutovers/20261013_prepare_simple_stage_inactivity_index.sql`: um único
`CREATE INDEX CONCURRENTLY`, fora de `BEGIN` e de batch de migrations. Aplicação
remota exige alvo conferido, autorização de rollout e respeito ao bloqueio de
`db push` em `supabase/README.md`. Não execute o arquivo como etapa incidental.

`IF NOT EXISTS` não prova que o índice está pronto: uma tentativa interrompida
pode deixar índice inválido ou com definição diferente. A API candidata verifica
`indisvalid`, `indisready`, método, três chaves na ordem exata, predicado e tabelas
privadas em `VerifyStageInactivityRuntime`. O ciclo recusa trabalho antes de
travar linhas de negócio se esse gate falhar. O futuro startup e writer devem
chamá-lo também.

Antes de registrar o worker ou configurar uma primeira política: revisar os
critérios com o usuário, validar a cadeia completa em banco descartável, checar
grants do papel real da API, medir os planos e a carga, implementar o writer e
sua autorização/CAS, registrar o starter no inventário e manter habilitação
explícita desligada por padrão. Não ativar regras legadas automaticamente.

## Verificação local e limites

Os testes usam PostgreSQL 17.11 descartável em loopback, com fsync e commit
síncrono. A fixture requer `LOCAL_WRITE_TEST`, cria e remove um banco com nome
aleatório próprio, constrói a URL de destino e confirma `current_database()`
antes de DDL. Não lê `.env` ou credenciais reais; o passfile do ensaio é vazio.

O schema público mínimo reproduz os campos consumidos, com duas organizações.
A migration candidata e o cutover concorrente são executados somente nesse
banco sintético. Os produtores reais de notificação normalizada, espera WhatsApp,
patches atuais de dispositivos e dedupe de distribuição são extraídos do fonte e
executados; um controle positivo de e-mail confirma que o hook está instalado,
sem executar envio externo. A capacidade de importação é simulada pelo retorno
do helper, não por teste do seu protocolo de autorização completo.

Os ensaios cobrem relógios, cobertura, revisão, reabertura, destinatário atual,
histórico silencioso, dedupe, réplicas, retry/dead, duas falhas lentas, fairness,
gates de índice e acesso negado às tabelas privadas por `anon`/`authenticated`.
O teste com barreira de notificação prova que outro lead já varrido aceita
`FOR UPDATE NOWAIT`, enquanto o alvo mantém a proteção da sua transação.
O ensaio de exclusão reproduz `40P01` na ordem antiga job→lead contra a FK real,
depois verifica que o worker corrigido permite a exclusão/cascade. O ensaio de
remoção de usuário segura usuário/vínculo antes de transferir o lead e prova
adiamento sem tentativas, seguido de notificação apenas ao responsável atual.

Rodada final em 13/10/2026: `go test ./internal/stageconfig -count=1 -v
-timeout=20m`, com o opt-in e URL local explícitos, terminou com exit code 0.
Os 32 cenários PostgreSQL passaram; o pacote completo terminou em 203,207 s.
Log preservado em `D:\Vimob\outputs\pipeline-inactivity-final-2026-10-13.log`.
O preparo da fixture tem orçamento próprio de dez minutos; os cenários têm
cinco minutos. Isso não altera os deadlines de 45/6/8/2 s do produto.

Isso não comprova o schema implantado, RLS completo do CRM, entrega no browser,
latência de produção ou capacidade para 5–6 mil usuários. Um skip ou falha de
conexão não é aprovação. A evidência cobre o candidato sem ativação: ainda não
há writer, UI, endpoint ou registro do worker no startup da aplicação.

## Reversão da futura implantação

Desligar primeiro o starter explícito em todas as réplicas e esperar seu canal
de conclusão. Desabilitar a política conserva jobs, épocas, fatos e histórico.
Não apagar ou reenviar notificações, não fazer backfill e não alterar entradas
financeiras como parte da reversão. A aplicação anterior continua com o CRUD
legado. A remoção do índice concorrente ou das tabelas exige revisão própria de
dependências e autorização; não há limpeza automática de dados no candidato.
