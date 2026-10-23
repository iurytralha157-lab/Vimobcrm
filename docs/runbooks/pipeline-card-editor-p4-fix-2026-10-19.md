# Pipeline: bloqueio da edição durante salvamento lento

19/10/2026. Item 04/P4 da auditoria
`D:/Vimob/outputs/pipeline-card-reaudit-20261019-t927/AUDITORIA.md`.
Checkout principal `D:/Vimob/workspaces/vimob-crm`, main, HEAD
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee` com alterações locais anteriores.
Evidências: `D:/Vimob/outputs/pipeline-editor-p4-fix-20261019-w044`.

## Causa e comportamento corrigido

CreateLeadDialog captura o formulário no início do envio. Antes da correção,
os campos e alguns seletores continuavam editáveis durante o await, enquanto
o ACK encerrava o formulário correspondente ao snapshot anterior. Digitação,
imóveis ou arquivos modificados durante a espera podiam ser descartados sem
terem sido enviados.

A solução congela a edição durante a tentativa em andamento, incluindo o
upload posterior ao salvamento. Não introduz autosave nem tenta enviar uma
segunda versão automaticamente. O snapshot, diff, revisão CAS, transporte e
callbacks de conclusão existentes permanecem inalterados. Se o envio falha,
o finally libera a trava e mantém o rascunho/arquivos para editar e tentar
novamente. No sucesso, somente a versão submetida é confirmada e encerrada.

- O ref já existente de tentativa bloqueia callbacks capturados antes do
  render de busy; isSubmitting fornece o estado visual e cobre a recuperação
  de anexos. Guards nos handlers e atualizadores funcionais protegem campos,
  imóveis, arquivos, equipe, navegação, descarte e recarga explícita.
- Fieldset desabilita os campos nativos dentro do conteúdo do wizard. A
  posição do FormWizardLayout, seus painéis e rolagens foram preservados.
  Seletores customizados recebem disabled e o formulário expõe aria-busy.
- Captura de eventos React no form também protege seletores que já estavam
  abertos em portais fora do DOM do fieldset: pointer, click, change e teclado.
  Tab/Escape continuam permitidos e a rolagem não é interceptada. Escape pode
  fechar o seletor; o fechamento do editor continua bloqueado durante envio.
- Inicialização por identidade, revalidação de acesso e finish da recuperação
  de documentos não recebem o bloqueio de edição: precisam continuar operando
  independentemente de uma tentativa antiga.

O produto foi alterado somente em CreateLeadDialog. O mesmo componente atende
Pipeline, Contatos, atalho mobile e criação pelo WhatsApp; por isso criação e
edição foram verificadas. Nenhuma primitiva components/ui, hook de mutação,
API, schema ou comportamento de conversa foi alterado. O legado excede 800
linhas; o crescimento ficou restrito às guardas e à apresentação do bloqueio.
A extração futura do controlador de submissão deve preservar os testes desta
etapa, sem se misturar à remoção de código morto do item 14.

## Validação

- Regressão nova, executando declarações/callbacks JSX reais por AST: RED no
  snapshot anterior teve 64 FAIL/9 PASS, sem skips. GREEN: 73/73 PASS.
  Cobre criação/edição, callbacks anteriores ao render, dados básicos/perfil,
  gestão/tags, imóveis, arquivos, teclado/portais, navegação, descarte, recarga,
  envio duplicado, erro/retry, upload e aposentadoria da sessão.
- Seis suites existentes do editor: 40/40 PASS, sem skips. Duas fixtures
  tinham 11 falhas anteriores por ausência de bindings de acesso/refs já
  usados pelo produto. O baseline anterior confirmou as mesmas falhas.
  Os bindings foram atualizados sem alterar as asserções.
- Regressões anteriores de cache P3 e ações do popup: 158/158 PASS, sem skips.
  Total distinto desses grupos: 271 testes. Não somar execuções repetidas/RED.
- Chromium isolado: 16/16 cenários, sem erros JS ou requisições externas.
  Componente inteiro, FormWizardLayout, controles Radix e CSS reais; hooks de
  dados e respostas lentas sintéticos. Dimensões do diálogo/conteúdo/rodapé
  idênticas ao baseline nos quatro passos em 320, 390 e 1366 px. Portal de
  tags aberto bloqueia seleção/criação por clique e Enter; Tab/Escape seguem
  funcionais. Erro reabilita o editor mantendo o texto.
- Typecheck e audit:check globais aprovados; quatro contratos do inventário
  aprovados. Lint global não teve erros. A única advertência nova era uma
  supressão preexistente que ficou desnecessária no efeito agora protegido;
  foi removida e o lint dos quatro arquivos alterados repetido sem avisos.
  Os sete avisos anteriores fora do ajuste permanecem.

Um teste antigo de create-lead-source-contract.test.mts falha também no
baseline: o regex espera a invalidação de origem sem o guarda de acesso que
o código já possui. Dois casos desse arquivo passam e um falha; não entram
nos 271 aprovados nem foram ocultados/pulados. O teste foi mantido fora desta
correção. Nenhuma falha funcional de origem nova foi demonstrada por ele.

Os relatórios gerados de superfícies/dívida visual foram regenerados e
comparados: só mudam localizações, IDs/digests derivados; mesmas contagens,
rotas, superfícies e regras. Nenhuma regra de lint/inventário foi enfraquecida.
Checkpoint de fontes e recibo de preservação conferem os ajustes anteriores,
incluindo os dois P2 da Agenda e o P3 do cache.

## Limites e reversão

Chromium por viewport/touch não certifica Safari/iPhone físico. API/banco,
upload real, produção e carga de 300 usuários não foram exercitados. Sem
deploy, migration, commit, push, alteração de dados reais ou início de serviço.

Reverter somente os hunks desta etapa com o snapshot externo anterior. Não
resetar arquivos inteiros ou o checkout, que contém mudanças de outras abas.
Remover a trava reabre a perda de edição comprovada.

São 4/14 itens corrigidos localmente. Os outros 10 continuam pendentes;
próximo na ordem: item 05/P4, feedback legítimo ocultado por filtro de texto.
Esta etapa não é um aceite da Pipeline completa para publicação.
