# Relatório de Auditoria Funcional - Produção - Continuação 33

Data: 14/07/2026
Ambiente: produção, navegador, VIMob CRM
Módulo auditado: Automações
Perfis: administrador e usuário padrão
Escopo: lista de automações, modelos, histórico, saúde, builder e permissões por URL direta
Dados alterados: nenhum

## Resumo executivo

A auditoria desta continuação cobriu **Automações** em produção. O administrador acessa lista, modelos, histórico, saúde operacional e builder visual. O usuário padrão não vê Automações no menu, mas consegue abrir as rotas diretas do módulo: lista, histórico e saúde retornam mensagens de permissão/erro; modelos aparecem em modo somente consulta.

Não foram ativadas automações, duplicadas, excluídas, salvas, simuladas ou executadas. O builder foi aberto apenas para inspeção visual e abandonado sem salvar.

Total de evidências desta continuação: 20 imagens.

## Cobertura executada

- Admin:
  - `/automations?tab=automations`
  - `/automations?tab=templates`
  - `/automations?tab=history`
  - `/automations?tab=health`
- Admin builder:
  - Nova automação
  - Editar automação existente
  - Usar modelo
- Admin histórico:
  - Todas
  - Em execução
  - Concluídas
  - Falhas
  - Canceladas
  - detalhes de execução
  - dropdown de automações
  - dropdown de quantidade
- Usuário padrão:
  - menu sem Automações
  - acesso direto às quatro abas

## Achados principais

### Médio - Usuário padrão acessa shell de Automações por URL direta

ID: AUTO-STD-PERM-001
Perfil: usuário padrão
URLs:

- `/automations?tab=automations`
- `/automations?tab=templates`
- `/automations?tab=history`
- `/automations?tab=health`

Resultado encontrado: o menu lateral não exibe Automações, mas as rotas diretas carregam a tela do módulo com abas visíveis. Lista e Histórico mostram mensagem de falta de permissão; Saúde mostra falha de consulta; Modelos aparece em modo somente consulta.

Status: Parcial
Severidade: Médio
Evidências:

- `EVID-PROD-STD-AUTOMACOES-LISTA-DIRETO-033.png`
- `EVID-PROD-STD-AUTOMACOES-MODELOS-DIRETO-033.png`
- `EVID-PROD-STD-AUTOMACOES-HISTORICO-DIRETO-033.png`
- `EVID-PROD-STD-AUTOMACOES-SAUDE-DIRETO-033.png`

Impacto: a API parece negar operações sensíveis, mas a interface ainda revela o módulo e seus modelos. Recomenda-se bloquear a rota inteira ou apresentar uma tela única e clara de acesso restrito.

### Médio - Mensagem de permissão aparece em inglês para usuário padrão

ID: AUTO-STD-MSG-001
Perfil: usuário padrão
Resultado encontrado: nas abas Lista e Histórico, a mensagem visível inclui `You do not have permission to perform this action.`

Status: Parcial
Severidade: Médio
Evidências:

- `EVID-PROD-STD-AUTOMACOES-LISTA-DIRETO-033.png`
- `EVID-PROD-STD-AUTOMACOES-HISTORICO-DIRETO-033.png`

Impacto: inconsistência de idioma em fluxo de autorização, prejudicando clareza para usuários finais.

### Médio - Ações críticas ficam disponíveis diretamente na lista admin

ID: AUTO-ADM-ACTION-001
Perfil: administrador
URL: `/automations?tab=automations`

Resultado encontrado: cada automação listada mostra controles de ativar, ver histórico, duplicar e excluir. Os switches de ativação e botões de exclusão não foram acionados por risco em produção.

Status: Bloqueado por segurança
Severidade: Médio
Evidência: `EVID-PROD-ADM-AUTOMACOES-LISTA-033.png`

Impacto: ações de alto impacto estão expostas em linha. Recomenda-se confirmar se há confirmação, feedback, trilha de auditoria e proteção contra clique acidental.

### Médio - Builder abre com botão Salvar habilitado

ID: AUTO-ADM-BUILDER-001
Perfil: administrador
Fluxos:

- Nova automação
- Editar automação existente
- Usar modelo

Resultado encontrado: o builder visual abriu com controles de salvar, simular localmente, adicionar blocos, mostrar variáveis, zoom e edição de nós. Em nova automação e ao usar modelo, o botão `Salvar` estava visível/habilitado. Não foi clicado.

Status: Parcial
Severidade: Médio
Evidências:

- `EVID-PROD-ADM-AUTOMACOES-NOVA-FORM-033.png`
- `EVID-PROD-ADM-AUTOMACOES-EDITAR-EXISTENTE-033.png`
- `EVID-PROD-ADM-AUTOMACOES-USAR-MODELO-FORM-033.png`

Impacto: se o salvamento não exigir nome/validação adequada, pode criar automações incompletas. O envio não foi testado para não alterar produção.

### Baixo - Avisos técnicos recorrentes no console

ID: AUTO-TECH-001
Perfis: administrador e usuário padrão
Resultado encontrado: persistem avisos de dimensões inválidas em gráficos (`width/height` igual a `-1` ou `0`). Não houve erro crítico no console durante esta continuação.

Status: Parcial
Severidade: Baixo

## Comparação por perfil

