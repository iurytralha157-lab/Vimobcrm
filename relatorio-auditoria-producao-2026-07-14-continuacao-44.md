# Relatorio de Auditoria - Producao - Continuacao 44

Data: 2026-07-14
Ambiente: producao, `https://app.vimobcrm.com.br`
Navegador: Chrome real, viewport desktop controlado durante a rodada
Escopo: detalhe de lead existente, acoes internas e permissao de responsavel/status
Perfis: administrador de organizacao e usuario padrao
Restricao: nenhum dado salvo, nenhum responsavel alterado, nenhum status alterado, nenhuma mensagem enviada, nenhum anexo enviado e nenhum agendamento criado.

## Resumo executivo

Foi executada uma rodada de leitura e abertura segura do detalhe de lead a partir de `/crm/contacts`. Foram comparados administrador e usuario padrao em: abertura do detalhe, dados do contato, botoes de contato, historico/mensagens, agenda, cadencia, documentacao, edicao inline e seletor de responsavel. Foram geradas 10 evidencias validas novas, elevando o total acumulado para 456 imagens `EVID-PROD-*.png`.

Achado principal: o usuario padrao consegue abrir o seletor de responsavel dentro do detalhe do lead e visualizar opcoes de transferencia para outros usuarios, incluindo a opcao `Sem responsavel`. Nenhuma opcao foi selecionada, mas a exposicao do controle indica risco de permissao se o backend aceitar a troca.

Tambem foi confirmado que o usuario padrao consegue abrir edicao inline dos dados do contato com botao `Salvar dados` visivel. A acao pode ser esperada para leads atribuidos ao proprio usuario, mas deve ser validada contra a matriz de permissoes porque a tela tambem mostra historico operacional, cadencias, documentacao e acao de anexo.

A sessao final foi restaurada como administrador no dashboard. O viewport foi resetado e as abas do Chrome foram finalizadas.

## Cobertura desta rodada

| Funcionalidade | Administrador | Usuario padrao | Status |
| --- | --- | --- | --- |
| Abrir detalhe de lead pela lista | Modal de detalhe abriu. | Modal de detalhe abriu. | Aprovado |
| Dados do contato | Visiveis, com botao de edicao. | Visiveis, com botao de edicao. | Parcial |
| Seletor de responsavel | Exibe lista ampla de usuarios. | Exibe lista ampla de usuarios e `Sem responsavel`. | Falhou/parcial |
| Status do lead | Controle visivel. | Controle visivel. | Parcial |
| Chat/historico | Historico e mensagens aparecem. | Historico operacional aparece. | Parcial |
| Agenda/cadencia | Cards e acoes visiveis. | Cards e acoes visiveis. | Parcial |
| Documentacao/anexo | Acao de anexo visivel. | Acao de anexo visivel. | Nao executado por seguranca |
| Edicao inline | Abre campos editaveis e `Salvar dados`. | Abre campos editaveis e `Salvar dados`. | Nao salvo |

## Achados

### Alto - Usuario padrao visualiza seletor de responsavel com outros usuarios

ID: DETAIL-STD-RESPONSAVEL-001
Perfil: usuario padrao
URL: `/crm/contacts`
Resultado esperado: usuario padrao deve visualizar apenas a atribuicao permitida ou, se nao tiver permissao de transferencia, o seletor deve ficar oculto/bloqueado.
Resultado encontrado: o usuario padrao abriu o dropdown de responsavel no detalhe do lead e visualizou `Sem responsavel` e uma lista de usuarios internos, incluindo perfil administrador. Nenhuma selecao foi feita.
Status: PARCIAL/FALHOU NA INTERFACE
Severidade: ALTA
Impacto: se o backend aceitar a alteracao, o usuario padrao pode transferir ou remover responsavel de lead sem autorizacao. Mesmo se o backend bloquear, ha divergencia entre interface e permissao.
Evidencia: `EVID-PROD-STD-DETAIL-RESPONSAVEL-DROPDOWN-044.png`

### Medio - Usuario padrao abre edicao inline de contato com botao `Salvar dados`

