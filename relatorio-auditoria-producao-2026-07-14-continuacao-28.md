# Relatorio de Auditoria em Producao - Continuacao 28

Data: 2026-07-14
Ambiente: Producao, app.vimobcrm.com.br
Modulo auditado: Contatos
Perfis auditados: administrador e usuario padrao
Escopo: lista de contatos/leads, filtros, periodo, importacao/exportacao, leads perdidos, novo lead, detalhe, edicao, selecao e console
Restricao aplicada: nenhuma criacao, edicao, exclusao, importacao, exportacao ou envio foi confirmado.

## Resumo executivo

O modulo Contatos abriu em producao para administrador e usuario padrao. O administrador visualizou 39 leads no periodo auditado e o usuario padrao visualizou 2 leads, indicando escopo de dados menor no perfil padrao. Ambos conseguiram abrir periodo, filtros, menu de importacao/exportacao, leads perdidos, formulario Novo Lead, detalhe do contato e modo de edicao do contato sem salvar alteracoes.

Nao houve escrita de dados. O formulario Novo Lead bloqueou avanco vazio e exibiu validacao de nome obrigatorio. O ponto mais importante encontrado e uma divergencia de navegacao/permissao: o usuario padrao consegue acessar diretamente `/crm/contacts`, mas a navegacao lateral visivel no perfil padrao nao exibe o modulo Contatos de forma consistente. Se o acesso direto for intencional, o menu esta incompleto; se nao for, falta bloqueio de rota.

## Evidencias geradas

Total de evidencias desta continuacao: 24 imagens.

- EVID-PROD-ADM-CONTATOS-INITIAL-028.png
- EVID-PROD-ADM-CONTATOS-PERIOD-DROPDOWN-028.png
- EVID-PROD-ADM-CONTATOS-PERIOD-DROPDOWN-028C.png
- EVID-PROD-ADM-CONTATOS-FILTERS-028.png
- EVID-PROD-ADM-CONTATOS-FILTERS-028C.png
- EVID-PROD-ADM-CONTATOS-IMPORT-EXPORT-028.png
- EVID-PROD-ADM-CONTATOS-IMPORT-EXPORT-028C.png
- EVID-PROD-ADM-CONTATOS-LEADS-PERDIDOS-028C.png
- EVID-PROD-ADM-CONTATOS-NOVO-LEAD-FORM-028C.png
- EVID-PROD-ADM-CONTATOS-NOVO-LEAD-AVANCAR-VAZIO-028.png
- EVID-PROD-ADM-CONTATOS-ROW-DETAIL-028C.png
- EVID-PROD-ADM-CONTATOS-DETAIL-OPEN-028.png
- EVID-PROD-ADM-CONTATOS-DETAIL-EDIT-028.png
- EVID-PROD-ADM-CONTATOS-BULK-SELECT-028.png
- EVID-PROD-ADM-CONTATOS-CHECKBOX-SELECT-028.png
- EVID-PROD-STD-CONTATOS-INITIAL-028.png
- EVID-PROD-STD-CONTATOS-PERIOD-DROPDOWN-028.png
- EVID-PROD-STD-CONTATOS-FILTERS-028.png
- EVID-PROD-STD-CONTATOS-IMPORT-EXPORT-028.png
- EVID-PROD-STD-CONTATOS-LEADS-PERDIDOS-028.png
- EVID-PROD-STD-CONTATOS-NOVO-LEAD-FORM-028.png
- EVID-PROD-STD-CONTATOS-NOVO-LEAD-AVANCAR-VAZIO-028.png
- EVID-PROD-STD-CONTATOS-DETAIL-OPEN-028.png
- EVID-PROD-STD-CONTATOS-DETAIL-EDIT-028.png

## Resultado por perfil

### Administrador

- Lista de contatos carregou com colunas de nome, contato, status, pipeline/estagio, responsavel e data de criacao.
- Seletor de periodo abriu com atalhos, calendario, limpar e aplicar.
- Filtros avancados abriram com busca, responsavel/equipe, origem, tags, status e campanhas Meta.
- Menu Importar / Exportar abriu com opcoes de importar CSV/Excel e exportar.
- Leads perdidos abriu a lista filtrada com motivo de perda e botao para voltar a todos os leads.
- Novo Lead abriu em modal com abas Basico, Perfil e Gestao.
- Campos do primeiro passo do Novo Lead auditados: nome obrigatorio, telefone, email, fonte e observacoes.
- Avancar sem nome exibiu validacao de campo obrigatorio e nao criou lead.
- Detalhe de contato abriu em modal com responsavel, status, chat, dados do contato, imovel associado, documentacao, agenda, cadencia, feedback e historico/mensagens.
- Edicao de contato abriu campos de nome, telefone, email, cargo e empresa, com acao de salvar dados visivel. Nada foi salvo.
- Selecao de linha por checkbox exibiu barra de acao com contador, Excluir e Cancelar. Nenhuma acao destrutiva foi clicada.

