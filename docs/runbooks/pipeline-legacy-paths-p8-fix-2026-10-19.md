# Pipeline: caminhos legados sem uso — item 14/P8

Checkout principal: `D:/Vimob/workspaces/vimob-crm`, branch `main`.
Base: `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com alterações locais anteriores.
Evidências: `D:/Vimob/outputs/pipeline-legacy-paths-p8-fix-20261019-g358`.
Origem: item 14 da reauditoria `pipeline-card-reaudit-20261019-t927/AUDITORIA.md`.

## Alcance confirmado antes da remoção

O estado `isEditingContact` de `LeadDetailDialog` iniciava em `false` e suas
quatro chamadas de setter só gravavam `false`. Os dois formulários inline e
`handleSaveContact` não tinham caminho de abertura no produto. O botão Editar
encaminha o lead por `onEdit` para o editor externo `CreateLeadDialog`, nos
consumidores de Pipeline e Contatos.

`LeadUnifiedThread` tinha somente um import produtivo, em `LeadDetailDialog`,
e dois mounts, ambos com `readOnly` literal. Seu rodapé de composição, escolha
de sessão própria, anexação e callbacks de envio não eram oferecidos por esses
consumidores. O envio ativo é feito pelo chat flutuante ou por Conversas.

Não se presume que todo código oculto fosse inerte: hooks do compositor ainda
eram inicializados e mantinham efeitos de retenção/limpeza de rascunhos. A
remoção desses efeitos exclusivamente do histórico é parte deliberada desta
limpeza. Os compositores ativos continuam donos de seus próprios rascunhos.

## Alteração de produto

| Arquivo | Delta autorizado |
|---|---|
| `components/features/leads/LeadDetailDialog.tsx` | Remove estado, dois formulários inline, handler exclusivo e seu bookkeeping. Mantém editor externo e o estado dos três campos usados pela seleção de imóvel. Remove props obsoletas dos dois mounts do histórico. |
| `components/features/leads/LeadUnifiedThread.tsx` | Torna explícita a responsabilidade de leitura: remove compositor, hooks de escrita e 72 declarações exclusivas, mantendo histórico, mensagens e navegação. Reduz 845 linhas. |
| `hooks/lead-history/thread-state.ts` | Remove somente `canAttachLeadThreadMedia`, exclusivo do compositor retirado. Preserva as funções de carregamento e janela. |
| `hooks/integrations/whatsapp/use-own-whatsapp-session-selection.ts` | Remove hook cujo único consumidor produtivo era o compositor retirado. Backup e hash anteriores ficam na evidência. |

O histórico mantém `MessageBubble` com `plainHistory` e
`canAttachToLead={false}`, sem callbacks de mutação. Reações existentes são
projetadas; não é introduzida ação de reagir, reenviar, descartar ou repetir
download. Os handlers de queda de arquivo continuam bloqueando o comportamento
nativo do navegador sem ler nem anexar os arquivos.

O observer de conversas com `enabled: false` foi preservado. Mesmo sem iniciar
consulta, ele pode fornecer cache autorizado para os fallbacks de grupo,
sessão e JID das mensagens. A seleção continua sendo o primeiro vínculo
correspondente. Não há nova consulta de sessões.

A assinatura Realtime existente continua com
`reconcileOnSubscribe: false`. A vida útil das leituras usa a identidade do
lead e o `accessScope` existente de WhatsApp, incluindo ator, organização,
permissões e SID. O contador de geração continua invalidando callbacks de
paginação e citações após troca de escopo, A–B–A ou desmontagem. O hook que
calcula esse escopo não foi alterado.

## Preservação e consumidores

As 22 funções de apresentação de eventos/feedback são byte-idênticas. A
revisão por AST também confere props de leitura, paginação, citações e as 24
outras ações ativas do popup. A seleção de imóvel mantém CAS, cache canônico,
rollback, revisão com microssegundos e o bloqueio de operação em andamento;
somente a guarda do salvamento inline inexistente é removida.

Mantidos: abertura/fechamento, perda/ganho/reabertura, responsáveis, tags,
notas, feedback, cadências, Agenda, anexos do lead, botões de ligar e Chat,
editor externo, rolagem dos painéis e respostas booleanas dos formulários.
Pipeline e Contatos compartilham o detalhe e são cobertos nos layouts de
390 e 1366 px. A mudança não redesenha fontes ou controles dessas telas.

`FloatingChat`, seu Context, `ConversationsScreen`, `MessageBubble`, APIs,
hooks compartilhados de WhatsApp, autenticação, backend, migrações, primitivas
UI e estilos mantêm os hashes anteriores. O snapshot de 4.214 fontes e a
comparação de status Git distinguem esta alteração de todo o trabalho local
preexistente. Não se usa `git diff HEAD` como se fosse o delta desta tarefa.

## Testes e aposentadoria de contratos

Não se mantém uma API privada ou abertura artificial apenas para executar
testes de caminhos que o produto deixou de possuir. Cada caso aposentado
tem nome, fonte anterior, hash, justificativa e sucessor nos recibos:

- `inline-editor-receipt.json` e `retired-inline-tests.json`: 13 casos de
  salvamento inline. Os testes do editor real (`lead-editor-saving` e
  `lead-edit-access`) permanecem; seleção de imóvel e cache recebem controles
  próprios em `contact-save.runtime.test.mjs`.
- `retired-test-files.json`: dois arquivos exclusivos do compositor e do hook
  removidos. Os controles ativos de envio, seleção de sessão e rascunhos
  continuam nos testes de Chat/Conversas.
- `retired-lead-send-cases.json`, `retired-mixed-cases.json` e
  `owned-harness-final-receipt.json`: casos exclusivos retirados de suítes
  mistas; quatro casos de paginação e 72 casos ativos de hardening continuam
  literalmente iguais. Dois casos novos exercitam o histórico real isolado,
  sem inicialização de writer hooks, em desktop/mobile.

Falhas de fixtures preexistentes foram reproduzidas antes de corrigir os
contratos. O produto compartilhado não foi adaptado para satisfazê-las:

- Quatro contratos de `pipeline-stability` não acompanhavam as extrações
  anteriores de política de retry, invalidação de status, menu de coluna e
  chave de rascunho. Agora exercitam os donos reais; quatro mutações negativas
  externas comprovam que as asserções rejeitam regressões.
- Um contrato de anexação usava uma expressão textual anterior ao alias local
  do input. A limpeza do input continua sendo verificada no callback real.
- Dois testes ativos de início de conversa aguardavam o desaparecimento de
  uma intenção que o chat atual preserva enquanto exibe o aviso de conexão.
  Agora aguardam esse aviso e verificam ausência de envio, abertura de
  histórico antigo ou criação indevida de conversa.

As primeiras falhas, reproduções do baseline e resultados finais estão
preservados. Nenhuma falha virou skip. Suítes do editor real, card, histórico,
paginação, mídias, navegação, Chat e Conversas compõem a regressão final.

## Inventários e verificação final

Os inventários são regenerados a partir das fontes finais. A comparação
semântica permite exatamente quatro CTAs retirados: dois Salvamentos inline,
cancelamento de citação e anexação do compositor antigo. Rotas, aliases,
formulários, overlays e os controles de outros arquivos permanecem iguais.
As 133 ocorrências anteriores do inventário Home são preservadas.

Resultado final:

- **1.842/1.842 testes em 71 arquivos**, sem falhas, cancelamentos ou skips.
  Inclui as suítes ativas de editor, card, histórico e WhatsApp descritas
  acima. Execuções focadas e controles negativos não são somados novamente.
- `npm run typecheck`, `npm run lint` e `npm run audit:check`: exit 0. O lint
  mantém exatamente os sete avisos anteriores em arquivos fora deste ajuste;
  os lints específicos dos arquivos alterados ficaram sem erro ou aviso.
- Quatro contratos do inventário aprovados; oito verificações da revisão
  final independente aprovadas, além dos recibos por AST de cada componente.
- As fontes testadas permaneceram estáveis durante a execução. Comparação
  final: **4.190 fontes anteriores byte-idênticas**, 21 arquivos alterados
  dentro do alcance aprovado, três remoções (hook e dois testes exclusivos)
  e este runbook novo. São preservadas 2.633 entradas Git fora desse alcance.
  Entre os 21 alterados há três arquivos de produto, 15 testes e três
  inventários; a remoção do hook é o quarto delta de produto.

Resultados, comandos, hashes e limites ficam em `regressions-summary.json`,
`gate-summary.json`, `lint-final.log`, `typecheck-final.log`,
`audit-check-final.log` e `preservation-receipt.json` na pasta de evidências.

## Reversão e limites

Para reverter, reaplicar somente o delta capturado dos quatro arquivos de
produto, seus testes e inventários. A evidência contém backups anteriores,
inclusive do hook removido. Não restaurar arquivos inteiros do HEAD sobre
os ajustes anteriores do checkout.

Os testes de navegador usam Chromium isolado, dados/autenticação sintéticos
e bloqueio de rede externa. Cache e Realtime são simulados nos testes de
wiring; não comprovam broadcast Supabase, entrega WhatsApp, Safari físico,
sessão autenticada no CRM ou carga de 300 usuários. Não houve acesso a banco
real, deploy, commit, push, alteração de `.env`, migração ou início de serviços
do CRM. O P8 trata da remoção desses caminhos demonstravelmente sem uso;
não representa, isoladamente, uma homologação integral de produção.
