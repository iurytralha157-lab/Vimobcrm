# Pipeline: resultado de mensagens sugeridas nas cadências

19/10/2026. Item 08/P4 da auditoria t927. Checkout principal
`D:/Vimob/workspaces/vimob-crm`, main, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com o trabalho anterior preservado.
Evidências: `D:/Vimob/outputs/pipeline-cadence-message-outcome-p4-fix-20261019-a088`.

## Causa e comportamento corrigido

Uma tarefa `message` pendente, com `recommended_message` e sem `observation`,
abria o WhatsApp diretamente. O retorno antecipado acontecia antes de verificar
`outcome_required`. A única ação da linha não oferecia registrar resultado nem
concluir a tarefa. O chat recebia somente o texto; não recebia taskId e não
fechava esse ciclo. Com observação preenchida, o preview já oferecia as ações.

Agora a mensagem sugerida abre o mesmo preview existente, com ou sem roteiro.
O usuário escolhe duas ações independentes:

- **Preparar mensagem:** preenche o chat, depois das permissões e telefone serem
  conferidos. Não envia a mensagem, não conclui a tarefa e não registra atividade
  ou primeiro contato. Voltar sem enviar mantém a tarefa pendente e permite abri-la outra vez.
- **Registrar resultado:** quando configurado como obrigatório, abre o diálogo
  existente com os resultados de mensagem. Só o resultado confirmado passa pelo
  endpoint canônico de conclusão da cadência.
- **Concluir tarefa:** substitui a ação anterior quando o resultado é opcional.
  A conclusão acontece somente pelo clique explícito, com `outcome=done` como
  antes. Preparar a mensagem não dispara esse clique.

A ação do preview relê a tarefa do estado atual, verificando lead, pendência e
ciclo aberto. Uma mudança de regra/texto utiliza a tarefa canônica atual. Lead
fechado, tarefa retirada/concluída, bolsão, leitura sem operação e callback de
visita aposentada não iniciam a ação. O preview passa a ser de consulta quando
a tarefa deixa de ser operável. Falta de telefone/permissão para preparar não
fecha o preview nem impede o registro manual autorizado.

O handoff da cadência captura o acesso antes de fechar o lead e o confere também
na microtask que abre o chat. Fechar normalmente continua permitindo a abertura;
trocar sessão/ator/organização ou aposentar o QueryClient não reaproveita esse
callback. O guard é um argumento opcional do helper local: a abertura comum de
WhatsApp, inclusive somente leitura, preserva seu contrato de um argumento.

## Escopo preservado

Produto alterado somente em `LeadDetailDialog.tsx` e
`lead-detail/LeadDetailOverlays.tsx`. Os mounts desktop/mobile e o consumidor
compartilhado de Contatos usam o mesmo fluxo. A apresentação mantém o preview
e o diálogo existentes, suas fontes e dimensões. Outros tipos sem mensagem
sugerida seguem seus caminhos anteriores. Chamadas/e-mail com roteiro continuam
respeitando a exigência de resultado; apenas os nomes das ações ficam explícitos.

Sem mudança de endpoint, payload, autorização backend, schema ou migration.
O endpoint de conclusão já suporta `message` e as cinco opções do diálogo.
Ele bloqueia lead/tarefa/ciclo, aplica a regra obrigatória e grava `task_completed`
com resultado/notas; repetir a mesma conclusão retorna o estado canônico e uma
conclusão divergente é recusada. A UI mantém a conferência do ACK antes de
limpar o rascunho, abrir Agenda ou considerar a confirmação concluída.

Mensagem não passa a registrar primeiro contato manual: essa métrica continua
dependendo do envio confirmado no WhatsApp. Histórico, atividades genéricas,
feedback, transições, cadências de outros canais, caches e os sete itens
anteriores não foram reimplementados neste lote. Não foi criado bloqueio de
movimentação de coluna; a política existente pode classificar pendências como
`skipped` ao sair da etapa.

O componente legado recebe apenas os handlers/guards e props necessários. Uma
extração futura das ações da cadência para `lead-detail` pode reutilizar estes
testes; não foi misturada uma refatoração do compositor inteiro com o defeito.

## Verificação, limites e reversão

