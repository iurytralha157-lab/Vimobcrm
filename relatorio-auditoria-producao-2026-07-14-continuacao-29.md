# Relatorio de Auditoria em Producao - Continuacao 29

Data: 2026-07-14
Ambiente: Producao, app.vimobcrm.com.br
Modulo auditado: Pipelines
Perfis auditados: administrador e usuario padrao
Escopo: kanban de pipeline, colunas, cards, periodo, filtros, novo lead, detalhe de card, carregamento incremental, criacao de coluna e console
Restricao aplicada: nenhum lead foi criado, editado, movido, excluido ou salvo; nenhuma coluna foi criada.

## Resumo executivo

O modulo Pipelines abriu em producao para administrador e usuario padrao. O administrador visualizou kanban amplo com varias colunas, mais cards e soma de valores por coluna. O usuario padrao visualizou um kanban reduzido, com menos cards e sem permissao visual para criar nova coluna.

Os controles principais funcionaram em modo de leitura/abertura: periodo, filtros, novo lead, validacao de formulario vazio e detalhe de card. A criacao de coluna foi aberta somente no admin e nao foi confirmada. O ponto de permissao relevante e positivo: `Criar nova coluna` apareceu para admin e nao apareceu para usuario padrao.

## Evidencias geradas

Total de evidencias desta continuacao: 19 imagens.

- EVID-PROD-ADM-PIPELINES-INITIAL-029.png
- EVID-PROD-ADM-PIPELINES-PIPELINE-DROPDOWN-029.png
- EVID-PROD-ADM-PIPELINES-PIPELINE-DROPDOWN-029B.png
- EVID-PROD-ADM-PIPELINES-PERIOD-DROPDOWN-029.png
- EVID-PROD-ADM-PIPELINES-FILTERS-029.png
- EVID-PROD-ADM-PIPELINES-CARREGAR-MAIS-029.png
- EVID-PROD-ADM-PIPELINES-NOVO-LEAD-FORM-029.png
- EVID-PROD-ADM-PIPELINES-NOVO-LEAD-AVANCAR-VAZIO-029.png
- EVID-PROD-ADM-PIPELINES-CARD-DETAIL-029.png
- EVID-PROD-ADM-PIPELINES-CRIAR-COLUNA-FORM-029.png
- EVID-PROD-STD-PIPELINES-INITIAL-029.png
- EVID-PROD-STD-PIPELINES-PERIOD-DROPDOWN-029.png
- EVID-PROD-STD-PIPELINES-PERIOD-DROPDOWN-029B.png
- EVID-PROD-STD-PIPELINES-PERIOD-DROPDOWN-029C.png
- EVID-PROD-STD-PIPELINES-FILTERS-029.png
- EVID-PROD-STD-PIPELINES-FILTERS-029B.png
- EVID-PROD-STD-PIPELINES-NOVO-LEAD-FORM-029.png
- EVID-PROD-STD-PIPELINES-NOVO-LEAD-AVANCAR-VAZIO-029.png
- EVID-PROD-STD-PIPELINES-CARD-DETAIL-029.png

Observacao: no usuario padrao, as capturas `029B` e `029C` sao as evidencias corrigidas dos paineis de filtros e periodo.

## Resultado por perfil

### Administrador

- Kanban carregou com pipeline atual `Vendas`.
- Colunas visiveis: Base, Contactados, Qualificados, Folow Up, Reuniao Marcada, No-Show / Reagendamento, Em Negociacao, Fechamento e Perdido.
- Cards exibiram nome, origem, responsavel, status, tempo, telefone e valores quando disponiveis.
- Botao `Carregar mais` ficou disponivel na coluna Base e expandiu visualmente a lista sem alterar dados.
- Seletor de periodo abriu com atalhos, calendario, limpar e aplicar.
- Filtros avancados abriram com busca, responsavel/equipe, origem, tags, status e campanhas Meta.
- Botao `NOVO LEAD` abriu o formulario com abas Basico, Perfil e Gestao.
- Avancar no Novo Lead sem nome exibiu validacao obrigatoria e nao criou registro.
- Detalhe do card abriu modal com botoes de movimento entre etapas, responsavel, status, chat, dados do contato, imovel, documentacao, agenda, cadencia, feedback e historico.
- Botao `Criar nova coluna` abriu modal com campos de nome da coluna, cor, cancelar e criar coluna. Nenhuma coluna foi criada.
- O seletor `Vendas` permaneceu visivel, mas nao apresentou opcoes adicionais nas tentativas realizadas. Pode indicar pipeline unico disponivel ou dropdown sem feedback.

