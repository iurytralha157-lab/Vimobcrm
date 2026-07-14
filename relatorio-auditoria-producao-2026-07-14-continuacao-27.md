# Relatorio de Auditoria em Producao - Continuacao 27

Data: 2026-07-14
Ambiente: Producao, app.vimobcrm.com.br
Modulo auditado: Dashboard
Perfis auditados: administrador e usuario padrao
Escopo: leitura, filtros, graficos, cards de KPI, drilldowns e console do navegador
Restricao aplicada: nenhum cadastro, edicao, exclusao ou disparo operacional foi executado.

## Resumo executivo

O Dashboard abriu em producao para os dois perfis, com KPIs, funil, grafico de evolucao e origem de leads. O administrador foi acessado novamente com a credencial atualizada informada pelo usuario e apresentou menu completo, filtros amplos e metricas agregadas de toda a organizacao. O usuario padrao apresentou o Dashboard com escopo menor e menu reduzido, mas tambem carregou KPIs e drilldowns apos a renderizacao completa.

Nao houve bloqueio funcional critico no fluxo auditado. O principal ponto tecnico observado foi ruido recorrente no console relacionado a graficos renderizando com dimensoes 0 ou -1, o que pode explicar carregamento parcial ou instabilidade visual em alguns momentos.

## Cobertura realizada

- Login e acesso ao Dashboard como administrador.
- Login e acesso ao Dashboard como usuario padrao.
- Validacao visual dos KPIs principais: leads, em aberto, perdidos, ganhos, visitas, VGV, primeiro contato, imoveis e visitas no site.
- Abertura do seletor de periodo com atalhos e calendario.
- Abertura do painel de filtros avancados.
- Abertura de dropdowns de filtros disponiveis.
- Interacao com grafico de evolucao por hover.
- Clique nos cards clicaveis de perdas e ganhos.
- Comparacao basica entre permissoes/visibilidade do admin e do usuario padrao.
- Coleta de avisos/erros do console do navegador.

## Evidencias geradas

Total de evidencias desta continuacao: 20 imagens.

- EVID-PROD-ADM-DASHBOARD-INITIAL-027.png
- EVID-PROD-ADM-DASHBOARD-RELOGIN-027.png
- EVID-PROD-ADM-DASHBOARD-PERIOD-DROPDOWN-027.png
- EVID-PROD-ADM-DASHBOARD-FILTERS-027.png
- EVID-PROD-ADM-DASHBOARD-PIPELINE-DROPDOWN-027.png
- EVID-PROD-ADM-DASHBOARD-FILTER-TODOS-DROPDOWN-027.png
- EVID-PROD-ADM-DASHBOARD-FILTER-TODAS-ORIGENS-DROPDOWN-027.png
- EVID-PROD-ADM-DASHBOARD-FILTER-TODOS-STATUS-DROPDOWN-027.png
- EVID-PROD-ADM-DASHBOARD-CHART-HOVER-027.png
- EVID-PROD-ADM-DASHBOARD-CARD-PERDIDOS-DEST-027.png
- EVID-PROD-ADM-DASHBOARD-CARD-GANHOS-DEST-027.png
- EVID-PROD-STD-DASHBOARD-INITIAL-027.png
- EVID-PROD-STD-DASHBOARD-LOADED-KPIS-027.png
- EVID-PROD-STD-DASHBOARD-PERIOD-DROPDOWN-027.png
- EVID-PROD-STD-DASHBOARD-FILTERS-027.png
- EVID-PROD-STD-DASHBOARD-FILTER-FIRST-DROPDOWN-027.png
- EVID-PROD-STD-DASHBOARD-PIPELINE-DROPDOWN-027.png
- EVID-PROD-STD-DASHBOARD-CHART-HOVER-027.png
- EVID-PROD-STD-DASHBOARD-CARD-GANHOS-DEST-027.png
- EVID-PROD-STD-DASHBOARD-CARD-PERDIDOS-DEST-027.png

## Resultado por perfil