### Usuario padrao

- Rota `/crm/contacts` abriu por acesso direto e exibiu 2 leads.
- A navegacao lateral visivel no perfil padrao nao mostrou Contatos de forma consistente, apesar de a pagina estar acessivel.
- Filtros avancados abriram, mas sem filtro de responsavel/equipe exibido para o padrao. Isso e coerente com escopo menor.
- Seletor de periodo abriu com os mesmos atalhos e calendario.
- Menu Importar / Exportar abriu.
- Leads perdidos exibiu apenas o subconjunto perdido do perfil.
- Novo Lead abriu com os mesmos campos iniciais: nome obrigatorio, telefone, email, fonte e observacoes.
- Avancar vazio exibiu validacao de nome obrigatorio e nao criou lead.
- Detalhe de contato abriu com dados, chat, documentacao, agenda, cadencia, feedback e historico.
- Edicao de contato abriu campos de nome, telefone, email, cargo e empresa, com salvar dados visivel. Nada foi salvo.
- Checkbox/selecao em massa nao ficou disponivel visualmente no layout padrao auditado.

## Achados

### P2 - Acesso direto a Contatos no perfil padrao com menu lateral inconsistente

O usuario padrao acessou `/crm/contacts` diretamente e a tela funcionou, mas a navegacao lateral visivel nao apresentou Contatos de forma consistente. Isso deixa a regra de permissao ambigua.

Impacto: se Contatos deve ser permitido, o usuario pode ficar sem caminho claro de navegacao. Se Contatos nao deve ser permitido, existe exposicao de rota protegida apenas parcialmente por interface.

Recomendacao: alinhar RBAC e menu lateral. A regra deve ser unica: ou exibir Contatos no menu do perfil padrao autorizado, ou bloquear a rota direta no middleware/guard de permissao.

### P2 - Dialogs sem descricao acessivel

O console registrou avisos repetidos de DialogContent sem descricao ou `aria-describedby`. Isso apareceu durante abertura de modais como Novo Lead e detalhe/edicao.

Impacto: acessibilidade reduzida para leitores de tela e possivel falha em auditorias WCAG.

Recomendacao: adicionar `DialogDescription` ou configurar `aria-describedby` apropriado nos dialogs de Contatos.

### P3 - Acao Excluir aparece imediatamente apos selecao no admin

Ao selecionar um contato no admin, a barra de selecao exibiu Excluir e Cancelar. A exclusao nao foi testada para nao alterar dados.

Impacto: se nao houver confirmacao posterior, ha risco operacional de exclusao acidental.

Recomendacao: confirmar que Excluir exige modal de confirmacao explicito e mensagem clara com quantidade de itens.

### P3 - Avisos herdados de dimensao de graficos seguem no console

A sessao ainda apresentou avisos repetidos de componente grafico com largura/altura 0 ou -1. Como a coleta inclui a mesma aba usada no Dashboard, o aviso pode ser herdado, mas segue relevante para a experiencia geral.

Recomendacao: manter o ajuste ja apontado no relatorio do Dashboard para containers responsivos dos graficos.

## Permissoes e seguranca funcional

- Admin visualizou escopo maior de dados e filtro por responsavel/equipe.
- Usuario padrao visualizou escopo menor e sem filtro de responsavel/equipe.
- Acesso direto do padrao a Contatos precisa de decisao de produto/permissao.
- Nenhuma credencial foi registrada neste relatorio.
- Nenhuma escrita foi feita em producao.

## Campos/controles auditados

- Lista e paginacao.
- Periodo.
- Filtros avancados.
- Importar / Exportar.
- Leads perdidos.
- Novo Lead: abas, nome, telefone, email, fonte, observacoes e validacao.
- Detalhe do contato.
- Edicao de dados do contato.
- Responsavel e status no detalhe.
- Chat/historico em modo leitura.
- Agenda em modo leitura.
- Cadencia em modo leitura.
- Feedback em modo leitura, sem envio.
- Documentacao/anexo em modo leitura.
- Selecao em massa no admin.

## Status

Contatos auditado em producao para administrador e usuario padrao. Nao houve alteracao de dados. A auditoria geral do VIMob CRM continua ativa para os proximos modulos/rotas.
