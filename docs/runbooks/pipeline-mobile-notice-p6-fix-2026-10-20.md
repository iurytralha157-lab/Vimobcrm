# Pipeline — aviso sem sobreposição no mobile (FBL-04/P6)

Correção local de 20/10/2026 no checkout principal, sem deploy, commit, push,
migrations, banco operacional/produção ou início/reinício dos serviços CRM.

## Causa e decisão de layout

O aviso de refetch com snapshot preservado era absoluto no canto superior do
quadro. Em 320/390 px, seu retângulo cobria nome, contador e menu da coluna:
o centro do botão atingia o alerta em elementFromPoint, impedindo clique/toque.
O menu ainda abria por teclado. Não era perda de permissão ou de dados.

O aviso agora ocupa uma faixa própria no fluxo flex do quadro, depois da região
de colunas e antes da navegação fixa. A lista cede altura ao aviso; quando ele
desaparece, recupera o espaço. Os cabeçalhos mantêm a posição e seus tamanhos.
Não há offset fixo para empurrar colunas, remoção de alerta ou pointer-events
para ocultar o problema. Role alert, texto, retry, disabled e handlers continuam.

A opção de fluxo acima das colunas foi descartada antes de alterar o produto:
em alturas 320/360, deslocava o menu para a navegação lateral fixa em 50dvh.
As simulações externas foram preservadas, mas não contam como validação final.

Ao validar a faixa inferior apareceu outra colisão concreta: o launcher do
WhatsApp à direita interceptava parte do retry em 430 px; à esquerda cobria
parte do conteúdo em outras larguras. A geometria vem das fontes existentes
(56 px, inset de 24 px e rodapé mobile); o domínio de chat não foi alterado.

O conteúdo do aviso reserva 4rem dos dois lados usando px-16. Ícone/texto ficam
agrupados com min-w-0, e o ícone preserva 14 px com shrink-0. Mensagem e retry
quebram linha conforme o espaço disponível. Assim, as faixas laterais dos
launchers e da navegação ficam livres sem depender de seu lado ou de novo estado.

## Escopo preservado

Produto: somente PipelineBoard.tsx. Sem alterações de fontes, cores, raio ou
altura do retry, header, cards, menu, CSS Modules/global, UI compartilhada,
widgets de chat, AppLayout, navegação, filtros, queries, permissões ou backend.
Estado normal sem aviso mantém o mesmo quadro. A recuperação crítica e a
transição inicial mantêm seus overlays anteriores.

O rodapé reserva altura apenas durante o aviso. Isso reduz a área de leads
visível nesse estado; fontes e densidade dos cards não mudam. O ResizeObserver
continua medindo o mesmo contêiner externo; não há novo efeito, estado ou loop.
Os P5 anteriores e o P6 de avisos após troca de sessão permanecem intactos.

## Evidência e comandos

RED antes da mudança: 12 casos, sete falhas geométricas e cinco controles
aprovados. Componente, Radix, Tailwind e CSS Modules com filename/hash reais;
sem erro de importação/símbolo. O primeiro harness precisou corrigir só a extensão
do entry temporário. Um critério inicial excessivo de posicionamento acima do
header foi generalizado para não interseção antes do RED válido.

Regressões verificam menu por toque/teclado, nome/contador visíveis, retry
acionável/busy, navegação lateral, ausência de overflow horizontal e devolução de
altura. Larguras 320/390/1280, temas claro/escuro e alturas mobile 320/360/480;
mensagem mais longa e estados críticos também têm controles.

Proxies do launcher são explicitamente geométricos, com dimensões/insets e
padding de AppLayout extraídos das fontes. Eles não montam o chat nem comprovam
seus dados, envio ou comportamento de negócio. Validam o bloqueio por ponteiro
nos dois lados, inclusive em 430 px.

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test components/features/pipelines/pipeline-screen/pipeline-stale-notice.runtime.test.mjs
npm run test:pipeline-columns
npm run typecheck -- --incremental false
npm run lint
npm run audit:check
git diff --check
```

Teste novo registrado no runner canônico, sem remover ou afrouxar testes
anteriores. Logs, screenshots, contagens finais, comparação Git/SHA e limitações:
`D:/Vimob/outputs/pipeline-mobile-notice-p6-fix-20261020-r359/RESULTADO.md`.
Inventários derivados são conferidos semanticamente; não se alteram invariantes
ou scripts para tornar o gate verde.

## Reversão e homologação

Reverter seletivamente posição/classes/grupo do aviso e retirar seu teste/registro
da unidade; preservar as demais alterações do Board. Não restaurar o arquivo
inteiro. Não há banco para reverter; voltar ao absoluto reintroduz FBL-04.

Homologar em ambiente autorizado, com falha transitória de refetch mantendo cards,
menu e retry em iPhone/Safari e Android, duas posições do launcher, scroll real
e recuperação. Testes são Chromium sintético com CSS real; não comprovam produção,
SQL/RLS, aparelhos físicos, carga ou montagem integrada de todo o AppLayout/chat.

Da auditoria original permanece separado o FBL-05/P6 de normalização de busca.