### Administrador

- Acesso confirmado no Dashboard com menu completo: Dashboard, pipelines, conversas, contatos, gestao, imoveis, agenda, automacoes, financeiro, arena imobiliaria e configuracoes.
- KPIs agregados renderizaram corretamente apos carregamento.
- Seletor de periodo abriu com atalhos como hoje, ontem, ultimos 7 dias, ultimos 30 dias, mes atual, mes anterior, trimestre e ano.
- Painel de filtros avancados abriu com opcoes de responsavel/equipe, origem, tags, status e campanhas.
- Hover no grafico de evolucao exibiu tooltip com serie e valores do dia.
- Card PERDIDOS abriu detalhamento inline de motivos de perda.
- Card GANHOS abriu detalhamento inline de tempo de conversao, valores agregados e lista de registros do periodo.
- A URL permaneceu em `/dashboard` nos drilldowns; o comportamento observado e de expansao/detalhamento na propria pagina.

### Usuario padrao

- Acesso confirmado no Dashboard com menu reduzido em relacao ao administrador.
- Na primeira captura houve renderizacao parcial; apos aguardar carregamento, os KPIs apareceram corretamente.
- KPIs e graficos carregaram com numeros de escopo menor do que o admin.
- Seletor de periodo abriu.
- Painel de filtros abriu.
- Hover no grafico foi validado.
- Cards GANHOS e PERDIDOS estao clicaveis e abriram detalhamento inline na propria pagina.
- Os demais KPIs auditados apareceram como leitura, sem comportamento clicavel evidente.

## Achados

### P2 - Avisos repetidos de dimensao invalida nos graficos

O console registrou 79 avisos do componente de graficos informando largura/altura 0 ou -1. Nao houve erro fatal visivel, mas esse tipo de aviso pode causar grafico em branco, renderizacao parcial, flicker ou metricas carregando de forma inconsistente em alguns tamanhos de tela.

Evidencia: coleta de console na continuacao 27 e capturas de Dashboard dos dois perfis.

Recomendacao: revisar os containers dos graficos do Dashboard para garantir `min-width` e `min-height` antes da montagem do componente responsivo, especialmente em estados de carregamento, troca de filtros e layout responsivo.

### P3 - Drilldowns de cards nao mudam a rota

Os cards GANHOS e PERDIDOS abrem secoes detalhadas dentro do proprio Dashboard e mantem a URL em `/dashboard`. Isso funcionou nos dois perfis. Caso a regra de produto espere navegacao para uma pagina filtrada ou atualizacao de query string, o comportamento atual nao entrega essa pista de navegacao.

Recomendacao: confirmar a expectativa de produto. Se a expansao inline for intencional, adicionar feedback visual mais claro ou ancoragem para o detalhe aberto.

### P3 - Carregamento inicial pode parecer incompleto no usuario padrao

No perfil padrao, a primeira captura mostrou o Dashboard antes do estado final dos KPIs. Apos aguardar a renderizacao, os cards apareceram corretamente.

Recomendacao: revisar skeleton/loading state dos KPIs para evitar que o usuario interprete o painel como incompleto durante a carga.

## Permissoes e seguranca funcional

- O administrador visualizou controles e filtros mais amplos, coerente com o perfil.
- O usuario padrao visualizou um menu mais restrito e metricas em escopo reduzido.
- Nao foi observada, nesta tela, acao destrutiva ou escrita de dados sem confirmacao.
- Nenhuma credencial foi registrada neste relatorio.

## Campos/controles auditados

- Periodo.
- Filtros.
- Dropdowns de filtros.
- Graficos de evolucao.
- Funil de vendas.
- Origem dos leads.
- KPIs principais.
- Cards de perdas e ganhos.
- Menu lateral por perfil.
- Console do navegador.

## Status

Dashboard auditado em producao para administrador e usuario padrao. Nao houve alteracao de dados. A auditoria geral do VIMob CRM continua ativa para os proximos modulos/rotas.
