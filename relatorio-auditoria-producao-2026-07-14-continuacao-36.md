# Relatório de Auditoria em Produção - Continuação 36

Data: 2026-07-14
Ambiente: Produção, navegador
Escopo: proteção de rotas privadas sem sessão autenticada.
Restrição: nenhum formulário foi enviado, nenhum dado foi criado, removido ou alterado.

## Resumo

Esta rodada validou acesso anônimo direto a rotas internas do CRM. O administrador foi deslogado, as URLs privadas foram acessadas manualmente pela barra/navegação direta e cada resultado foi capturado.

Resultado principal: as 12 rotas privadas testadas redirecionaram para `/login` e não expuseram shell autenticado, dados, menus internos ou telas administrativas.

A sessão terminou autenticada novamente como administrador.

Total geral de evidências após esta rodada: 336 arquivos PNG.

## Rotas testadas

| Rota | Resultado |
| --- | --- |
| `/dashboard` | Redirecionou para `/login` |
| `/crm/contacts` | Redirecionou para `/login` |
| `/crm/pipelines` | Redirecionou para `/login` |
| `/crm/conversas` | Redirecionou para `/login` |
| `/properties` | Redirecionou para `/login` |
| `/agenda` | Redirecionou para `/login` |
| `/automations` | Redirecionou para `/login` |
| `/financeiro` | Redirecionou para `/login` |
| `/settings` | Redirecionou para `/login` |
| `/admin` | Redirecionou para `/login` |
| `/notifications` | Redirecionou para `/login` |
| `/select-organization` | Redirecionou para `/login` |

## Evidências

As capturas anônimas foram redigidas nos campos de e-mail e senha porque o navegador pré-preencheu visualmente o formulário de login. A redação foi aplicada somente sobre o formulário de login nas evidências, sem alterar o comportamento observado.

- `EVID-PROD-ANON-LOGOUT-LOGIN-036.png`
- `EVID-PROD-ANON-ROUTE-DASHBOARD-036.png`
- `EVID-PROD-ANON-ROUTE-CRM-CONTACTS-036.png`
- `EVID-PROD-ANON-ROUTE-CRM-PIPELINES-036.png`
- `EVID-PROD-ANON-ROUTE-CRM-CONVERSAS-036.png`
- `EVID-PROD-ANON-ROUTE-PROPERTIES-036.png`
- `EVID-PROD-ANON-ROUTE-AGENDA-036.png`
- `EVID-PROD-ANON-ROUTE-AUTOMATIONS-036.png`
- `EVID-PROD-ANON-ROUTE-FINANCEIRO-036.png`
- `EVID-PROD-ANON-ROUTE-SETTINGS-036.png`
- `EVID-PROD-ANON-ROUTE-ADMIN-036.png`
- `EVID-PROD-ANON-ROUTE-NOTIFICATIONS-036.png`
- `EVID-PROD-ANON-ROUTE-SELECT-ORGANIZATION-036.png`
- `EVID-PROD-ANON-RETORNO-ADM-FINAL-036.png`

## Achados

1. Positivo - Nenhuma rota privada testada expôs conteúdo sem sessão.
2. Baixo - O redirecionamento cai em `/login` sem mensagem explícita de sessão expirada ou acesso necessário. Isso é seguro, mas pode ser pouco claro para usuário vindo de link direto.
3. Baixo - Não foi observado parâmetro visível de retorno na URL de login após tentar uma rota interna. Se a intenção for preservar deep link após autenticação, vale validar e ajustar.
4. Baixo - Logs continuam registrando inicialização de push ignorada no ambiente web e avisos de gráfico com largura/altura inválida após retorno ao dashboard.

## Limitações controladas

Não foram testadas todas as rotas internas possíveis, mas a amostra cobriu módulos principais e rotas administrativas sensíveis. Também não foi executado teste de API direta fora do navegador.

Não foi testado retorno pós-login para cada deep link, porque a validação desta rodada focou no bloqueio anônimo e na ausência de vazamento antes da autenticação.