| Área | Administrador | Usuário padrão | Resultado |
|---|---|---|---|
| Menu Automações | Visível | Não visível | Aprovado |
| Lista | Lista automações e ações | Tela abre por URL, mas API nega | Parcial |
| Modelos | Botões `Usar modelo` | Modelos visíveis em `Somente consulta` | Parcial |
| Histórico | Métricas, filtros, detalhes | Tela abre por URL, mas API nega | Parcial |
| Saúde | Alertas operacionais e botão atualizar | Tela abre por URL, mas consulta falha | Parcial |
| Builder | Acessível ao admin | Não acessado pelo padrão | Aprovado para permissão |

## Testes executados

| ID | Perfil | Funcionalidade | Status | Evidência |
|---|---|---|---|---|
| AUTO-ADM-001 | Admin | Lista de automações | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-LISTA-033.png` |
| AUTO-ADM-002 | Admin | Modelos | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-MODELOS-033.png` |
| AUTO-ADM-003 | Admin | Histórico | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-033.png` |
| AUTO-ADM-004 | Admin | Saúde | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-SAUDE-033.png` |
| AUTO-ADM-005 | Admin | Nova automação | Bloqueado sem salvar | `EVID-PROD-ADM-AUTOMACOES-NOVA-FORM-033.png` |
| AUTO-ADM-006 | Admin | Editar automação existente | Bloqueado sem salvar | `EVID-PROD-ADM-AUTOMACOES-EDITAR-EXISTENTE-033.png` |
| AUTO-ADM-007 | Admin | Usar modelo | Bloqueado sem salvar | `EVID-PROD-ADM-AUTOMACOES-USAR-MODELO-FORM-033.png` |
| AUTO-ADM-008 | Admin | Histórico - Em execução | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-EM-EXECUCAO-033.png` |
| AUTO-ADM-009 | Admin | Histórico - Concluídas | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-CONCLUIDAS-033.png` |
| AUTO-ADM-010 | Admin | Histórico - Falhas | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-FALHAS-033.png` |
| AUTO-ADM-011 | Admin | Histórico - Canceladas | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-CANCELADAS-033.png` |
| AUTO-ADM-012 | Admin | Histórico - Todas | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-TODAS-033.png` |
| AUTO-ADM-013 | Admin | Detalhes de execução | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-DETALHES-033.png` |
| AUTO-ADM-014 | Admin | Dropdown automações | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-DROPDOWN-AUTOMACOES-033.png` |
| AUTO-ADM-015 | Admin | Dropdown quantidade | Aprovado visual | `EVID-PROD-ADM-AUTOMACOES-HISTORICO-DROPDOWN-QUANTIDADE-033.png` |
| AUTO-STD-001 | Padrão | Menu sem Automações | Aprovado | `EVID-PROD-STD-AUTOMACOES-MENU-AUSENTE-033.png` |
| AUTO-STD-002 | Padrão | Lista por URL direta | Parcial | `EVID-PROD-STD-AUTOMACOES-LISTA-DIRETO-033.png` |
| AUTO-STD-003 | Padrão | Modelos por URL direta | Parcial | `EVID-PROD-STD-AUTOMACOES-MODELOS-DIRETO-033.png` |
| AUTO-STD-004 | Padrão | Histórico por URL direta | Parcial | `EVID-PROD-STD-AUTOMACOES-HISTORICO-DIRETO-033.png` |
| AUTO-STD-005 | Padrão | Saúde por URL direta | Parcial | `EVID-PROD-STD-AUTOMACOES-SAUDE-DIRETO-033.png` |

## Evidências

- `EVID-PROD-ADM-AUTOMACOES-LISTA-033.png`
- `EVID-PROD-ADM-AUTOMACOES-MODELOS-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-033.png`
- `EVID-PROD-ADM-AUTOMACOES-SAUDE-033.png`
- `EVID-PROD-ADM-AUTOMACOES-NOVA-FORM-033.png`
- `EVID-PROD-ADM-AUTOMACOES-EDITAR-EXISTENTE-033.png`
- `EVID-PROD-ADM-AUTOMACOES-USAR-MODELO-FORM-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-EM-EXECUCAO-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-CONCLUIDAS-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-FALHAS-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-CANCELADAS-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-FILTRO-TODAS-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-DETALHES-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-DROPDOWN-AUTOMACOES-033.png`
- `EVID-PROD-ADM-AUTOMACOES-HISTORICO-DROPDOWN-QUANTIDADE-033.png`
- `EVID-PROD-STD-AUTOMACOES-MENU-AUSENTE-033.png`
- `EVID-PROD-STD-AUTOMACOES-LISTA-DIRETO-033.png`
- `EVID-PROD-STD-AUTOMACOES-MODELOS-DIRETO-033.png`
- `EVID-PROD-STD-AUTOMACOES-HISTORICO-DIRETO-033.png`
- `EVID-PROD-STD-AUTOMACOES-SAUDE-DIRETO-033.png`

## Limitações

- Não foram ativadas automações por risco operacional.
- Não foram executados botões de duplicar ou excluir.
- Não foi usado `Simular localmente`, pois poderia executar fluxo de automação em produção.
- Nenhum builder foi salvo.
- O botão `Atualizar` da aba Saúde não foi acionado.

## Recomendações

1. Bloquear a rota inteira de Automações para usuário padrão ou apresentar tela única de acesso restrito.
2. Localizar mensagens de permissão para português.
3. Confirmar validações obrigatórias antes de permitir salvar automação nova ou modelo.
4. Adicionar confirmação para ativar, excluir e duplicar automações.
5. Manter trilha de auditoria visível para ações de alto impacto.

## Estado final

A sessão foi retornada ao perfil administrador. Nenhum dado de produção foi criado, salvo, ativado, duplicado, excluído, simulado ou executado durante esta continuação.
