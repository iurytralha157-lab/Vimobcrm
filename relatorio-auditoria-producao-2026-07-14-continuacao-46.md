# Relatorio de auditoria em producao - continuacao 46

Data: 2026-07-14
Ambiente: producao, navegador Chrome
Escopo desta rodada: Contatos, filtros avancados, seletor de periodo e visao de leads perdidos para administrador e usuario padrao.

## Resumo executivo

Foi comparado o comportamento de filtros em Contatos nos dois perfis. O administrador possui filtros mais amplos, incluindo busca, equipes, responsavel, origem, tags, status e campanhas. O usuario padrao possui painel reduzido, com busca, origem, tags, status e campanhas, sem campos de equipe/responsavel. Essa diferenca e positiva para segregacao de permissao.

O seletor de periodo abriu corretamente em ambos os perfis, com atalhos como hoje, ontem, ultimos 7 dias, ultimos 30 dias, mes atual, mes anterior, trimestre, ano e calendario personalizado. A visao **Leads perdidos** tambem abriu nos dois perfis, respeitando a diferenca de volume entre administrador e usuario padrao.

## Achados

### P1 - Achado recorrente: usuario padrao ainda visualiza Importar / Exportar em Contatos

Na lista de Contatos do usuario padrao, o botao **Importar / Exportar** continuou visivel durante esta rodada. Este achado ja havia sido detalhado na continuacao 45 e permanece relevante porque importacao/exportacao sao acoes sensiveis.

Recomendacao:
- Bloquear importacao/exportacao no backend para perfis sem permissao explicita.
- Ocultar ou desabilitar o controle na UI para usuario padrao.

Evidencia: `EVID-PROD-STD-FILTROS-CONTACTS-LISTA-046.png`

### P2 - Dialogs de filtro/periodo registram aviso de acessibilidade

Apos abrir filtros e controles de periodo, os logs registraram aviso de `DialogContent` sem descricao ou `aria-describedby`. O fluxo visual funcionou, mas o aviso indica lacuna de acessibilidade para leitores de tela.

Recomendacao:
- Adicionar descricao acessivel nos dialogs/popovers de filtros e periodo.
- Validar componentes Radix/shadcn usados nesses controles com auditoria de acessibilidade.

Evidencia: `EVID-PROD-ADM-FILTROS-RETORNO-FINAL-046.png`

### P3 - Avisos recorrentes de grafico com dimensoes invalidas no dashboard

Ao restaurar a sessao do administrador, os logs voltaram a registrar avisos de grafico com largura/altura negativas. Esse comportamento ja apareceu em rodadas anteriores.

Recomendacao:
- Garantir dimensoes positivas dos containers antes de montar os graficos.
- Revisar renderizacao inicial do dashboard em cenarios de retorno de sessao.

Evidencia: `EVID-PROD-ADM-FILTROS-RETORNO-FINAL-046.png`

## Validacoes positivas

- Administrador: filtros avancados exibem busca, equipes, responsavel, origem, tags, status e campanhas.
- Usuario padrao: filtros avancados nao exibem equipes nem responsavel, reduzindo exposicao de organizacao/usuarios.
- Ambos os perfis: seletor de periodo abriu com atalhos e calendario personalizado.
- Ambos os perfis: **Leads perdidos** abriu como visao separada, com botao **Ver todos os leads**.
- Usuario padrao: visao de perdidos mostrou volume reduzido em relacao ao administrador.
- Nenhum filtro foi aplicado de forma persistente, nenhum dado foi salvo, importado, exportado ou excluido.
- Sessao final restaurada no administrador, viewport resetado e Chrome finalizado.

## Evidencias validas da rodada

- `EVID-PROD-ADM-FILTROS-CONTACTS-LISTA-046.png`
- `EVID-PROD-ADM-FILTROS-CONTACTS-PAINEL-FIX-046.png`
- `EVID-PROD-ADM-FILTROS-CONTACTS-PERIODO-MENU-046.png`
- `EVID-PROD-ADM-FILTROS-CONTACTS-LEADS-PERDIDOS-046.png`
- `EVID-PROD-ADM-FILTROS-RETORNO-FINAL-046.png`
- `EVID-PROD-STD-FILTROS-CONTACTS-LISTA-046.png`
- `EVID-PROD-STD-FILTROS-CONTACTS-PAINEL-046.png`
- `EVID-PROD-STD-FILTROS-CONTACTS-PERIODO-MENU-046.png`
- `EVID-PROD-STD-FILTROS-CONTACTS-LEADS-PERDIDOS-046.png`

## Observacoes

- Tentativas intermediarias de abrir dropdowns internos dos filtros foram descartadas porque nao produziram estado confiavel de opcoes abertas.
- As evidencias finais desta rodada ficaram restritas a estados validos e verificaveis.
