# Pipeline: recuperação de abertura com falha no armazenamento — P6 adicional

Checkout principal: `D:/Vimob/workspaces/vimob-crm`, branch `main`.
Base: `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com ajustes locais anteriores.
Evidências: `D:/Vimob/outputs/pipeline-opening-storage-p6-fix-20261019-h469`.

## Causa e correção

Após erro de carregamento do código do popup, `LeadDialogErrorBoundary`
consultava e gravava `sessionStorage` para limitar o reload automático a uma
tentativa por janela de cinco minutos. Getter indisponível, leitura recusada
ou gravação sem quota podiam lançar uma segunda exceção no `componentDidCatch`.
Ela escapava da recuperação local para o boundary da área.

O bloco de recuperação automática agora está dentro de `try/catch`. Se qualquer
etapa falhar, o diálogo já existente permanece com a ação manual Recarregar.
Não se tenta reload automático sem conseguir registrar a tentativa: esse atalho
eliminaria a proteção contra ciclos entre carregamentos da página.

O prazo, a chave, a sequência de leitura/gravação/reload e o teste estrito de
tempo são iguais aos anteriores. Exatamente cinco minutos ainda é throttled;
uma tentativa mais antiga permite o reload. Erro comum e execução sem `window`
continuam saindo antes de acessar armazenamento. Se o próprio reload lançar,
o diálogo continua sendo o fallback. Não foi introduzido estado global,
armazenamento alternativo, mensagem, controle ou dependência.

## Alcance e preservação

Somente `componentDidCatch` de
`components/features/pipelines/pipeline-screen/LeadDialogErrorBoundary.tsx`
muda no produto. `render`, estilos, textos, ações manuais, estado e métodos
derivados permanecem iguais. O consumidor produtivo continua sendo
`PipelineDialogs`; não há modificação do formulário, histórico, cache,
movimentação, Contatos, WhatsApp, Agenda ou dos outros 14 itens corrigidos.

`independent-opening-storage-review.json` confere o delta por AST: o bloco
anterior foi envolvido sem alterar seus statements, e o restante do arquivo
permanece idêntico. O snapshot externo guarda hashes das fontes e status Git
anteriores, inclusive dos ajustes de outras abas.

## Verificação

Os testes novos usam o componente completo e a fonte anterior capturada para
reproduzir o defeito. Conferem getter/leitura/gravação recusados, quota, erro
do reload, cooldown e controles de erro comum/SSR. O cenário de navegador usa
React e componentes UI reais, pai/filho sintéticos e rede externa bloqueada,
em desktop/mobile; verifica a permanência da recuperação local e a ação manual.

Resultado final, sem somar execuções RED ou repetições:

- Novos testes: **18/18 de runtime e 8/8 Chromium aprovados**, sem skips.
  Com a fonte anterior, os mesmos casos reproduzem dez falhas de runtime
  e seis escapes para o boundary pai no navegador; os controles restantes
  continuam passando. Os dois tamanhos são 390 e 1366 px, com recarga manual
  nativa e fechamento comum. Capturas dos dois tamanhos foram conferidas.
- Regressões existentes: **25/25 aprovadas**, de recuperação de acesso,
  recuperação da Pipeline e contratos de estabilidade. Total distinto desta
  rodada: **51 testes**, sem falhas ou skips no código corrigido.
- `npm run typecheck`, `npm run lint` e `npm run audit:check`: exit 0. Lint
  global mantém exatamente os sete avisos anteriores fora do ajuste; o lint
  dos dois novos testes não tem avisos. Os quatro contratos do inventário
  passaram. Não foi necessário alterar testes existentes.
- Revisão independente por AST aprovada. Comparação final: **4.208 das 4.212
  fontes anteriores byte-idênticas**, um produto e três inventários alterados,
  dois testes novos e este runbook. As 2.652 entradas Git fora desse alcance
  permanecem iguais, incluindo os ajustes das outras abas.

Resultados, comandos e hashes ficam em `storage-tests-receipt.json`,
`independent-opening-storage-review.json`, `gate-summary.json` e
`preservation-receipt.json`. A revisão semântica dos inventários mantém rotas,
controles, formulários, overlays e os 133 registros anteriores de Home;
somente digests e posições derivadas acompanham o código.

## Reversão e limites

Reverter somente o invólucro `try/catch` e seu comentário restaura o bloco
anterior, incluindo o defeito. Não restaurar o arquivo inteiro do HEAD ou
resetar o checkout, pois há alterações anteriores a preservar.

Os ensaios usam Chromium isolado e falhas induzidas; não comprovam o modo de
privacidade de um Safari físico, API/banco ou produção. Sem deploy, commit,
push, migration, alteração de `.env`, acesso a dados reais ou início de
serviços do CRM. As pendências de homologação e do pacote de publicação
continuam separadas desta correção local.
