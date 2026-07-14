# Relatorio de auditoria funcional - Continuacao 26

Data: 2026-07-14
Ambiente: producao - app.vimobcrm.com.br
Modulo auditado nesta continuacao: Agenda
Perfis usados: usuario padrao e administrador
Navegador: navegador in-app controlado pelo Codex
Escopo excluido: Arena

## Resumo executivo

Esta continuacao cobriu a Agenda em producao para administrador e usuario padrao, sem criar, editar, excluir ou concluir atividades. Foram registradas 22 evidencias PNG cobrindo visualizacoes Dia, Semana, Mes e Lista, filtros, navegacao de periodo, formulario de novo agendamento e menu de linha no administrador.

O principal problema encontrado esta na consistencia de dados da Agenda para usuario padrao: na visao Dia, o usuario padrao ve atividades no dia 14 de julho, incluindo evento identificado de auditoria. Na visao Semana, Mes e Lista, esses mesmos itens nao aparecem; a visao Lista chega a exibir estado vazio com texto "Nenhuma atividade encontrada". No administrador, os mesmos eventos do usuario padrao aparecem nas visoes Semana, Mes e Lista. Isso sugere divergencia de consulta, filtro ou renderizacao entre visualizacoes para o perfil padrao.

Nenhum dado foi alterado. As acoes de Adicionar, Editar e Excluir nao foram executadas.

## Cobertura desta rodada

- Evidencias criadas: 22 arquivos PNG.
- Administrador: Agenda semanal, filtros, seletor de usuario, visualizacoes Dia/Semana/Mes/Lista, navegacao proximo/anterior/hoje, novo agendamento, menu de linha com Editar/Excluir.
- Usuario padrao: Agenda semanal, filtros, visualizacoes Dia/Semana/Mes/Lista, navegacao proximo/anterior/hoje, novo agendamento.
- Nao testado por seguranca: adicionar atividade, editar atividade, excluir atividade, concluir checkbox de tarefa, alterar preferencia persistente de linhas de 30 min, vincular lead/cliente ou imovel, enviar notificacao.

## Achados principais

### AGENDA-STD-DATA-001

Modulo: Agenda
Funcionalidade: Consistencia entre visualizacoes
Perfil: Usuario padrao
URL: /agenda
Status: FALHOU
Severidade: ALTO
Evidencias: EVID-PROD-STD-AGENDA-DAY-026.png, EVID-PROD-STD-AGENDA-WEEK-026.png, EVID-PROD-STD-AGENDA-WEEK-REFRESH-026.png, EVID-PROD-STD-AGENDA-MONTH-026.png, EVID-PROD-STD-AGENDA-LIST-026.png, EVID-PROD-ADM-AGENDA-LIST-026.png, EVID-PROD-ADM-AGENDA-MONTH-026.png

Resultado encontrado: o usuario padrao visualiza atividades na visao Dia, incluindo evento de auditoria do proprio usuario. Ao alternar para Semana, Mes e Lista, esses itens deixam de aparecer; a Lista mostra estado vazio.

Resultado esperado: as visualizacoes devem consultar o mesmo escopo de atividades e apresentar os mesmos eventos quando o intervalo cobre a data do evento.

Persistencia apos atualizar: nao aplicavel, pois nenhuma alteracao foi feita.
Impacto: o usuario pode perder compromissos/tarefas dependendo da visualizacao usada, gerando risco operacional alto.

### AGENDA-STD-EMPTY-002

Modulo: Agenda
Funcionalidade: Estado vazio da lista
Perfil: Usuario padrao
URL: /agenda
Status: FALHOU
Severidade: MEDIO
Evidencia: EVID-PROD-STD-AGENDA-LIST-026.png

Resultado encontrado: a visao Lista do usuario padrao exibiu "Nenhuma atividade encontrada" e texto indicando que ainda nao ha atividade para "este lead", mesmo estando na tela geral de Agenda.

Resultado esperado: se a lista estiver vazia, a mensagem deve ser contextualizada para Agenda. Se houver atividades no dia, a lista nao deveria ficar vazia.

Impacto: mensagem incorreta e possivel ocultacao de atividades.

### AGENDA-ADM-FILTER-003

Modulo: Agenda
Funcionalidade: Filtro por usuario
Perfil: Administrador
URL: /agenda
Status: APROVADO
Severidade: NAO APLICAVEL
Evidencias: EVID-PROD-ADM-AGENDA-FILTERS-026.png, EVID-PROD-ADM-AGENDA-USER-FILTER-DROPDOWN-026.png

Resultado encontrado: o administrador possui painel de filtros com VISUALIZACAO, CONFIGURACOES e FILTRO POR EQUIPE, incluindo seletor "Todos os usuarios". O usuario padrao nao exibiu esse filtro de equipe/usuario.

Resultado esperado: comportamento compatÃ­vel com perfil administrativo.

### AGENDA-FORM-004

Modulo: Agenda
Funcionalidade: Novo agendamento
Perfis: Usuario padrao e administrador
URL: /agenda
Status: APROVADO PARA ABERTURA, BLOQUEADO PARA PERSISTENCIA
Severidade: MEDIA
Evidencias: EVID-PROD-STD-AGENDA-NEW-MODAL-026.png, EVID-PROD-ADM-AGENDA-NEW-MODAL-026.png

Resultado encontrado: ambos os perfis abriram o formulario "Nova atividade". Campos observados: titulo, tipo de atividade, data, horarios, dia inteiro, recorrencia, responsaveis, visibilidade, lead/cliente, imovel vinculado e observacoes. O botao Adicionar ficou desabilitado com titulo vazio.

