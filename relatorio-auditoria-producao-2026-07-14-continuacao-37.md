# Relatório de Auditoria em Produção - Continuação 37

Data: 2026-07-14
Ambiente: Produção, navegador
Escopo: rotas autenticadas `/admin/*` de administração de plataforma.
Perfis: administrador de organização e usuário padrão.
Restrição: nenhuma ação de escrita foi executada.

## Resumo

Foram auditadas 17 rotas de administração de plataforma com os dois perfis. Em todos os casos, a aplicação manteve a URL `/admin/*`, mas renderizou uma tela bloqueada com a mensagem de que o painel é exclusivo para superadmin e não fica disponível para usuários comuns ou administradores de organização.

Resultado principal: não houve exposição de listas, dados de plataforma, logs, usuários, organizações, planos, templates, configurações ou controles de superadmin para nenhum dos dois perfis auditados.

A sessão terminou autenticada novamente como administrador.

Total geral de evidências após esta rodada: 372 arquivos PNG.

## Rotas Testadas

As rotas abaixo tiveram o mesmo resultado para administrador de organização e usuário padrão: tela de bloqueio exclusiva para superadmin.

| Rota | Resultado |
| --- | --- |
| `/admin` | Bloqueada |
| `/admin/organizations` | Bloqueada |
| `/admin/users` | Bloqueada |
| `/admin/plans` | Bloqueada |
| `/admin/requests` | Bloqueada |
| `/admin/audit` | Bloqueada |
| `/admin/database` | Bloqueada |
| `/admin/error-logs` | Bloqueada |
| `/admin/email-logs` | Bloqueada |
| `/admin/email-templates` | Bloqueada |
| `/admin/notifications` | Bloqueada |
| `/admin/announcements` | Bloqueada |
| `/admin/onboarding` | Bloqueada |
| `/admin/help` | Bloqueada |
| `/admin/settings` | Bloqueada |
| `/admin/system-settings` | Bloqueada |
| `/admin/ai` | Bloqueada |

## Evidências

Administrador de organização:

- `EVID-PROD-ADM-PLATFORM-HOME-037.png`
- `EVID-PROD-ADM-PLATFORM-ORGANIZATIONS-037.png`
- `EVID-PROD-ADM-PLATFORM-USERS-037.png`
- `EVID-PROD-ADM-PLATFORM-PLANS-037.png`
- `EVID-PROD-ADM-PLATFORM-REQUESTS-037.png`
- `EVID-PROD-ADM-PLATFORM-AUDIT-037.png`
- `EVID-PROD-ADM-PLATFORM-DATABASE-037.png`
- `EVID-PROD-ADM-PLATFORM-ERROR_LOGS-037.png`
- `EVID-PROD-ADM-PLATFORM-EMAIL_LOGS-037.png`
- `EVID-PROD-ADM-PLATFORM-EMAIL_TEMPLATES-037.png`
- `EVID-PROD-ADM-PLATFORM-NOTIFICATIONS-037.png`
- `EVID-PROD-ADM-PLATFORM-ANNOUNCEMENTS-037.png`
- `EVID-PROD-ADM-PLATFORM-ONBOARDING-037.png`
- `EVID-PROD-ADM-PLATFORM-HELP-037.png`
- `EVID-PROD-ADM-PLATFORM-SETTINGS-037.png`
- `EVID-PROD-ADM-PLATFORM-SYSTEM_SETTINGS-037.png`
- `EVID-PROD-ADM-PLATFORM-AI-037.png`

Usuário padrão:

- `EVID-PROD-STD-PLATFORM-HOME-037.png`
- `EVID-PROD-STD-PLATFORM-ORGANIZATIONS-037.png`
- `EVID-PROD-STD-PLATFORM-USERS-037.png`
- `EVID-PROD-STD-PLATFORM-PLANS-037.png`
- `EVID-PROD-STD-PLATFORM-REQUESTS-037.png`
- `EVID-PROD-STD-PLATFORM-AUDIT-037.png`
- `EVID-PROD-STD-PLATFORM-DATABASE-037.png`
- `EVID-PROD-STD-PLATFORM-ERROR_LOGS-037.png`
- `EVID-PROD-STD-PLATFORM-EMAIL_LOGS-037.png`
- `EVID-PROD-STD-PLATFORM-EMAIL_TEMPLATES-037.png`
- `EVID-PROD-STD-PLATFORM-NOTIFICATIONS-037.png`
- `EVID-PROD-STD-PLATFORM-ANNOUNCEMENTS-037.png`
- `EVID-PROD-STD-PLATFORM-ONBOARDING-037.png`
- `EVID-PROD-STD-PLATFORM-HELP-037.png`
- `EVID-PROD-STD-PLATFORM-SETTINGS-037.png`
- `EVID-PROD-STD-PLATFORM-SYSTEM_SETTINGS-037.png`
- `EVID-PROD-STD-PLATFORM-AI-037.png`

Sessões:

- `EVID-PROD-STD-PLATFORM-LOGIN-DASHBOARD-037.png`
- `EVID-PROD-ADM-PLATFORM-RETORNO-FINAL-037.png`

## Achados

1. Positivo - As rotas de superadmin não expuseram dados nem controles para administrador de organização ou usuário padrão.
2. Baixo - A URL permanece em `/admin/*` mesmo após o bloqueio. Isso é seguro neste teste, mas pode confundir suporte, logs de navegação e expectativa de redirecionamento.
3. Baixo - A tela bloqueada exibe apenas `Sair desta área`, sem caminho explícito de suporte, explicação de papel necessário ou link para dashboard com contexto.
4. Baixo - Persistem logs técnicos já observados em rodadas anteriores: inicialização de push ignorada em ambiente web e avisos de gráficos com dimensões inválidas no retorno ao dashboard.

## Limitações Controladas

Não foi auditado um usuário com papel real de superadmin, portanto esta rodada comprova o bloqueio para administrador de organização e usuário padrão, mas não valida a funcionalidade interna do painel de superadmin.

Nenhum botão de ação foi acionado nas rotas bloqueadas; apenas o fluxo de logout/login e navegação direta foi usado.