ID: DETAIL-STD-EDIT-001
Perfil: usuario padrao
URL: `/crm/contacts`
Resultado esperado: campos editaveis devem refletir exatamente as permissoes do perfil. Se o usuario padrao pode editar apenas leads atribuidos a ele, a regra deve ser explicitamente validada no backend.
Resultado encontrado: o usuario padrao abriu edicao inline dos dados do contato e viu campos de nome, telefone, e-mail, cargo e empresa com botao `Salvar dados`. Nenhum campo foi alterado e nada foi salvo.
Status: PARCIAL
Severidade: MEDIA
Impacto: a edicao pode ser legitima para lead atribuido, mas o controle precisa ser verificado contra permissoes `lead_edit`, `lead_edit_all` e transferencia.
Evidencia: `EVID-PROD-STD-DETAIL-EDITAR-CONTATO-ABERTO-044.png`

### Medio - Detalhe do lead expõe muitas acoes operacionais em perfil padrao

ID: DETAIL-STD-ACTIONS-001
Perfil: usuario padrao
URL: `/crm/contacts`
Resultado encontrado: o detalhe do lead no usuario padrao mostra agenda, cadencia, historico operacional, botao de anexo/documentacao, botao de chat, botao de e-mail/contato e registro de feedback. Nenhuma acao foi executada por seguranca.
Status: PARCIAL
Severidade: MEDIA
Impacto: e necessario confirmar quais dessas acoes sao permitidas para o perfil padrao e quais devem ser bloqueadas/ocultas.
Evidencias: `EVID-PROD-STD-DETAIL-LEAD-ABERTO-044.png`, `EVID-PROD-STD-DETAIL-LEAD-CARREGADO-044.png`

### Positivo - Administrador tem acesso amplo esperado ao detalhe

ID: DETAIL-ADM-001
Perfil: administrador
URL: `/crm/contacts`
Resultado encontrado: o administrador abriu detalhe do lead, visualizou seletor de responsavel com lista ampla, status, dados do contato, edicao inline, agenda, cadencia, feedback, documentacao e historico/mensagens. Nenhuma alteracao foi feita.
Status: APROVADO/PARCIAL
Severidade: POSITIVO
Evidencias: `EVID-PROD-ADM-DETAIL-LEAD-ABERTO-044.png`, `EVID-PROD-ADM-DETAIL-LEAD-CARREGADO-044.png`, `EVID-PROD-ADM-DETAIL-RESPONSAVEL-DROPDOWN-044.png`, `EVID-PROD-ADM-DETAIL-EDITAR-CONTATO-ABERTO-044.png`

### Baixo/recorrente - Avisos tecnicos no console persistem

ID: DETAIL-CONSOLE-001
Perfis: administrador e usuario padrao
Resultado encontrado: durante a rodada, o console voltou a registrar avisos de `DialogContent` sem descricao acessivel e graficos com dimensao invalida no dashboard.
Status: PARCIAL
Severidade: BAIXA/MEDIA
Evidencia: `EVID-PROD-ADM-DETAIL-RETORNO-FINAL-044.png`

## Evidencias novas validas

- `EVID-PROD-ADM-DETAIL-LEAD-ABERTO-044.png`
- `EVID-PROD-ADM-DETAIL-LEAD-CARREGADO-044.png`
- `EVID-PROD-ADM-DETAIL-RESPONSAVEL-DROPDOWN-044.png`
- `EVID-PROD-ADM-DETAIL-EDITAR-CONTATO-ABERTO-044.png`
- `EVID-PROD-STD-DETAIL-CONTACTS-LISTA-044.png`
- `EVID-PROD-STD-DETAIL-LEAD-ABERTO-044.png`
- `EVID-PROD-STD-DETAIL-LEAD-CARREGADO-044.png`
- `EVID-PROD-STD-DETAIL-RESPONSAVEL-DROPDOWN-044.png`
- `EVID-PROD-STD-DETAIL-EDITAR-CONTATO-ABERTO-044.png`
- `EVID-PROD-ADM-DETAIL-RETORNO-FINAL-044.png`

## Dados e seguranca

Dados criados: nenhum.
Dados editados: nenhum.
Responsavel alterado: nao.
Status alterado: nao.
Mensagem enviada: nao.
Anexo enviado: nao.
Agendamento criado: nao.
Feedback registrado: nao.
Credenciais: nao registradas neste relatorio.
Sessao final: administrador restaurado no dashboard.
Viewport: resetado ao final.
Abas do Chrome: finalizadas ao final da rodada.

## Proxima prioridade recomendada

1. Testar em ambiente seguro se o backend bloqueia transferencia de responsavel por usuario padrao.
2. Validar matriz de permissoes para edicao inline de contato em lead atribuido versus lead de outro usuario.
3. Auditar os fluxos internos de agenda, anexo e feedback usando registros de auditoria seguros, sem dados reais.