O runtime novo executa os handlers e scopes reais com transporte/chat sintéticos.
Os dois cenários required/optional reproduzem o retorno antecipado no snapshot
anterior. A matriz corrigida verifica ações separadas, tarefa canônica atual,
permissões, fechamento comum, aposentadoria de acesso, retorno sem envio, cinco
resultados, ACK perdido/replay e ACK divergente. Logs/recibos discriminam as
contagens finais, sem somar repetição RED/GREEN ou pais/filhos de testes Go.

Os testes de navegador usam componentes/handlers reais e rede bloqueada; não
constituem um envio real, login no CRM ou teste em iPhone físico. A revisão
independente executou o kernel Go de conclusão de mensagem por overlay externo,
sem criar arquivo de backend no checkout. Testes dependentes de DB/opt-in são
relatados como pulados. Não houve acesso a banco real ou provedor.

Snapshot inicial: 4.114 fontes e 2.603 entradas locais no Git. A allowlist final
inclui somente este lote e inventários derivados revisados. As funções de
conclusão/resultado e quick outcome permanecem iguais ao baseline; a comparação
final também confere backend, hooks, API, migrations e correções anteriores.
Para reverter, usar os hunks contra `before/`, sem resetar o checkout nem
restaurar arquivos inteiros com ajustes das outras abas.

Sem deploy, commit, push, migration aplicada, configuração remota ou serviço
iniciado. Este item não depende de uma migration nova; as pré-condições das
entregas anteriores continuam separadas. São 8/14 itens corrigidos no código
local, com seis pendentes. O próximo é o item 09/P5 dos tipos reservados de
atividades; ele não foi incluído incidentalmente nesta correção.

## Fechamento verificado

- Novo runtime: **62/62 PASS**, sem skips; os dois cenários mínimos falham com
  os handlers anteriores. Executa os handlers/scopes reais por AST e o fluxo
  de confirmação canônica existente, com chat/transporte sintéticos.
- Novo navegador: **30/30 PASS**, sem skips, pageerrors ou rede externa.
  Componentes, CSS e handlers reais em 390 e 1366 px. Roteiro com/sem observação,
  resultado obrigatório/opcional, cancelar, preparar/retornar sem envio,
  permissão/lead fechado/sem telefone e falhas de conclusão. Capturas conferidas
  nos dois tamanhos, com CTAs legíveis e sem overflow horizontal. O RED anterior
  não abre o preview; o timeout ocorre sem erro de montagem ou requisição real.
- Regressões existentes: **173/173** de contato/cadência e **73/73** de diálogos,
  draft/preview e cabeçalho mobile, sem skips. Total frontend distinto: **235**
  de runtime e **103** de navegador; as rodadas repetidas não entram na soma.
- Go em modo sem DB: regressões **42 principais + 79 subtestes PASS**, com uma
  integração opt-in pulada. Probe externo por overlay: **2 principais + 14
  subtestes PASS**, sem skips, exercitando as cinco opções de mensagem,
  conclusão opcional, metadata histórica, replay, conflito e negativas.
  Esses números discriminam pais/filhos; não equivalem a ensaio PostgreSQL real.
- `npm run typecheck`, `npm run lint` e `npm run audit:check` aprovados. Lint
  global: zero erros e sete avisos anteriores. Arquivos novos sem avisos na
  conferência focada. Inventários regenerados e comparados: mesmas contagens,
  rotas, regras e controles; digests/IDs/localizações derivados atualizados.

Comparação final: **4.109 das 4.114 fontes anteriores idênticas**, cinco existentes
alteradas na allowlist (dois produtos, três relatórios gerados) e três novas
(dois testes e este runbook). As 2.603 entradas locais anteriores do Git foram
preservadas; somente os três arquivos novos foram acrescentados. No componente
legado, 156 dos 160 inicializadores de primeiro nível estão literalmente iguais:
mudaram somente click, ação do roteiro, handoff opcional e o mount dos overlays.
A conclusão canônica, quick outcome e os outros handlers anteriores permanecem.

Os hashes das fontes finais coincidem com os recibos de runtime, navegador e
revisão independente. Não é uma prova de API/banco/provedor/dispositivo físicos,
nem um aceite geral para publicação. Evidência detalhada em `BROWSER.md`,
`cadence-message-runtime-receipt.json`, `backend-protocol-peer-receipt.json` e
`preservation-receipt.json` na pasta externa a088.
