# Relatorio de auditoria em producao - continuacao 45

Data: 2026-07-14
Ambiente: producao, navegador Chrome
Escopo desta rodada: tabela de Contatos, menus de acao de linha, selecao em massa e controles visiveis para administrador e usuario padrao.

## Resumo executivo

Foram auditados os controles da lista de Contatos nos dois perfis. O administrador possui menu de linha com acoes de detalhe, WhatsApp e exclusao, alem de selecao em massa com barra inferior de exclusao/cancelamento. O usuario padrao nao exibiu checkbox de selecao em massa nem acao de excluir no menu de linha, o que e positivo para segregacao de permissao.

O ponto mais sensivel encontrado foi que o usuario padrao ainda consegue abrir o menu **Importar / Exportar**, com opcoes **Importar CSV/Excel** e **Exportar** visiveis. Como essas acoes podem inserir dados ou extrair base de contatos, precisam de validacao de permissao no backend e, idealmente, ocultacao/desabilitacao na UI quando o perfil nao tiver autorizacao explicita.

## Achados

### P1 - Usuario padrao visualiza Importar CSV/Excel e Exportar em Contatos

No perfil usuario padrao, a tela `/crm/contacts` exibiu o botao **Importar / Exportar**. Ao abrir o menu, ficaram visiveis as opcoes **Importar CSV/Excel** e **Exportar**.

Risco: importacao pode alterar a base e exportacao pode permitir exfiltracao de dados de contatos. Mesmo que o backend bloqueie posteriormente, a UI oferece uma acao sensivel para um perfil que, pelo restante da tela, parece ter permissao reduzida.

Recomendacao:
- Validar permissao no servidor antes de qualquer importacao/exportacao.
- Ocultar ou desabilitar o menu para usuarios sem permissao administrativa.
- Adicionar validacao automatizada de permissao para import/export por perfil.

Evidencia: `EVID-PROD-STD-TABLE-CONTACTS-IMPORT-EXPORT-MENU-045.png`

### P2 - Acao de linha do administrador fica parcialmente fora do viewport sem rolagem horizontal

Na lista de Contatos do administrador, os botoes de acao por linha ficaram recortados no limite direito da tabela. O botao so ficou clicavel apos rolagem horizontal da tabela.

Risco: baixa discoverability e maior chance de clique incorreto, principalmente em telas com largura proxima ao breakpoint auditado. Isso tambem prejudica acessibilidade porque os botoes nao possuem texto visivel e aparecem como controles vazios no mapeamento.

Recomendacao:
- Tornar a coluna de acoes sticky ou sempre dentro do viewport da tabela.
- Exibir barra de rolagem horizontal mais clara, quando necessaria.
- Adicionar `aria-label` nos botoes de acao de linha.

Evidencia: `EVID-PROD-ADM-TABLE-CONTACTS-ROW-MENU-HSCROLL-045.png`

### P3 - Avisos repetidos de grafico no dashboard apos retorno ao administrador

Ao restaurar a sessao final do administrador no dashboard, os logs registraram avisos repetidos de grafico com largura/altura negativas.

Risco: pode indicar renderizacao instavel de cards/graficos em certos estados de layout. Nao bloqueou o fluxo auditado nesta rodada.

Recomendacao:
- Revisar containers dos graficos no dashboard para garantir dimensoes positivas antes da montagem.
- Cobrir renderizacao do dashboard com validacao visual/responsiva.

Evidencia: `EVID-PROD-ADM-TABLE-RETORNO-FINAL-045.png`

## Validacoes positivas

- Usuario padrao: menu de linha exibiu **Ver detalhes** e **WhatsApp**, sem **Excluir**.
- Usuario padrao: nao havia checkbox de selecao em massa nem barra de acoes selecionadas.
- Administrador: selecao por checkbox exibiu barra inferior com estado **1 selecionado(s)** e opcoes de acao/cancelamento.
- Administrador: sessao foi restaurada no dashboard ao final.
- Nenhuma acao destrutiva foi executada. Nao cliquei em excluir, exportar, importar, WhatsApp, salvar ou confirmar qualquer operacao.

## Evidencias validas da rodada

- `EVID-PROD-ADM-TABLE-CONTACTS-LISTA-045.png`
- `EVID-PROD-ADM-TABLE-CONTACTS-ROW-MENU-HSCROLL-045.png`
- `EVID-PROD-ADM-TABLE-CONTACTS-SELECAO-CHECKBOX-045.png`
- `EVID-PROD-ADM-TABLE-RETORNO-FINAL-045.png`
- `EVID-PROD-STD-TABLE-CONTACTS-LISTA-045.png`
- `EVID-PROD-STD-TABLE-CONTACTS-ROW-MENU-FIX-045.png`
- `EVID-PROD-STD-TABLE-CONTACTS-SELECAO-AUSENTE-045.png`
- `EVID-PROD-STD-TABLE-CONTACTS-IMPORT-EXPORT-MENU-045.png`

## Observacoes

- A contagem total de leads mudou durante a rodada por atualizacao externa/sistema; nenhuma criacao ou edicao foi executada nesta auditoria.
- As capturas intermediarias invalidas desta rodada foram removidas para evitar confusao com evidencias finais.
- Viewport temporario resetado e controle do Chrome finalizado apos restaurar o administrador.
