# Pipeline: respostas booleanas de formulários — item 13/P6

Checkout principal: `D:/Vimob/workspaces/vimob-crm`, branch `main`.
Base: `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com alterações locais anteriores.
Evidências: `D:/Vimob/outputs/pipeline-form-boolean-p6-fix-20261019-f247`.

## Causa e escopo

O item 13 da reauditoria `pipeline-card-reaudit-20261019-t927/AUDITORIA.md`
trata de **respostas recebidas de integrações**, não do retorno de um callback
de salvamento. `answerText(false)` retornava `null`. Os extratores de respostas
Meta/webhook descartavam esse resultado, embora o valor negativo estivesse
presente no payload. A perda também ocorria em arrays e wrappers como
`{ value: false }`. Em `{ value: false, answer: true }`, o conversor podia
abandonar o primeiro valor explícito e apresentar o segundo.

O histórico expande respostas de atividades `lead_created`/`lead_reentry`
a partir de `payload`/`raw_payload` e de `leadMeta.raw_payload` como fallback
compatível. Esses caminhos compartilham o conversor. A bolha recebe o texto já
projetado; não consegue recuperar um valor descartado antes da renderização.

## Correção

- `hooks/lead-history/metadata.ts`: `answerText` aceita a opção explícita
  `preserveFalse`. Ela é propagada nas chamadas recursivas, inclusive em arrays.
  O comportamento padrão permanece compatível.
- `hooks/lead-history/forms.ts`: somente os dois `pushAnswer` ativam a opção,
  para respostas Meta e webhook. Rótulos, nomes de campos, textos e URLs de
  criativos continuam chamando o helper com o comportamento anterior.

| Entrada como valor de resposta | Apresentação |
|---|---|
| `false` / `true` | `false` / `true` |
| `0` | `0` |
| `[false, true, 0]` | `false, true, 0` |
| `{ value: false, answer: true }` | `false`, respeitando a precedência existente das chaves |
| Strings `"false"`, `"true"` | Textos literais preservados |
| Ausente, `null`, `undefined`, vazio | Sem resposta inferida |

Não se presume que o fornecedor use booleano para uma pergunta Sim/Não ou que
um campo ausente represente uma negativa. A grafia mantém a convenção existente
de `true`, agora preservando também `false`. Uma tradução específica depende
do contrato do formulário, fora desta correção.

Filtros de campos técnicos, nomes conhecidos, deduplicação, ordenação e regras
de fallback/completude continuam intactos. O raw não é reescrito. Não há novo
pedido de rede, armazenamento, configuração ou operação de escrita.

## Fronteira preservada

`LeadDetailDialog`, `LeadUnifiedThread`, seus estilos e os consumidores de
Pipeline/Contatos não foram alterados. A correção anterior de rolagem, os
formulários de edição, permissões, cache, Agenda, feedback e cadências continuam
nos arquivos anteriores.

O backend armazena o payload original. Existe um resumo derivado
`metadata.form_answers` que ainda filtra `false`, mas a busca no frontend e a
leitura do builder confirmam que esse resumo não alimenta esta apresentação.
Não houve alteração de ingestão/backend: esta correção usa o payload original
já disponível. Payloads que não contenham mais a resposta não são reconstruídos.

## Validação

Os testes novos exercitam os normalizadores/extratores/builder reais com dados
sintéticos e a apresentação em `LeadUnifiedThread` num navegador isolado. O RED
substitui somente as fontes capturadas antes da alteração; o GREEN usa as fontes
atuais. Hashes, resultados e limites ficam na pasta de evidências.

A matriz cobre booleanos, zero, strings, valores vazios, listas, chaves de
resposta reconhecidas, precedência, fontes Meta/webhook, filtros técnicos,
deduplicação, imutabilidade e compatibilidade de rótulos/criativos.

O teste de bolhas cobre desktop e mobile em Chromium com leituras/autenticação
sintéticas e rede bloqueada. Não equivale a sessão autenticada no CRM, banco,
provedor externo, iPhone/Safari físico ou homologação de produção.

A primeira execução ampla encontrou duas falhas em fixtures anteriores:

- `lead-thread-presentation.runtime.test.mjs` copiava um import relativo não
  utilizado para um módulo temporário. A resolução apontava para fora do
  checkout e falhava antes de executar os cenários, também com o produto
  anterior. O ajuste remove somente esse import do prefixo copiado. Os 19
  cenários e todas as asserções permanecem iguais.
- `pagination-hook.offline-dom.test.mjs` consultava o botão do segundo observer
  imediatamente após o início do pedido, antes do commit do React. Probes com
  o produto atual e anterior reproduzem a corrida ao atrasar as notificações;
  o cache já estava marcado como pendente e havia somente uma requisição.
  O teste aguarda a condição DOM, com limite, antes da mesma asserção de botão
  desabilitado. Nenhum scheduler artificial entra no produto ou teste final.

Logs da primeira execução, reproduções anteriores e recibos dos ajustes de
fixture foram preservados na pasta de evidências. As falhas não foram removidas
do registro nem transformadas em skips; os callbacks de produção não mudaram.

Resultado final:

- **1.592/1.592 testes em 57 arquivos**, sem falhas, cancelamentos ou skips.
  Inclui os 98 casos novos de normalização/projeção e os dois cenários de bolhas;
  não se somam novamente suas execuções isoladas, RED ou controles externos.
- RED: 39 falhas/59 controles nos mesmos 98 casos Node e duas falhas nos dois
  cenários DOM, usando as fontes anteriores capturadas e verificadas por hash.
- `npm run typecheck`, `npm run lint` e `npm run audit:check` aprovados.
  O lint final mantém sete avisos preexistentes fora deste ajuste; os lints
  específicos dos quatro testes novos/reparados ficaram sem erro ou aviso.
  Os quatro contratos de auditoria passaram. Inventários regenerados sem
  mudança semântica de rotas, formulários, controles ou apresentação.
- Revisão independente por AST: sete verificações confirmam o delta aprovado
  nos dois arquivos de produto e a preservação do builder e dos componentes.
- `preservation-receipt.json` compara fontes e status Git antes/depois e protege
  explicitamente as correções anteriores, incluindo rolagem, histórico da
  Agenda, finanças, cache, cadências e os consumidores de Pipeline/Contatos.

## Reversão e limites operacionais

Reverter somente os quatro ajustes de `answerText` e os dois argumentos de
`pushAnswer` restaura o comportamento anterior, incluindo a omissão de `false`.
Não restaurar arquivos inteiros sobre os ajustes anteriores do checkout.

Sem commit, push, deploy, migrations, acesso a banco real, `.env` ou início de
serviços do CRM. O item 14/P8, de caminhos legados sem uso, permanece separado.