Resultado esperado: abertura correta e bloqueio inicial de envio sem titulo.

Persistencia apos atualizar: nao testada para nao criar dados em producao.

### AGENDA-ADM-ACTIONS-005

Modulo: Agenda
Funcionalidade: Menu de linha
Perfil: Administrador
URL: /agenda
Status: APROVADO COM OBSERVACAO
Severidade: MEDIA
Evidencia: EVID-PROD-ADM-AGENDA-EVENT-ROW-MENU-026.png

Resultado encontrado: na visao Lista, o administrador abriu menu de linha de uma atividade do usuario padrao e visualizou Editar e Excluir. Nenhuma dessas opcoes foi acionada.

Resultado esperado: confirmar regra de negocio. Se administradores podem gerir agendas de todos, a exposicao esta correta. Caso contrario, revisar permissao.

### AGENDA-UI-006

Modulo: Agenda
Funcionalidade: Navegacao de periodo
Perfis: Usuario padrao e administrador
URL: /agenda
Status: PARCIAL
Severidade: MEDIA
Evidencias: EVID-PROD-STD-AGENDA-NEXT-PERIOD-026.png, EVID-PROD-STD-AGENDA-PREV-PERIOD-026.png, EVID-PROD-STD-AGENDA-TODAY-026.png, EVID-PROD-ADM-AGENDA-NEXT-PERIOD-026.png, EVID-PROD-ADM-AGENDA-PREV-PERIOD-026.png, EVID-PROD-ADM-AGENDA-TODAY-026.png

Resultado encontrado: botoes Hoje, Periodo anterior e Proximo periodo estao disponiveis nos dois perfis e responderam visualmente. A validacao de persistencia nao se aplica porque a acao e apenas navegacao.

Observacao: por causa da inconsistencia de dados no usuario padrao, a navegacao nao garante visibilidade correta dos compromissos.

### AGENDA-TECH-007

Modulo: Agenda
Funcionalidade: Console do navegador
Perfis: Usuario padrao e administrador
Status: FALHOU
Severidade: BAIXO

Resultado encontrado: console registrou avisos de grafico com width/height negativos e aviso de DialogContent sem Description ou aria-describedby.

Resultado esperado: evitar warnings de layout/acessibilidade, especialmente em dialogos e graficos responsivos.

## Comparacao entre perfis

- Administrador visualizou eventos de multiplos usuarios na Agenda, inclusive atividades agendadas por usuario padrao.
- Usuario padrao visualizou seus eventos na visao Dia, mas nao nas visoes Semana, Mes e Lista.
- Administrador possui filtro por equipe/usuario; usuario padrao nao possui esse filtro.
- Administrador visualiza menu de linha com Editar e Excluir; no usuario padrao a Lista ficou vazia, entao menu de linha nao ficou disponivel para comparar.
- Ambos os perfis conseguem abrir o formulario de novo agendamento e ambos exibem Adicionar desabilitado quando o titulo esta vazio.

## Evidencias geradas

Pasta: C:\Users\andre\vimob-crm

- EVID-PROD-ADM-AGENDA-WEEK-026.png
- EVID-PROD-ADM-AGENDA-FILTERS-026.png
- EVID-PROD-ADM-AGENDA-USER-FILTER-DROPDOWN-026.png
- EVID-PROD-ADM-AGENDA-DAY-026.png
- EVID-PROD-ADM-AGENDA-WEEK-REFRESH-026.png
- EVID-PROD-ADM-AGENDA-MONTH-026.png
- EVID-PROD-ADM-AGENDA-LIST-026.png
- EVID-PROD-ADM-AGENDA-NEW-MODAL-026.png
- EVID-PROD-ADM-AGENDA-EVENT-ROW-MENU-026.png
- EVID-PROD-ADM-AGENDA-NEXT-PERIOD-026.png
- EVID-PROD-ADM-AGENDA-PREV-PERIOD-026.png
- EVID-PROD-ADM-AGENDA-TODAY-026.png
- EVID-PROD-STD-AGENDA-WEEK-026.png
- EVID-PROD-STD-AGENDA-FILTERS-026.png
- EVID-PROD-STD-AGENDA-DAY-026.png
- EVID-PROD-STD-AGENDA-WEEK-REFRESH-026.png
- EVID-PROD-STD-AGENDA-MONTH-026.png
- EVID-PROD-STD-AGENDA-LIST-026.png
- EVID-PROD-STD-AGENDA-NEW-MODAL-026.png
- EVID-PROD-STD-AGENDA-NEXT-PERIOD-026.png
- EVID-PROD-STD-AGENDA-PREV-PERIOD-026.png
- EVID-PROD-STD-AGENDA-TODAY-026.png

## Dados criados, alterados ou limpos

- Dados criados: nenhum.
- Dados alterados: nenhum.
- Dados excluidos: nenhum.
- Limpeza realizada: nao aplicavel.

## Recomendacao de prioridade

1. Corrigir a divergencia entre visualizacoes da Agenda para usuario padrao.
2. Ajustar a mensagem de estado vazio da Lista para nao mencionar "lead" na Agenda geral.
3. Validar se administradores devem editar/excluir atividades de todos os usuarios pela Agenda.
4. Corrigir avisos de layout/acessibilidade observados no console.

## Observacao final

Esta rodada nao testou persistencia de criacao/edicao/exclusao porque o ambiente e de producao e a instrucao atual e nao alterar dados reais. A falha principal foi comprovada apenas por navegacao segura: o mesmo usuario ve atividade em uma visualizacao e nao ve nas demais.