### Usuario padrao

- Kanban carregou com pipeline `Vendas` em tema escuro e escopo menor.
- Colunas principais ficaram visiveis, com menos cards que no admin.
- `Criar nova coluna` nao ficou visivel para o usuario padrao.
- Seletor de periodo abriu corretamente quando acionado pelo botao de texto, com atalhos, calendario, limpar e aplicar.
- Filtros avancados abriram com origem, tags, status e campanhas Meta; nao exibiram filtro de responsavel/equipe.
- Botao `NOVO LEAD` abriu o mesmo formulario inicial.
- Avancar no Novo Lead sem nome exibiu validacao obrigatoria e nao criou registro.
- Detalhe de card abriu modal com botoes de movimento entre etapas, chat, dados, agenda, cadencia, feedback e historico.

## Achados

### P2 - Modais seguem sem descricao acessivel

O console registrou avisos de DialogContent sem descricao ou `aria-describedby` durante abertura de modais do modulo Pipelines, especialmente Novo Lead, detalhe de card e criacao de coluna.

Impacto: acessibilidade prejudicada para leitores de tela e risco em auditorias WCAG.

Recomendacao: adicionar descricoes acessiveis aos dialogs do modulo Pipelines usando `DialogDescription` ou `aria-describedby` com texto significativo.

### P3 - Seletor de pipeline sem feedback de opcoes

O controle `Vendas` aparenta ser um seletor de pipeline, mas nao exibiu lista de opcoes nas tentativas do admin. Se existir apenas um pipeline, o comportamento pode ser aceitavel; se houver mais pipelines, ha risco de descoberta ruim ou dropdown quebrado.

Recomendacao: confirmar a regra de produto. Para pipeline unico, considerar remover aparencia de dropdown ou exibir feedback claro. Para multiplos pipelines, corrigir a abertura da lista.

### P3 - Avisos de dimensao de grafico ainda aparecem na sessao

O console manteve avisos de grafico com largura/altura invalida. Como a aba ja passou por Dashboard, parte do ruido pode ser herdada, mas a recorrencia permanece relevante.

Recomendacao: manter a correcao dos containers responsivos apontada nas continuacoes anteriores.

## Permissoes e seguranca funcional

- Admin visualizou maior volume de dados e controle de criacao de coluna.
- Usuario padrao visualizou escopo reduzido e sem criacao de coluna.
- Ambos abriram detalhe de card com botoes de movimento entre etapas; nenhum movimento foi executado.
- Ambos abriram Novo Lead, mas a validacao impediu avanco vazio.
- Nenhuma credencial foi registrada neste relatorio.
- Nenhuma escrita foi feita em producao.

## Campos/controles auditados

- Pipeline atual.
- Colunas do kanban.
- Cards do kanban.
- Carregar mais.
- Periodo.
- Filtros avancados.
- Novo Lead.
- Validacao de nome obrigatorio.
- Detalhe de card.
- Botoes de movimento de etapa em modo leitura.
- Dados do contato no detalhe.
- Chat/historico em modo leitura.
- Agenda em modo leitura.
- Cadencia em modo leitura.
- Feedback em modo leitura, sem envio.
- Criar nova coluna no admin, sem salvar.

## Status

Pipelines auditado em producao para administrador e usuario padrao. Nao houve alteracao de dados. A auditoria geral do VIMob CRM continua ativa para os proximos modulos/rotas.
