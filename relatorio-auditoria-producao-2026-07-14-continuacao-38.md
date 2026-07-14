# Relatorio de Auditoria - Producao - Continuacao 38

Data: 2026-07-14
Ambiente: producao, `https://app.vimobcrm.com.br`
Perfis auditados: administrador e usuario padrao
Escopo: rotas protegidas remanescentes acessadas diretamente pelo navegador em producao
Metodo: navegacao real no browser, sem alterar dados, sem conectar/desconectar integracoes e sem acionar comandos de escrita.

## Resumo executivo

Foram auditadas 8 rotas protegidas remanescentes em ambos os perfis, totalizando 16 verificacoes de rota, mais evidencias de troca de sessao e retorno final ao administrador. A sessao final foi restaurada no perfil administrador.

Achado mais relevante: o usuario padrao acessa diretamente a rota de integracao Meta e, apesar do card indicar acesso restrito, o sistema abre o modal de integracao com dados configurados e botoes administrativos. Nenhuma acao administrativa foi clicada por seguranca de producao.

Evidencias desta continuacao: 18 arquivos PNG.
Total acumulado de evidencias `EVID-PROD-*.png`: 390.

## Rotas auditadas

| Rota | Administrador | Usuario padrao | Status |
| --- | --- | --- | --- |
| `/notifications` | Pagina abre com filtros e lista de notificacoes. | Pagina abre com filtros e lista de notificacoes. | Parcial |
| `/suporte` | Central de ajuda abre com acoes rapidas e FAQ. | Central de ajuda abre com as mesmas acoes rapidas. | Parcial |
| `/attention` | Retorna 404 generico do Next.js. | Retorna 404 generico do Next.js. | Falhou |
| `/dashboard/campaigns` | Tela abre, mas conteudo fica em blocos vazios/skeleton. | Tela abre, mas conteudo fica em blocos vazios/skeleton. | Parcial |
| `/dashboard/site` | Dashboard do site abre com estado sem dados e KPIs zerados. | Dashboard do site tambem abre por URL direta. | Parcial |
| `/pipeline` | Redireciona para `/crm/pipelines`. | Redireciona para `/crm/pipelines`. | Aprovado |
| `/settings/integrations/meta` | Abre configuracoes/integracao Meta com modal administrativo. | Abre modal de Meta mesmo com card marcado como sem acesso. | Falhou |
| `/settings/integrations/grupo-olx` | Abre modal de Grupo OLX em carregamento. | Fica em shell de Configuracoes praticamente vazio, sem negativa clara. | Parcial |

## Problemas encontrados

### Alto - Usuario padrao acessa modal administrativo de Meta por URL direta

ID: MISC-STD-INT-META-001
Perfil: usuario padrao
URL: `/settings/integrations/meta`
Resultado esperado: o usuario padrao deveria receber bloqueio claro, redirecionamento seguro ou tela sem dados administrativos.
Resultado encontrado: a tela de configuracoes mostra o card Meta como sem acesso, mas a URL direta abre o modal de integracao, exibindo configuracao existente e botoes como gerenciar contas, adicionar formularios e acoes de linha.
Status: FALHOU
Severidade: ALTA
Impacto: risco de exposicao de dados de integracao e possivel execucao de acoes administrativas caso os botoes estejam ativos no backend.
Evidencia: `EVID-PROD-STD-MISC-SETTINGS_META-038.png`

### Medio - Rota direta de Grupo OLX tem comportamento inconsistente

ID: MISC-STD-INT-OLX-001
Perfil: usuario padrao
URL: `/settings/integrations/grupo-olx`
Resultado esperado: bloqueio claro para usuario sem permissao ou conteudo restrito consistente.
Resultado encontrado: a pagina fica apenas com o shell de Configuracoes e notificacao, sem cards, mensagem de erro, redirecionamento ou explicacao de permissao. No administrador, a rota abriu modal de Grupo OLX em carregamento.
Status: PARCIAL
Severidade: MEDIA
Impacto: experiencia quebrada e ausencia de feedback de autorizacao.
Evidencias: `EVID-PROD-STD-MISC-SETTINGS_GRUPO_OLX-038.png`, `EVID-PROD-ADM-MISC-SETTINGS_GRUPO_OLX-038.png`

### Medio - Dashboard de campanhas carrega sem conteudo util

ID: MISC-DASH-CAMPAIGNS-001
Perfis: administrador e usuario padrao
URL: `/dashboard/campaigns`
Resultado esperado: exibicao de metricas, estado vazio explicativo ou erro compreensivel.
Resultado encontrado: a pagina abre com titulo, filtros e blocos vazios/skeleton, sem mensagem de erro nem conteudo final visivel.
Status: PARCIAL
Severidade: MEDIA
Impacto: usuario nao consegue saber se nao existem dados, se a consulta falhou ou se a tela esta travada.
Evidencias: `EVID-PROD-ADM-MISC-DASHBOARD_CAMPAIGNS-038.png`, `EVID-PROD-STD-MISC-DASHBOARD_CAMPAIGNS-038.png`

### Medio - Notificacoes exibem placeholders ou dados de teste em producao

ID: MISC-NOTIF-001
Perfis: administrador e usuario padrao
URL: `/notifications`
Resultado esperado: notificacoes finais sem placeholders tecnicos ou dados ficticios.
Resultado encontrado: a lista contem notificacoes com placeholder de nome de lead e texto de teste em producao. O administrador tambem possui alto volume de notificacoes historicas e contador de nao lidas.
Status: PARCIAL
Severidade: MEDIA
Impacto: reduz confianca operacional e pode indicar evento de teste gerando notificacao real.
Evidencias: `EVID-PROD-ADM-MISC-NOTIFICATIONS-038.png`, `EVID-PROD-STD-MISC-NOTIFICATIONS-038.png`

### Medio - Central de ajuda mostra acoes administrativas ao usuario padrao

ID: MISC-SUPPORT-PERM-001
Perfil: usuario padrao
URL: `/suporte`
Resultado esperado: acoes rapidas alinhadas as permissoes do perfil ou com bloqueio claro antes de iniciar fluxo.
Resultado encontrado: o usuario padrao ve acoes como configurar WhatsApp, criar automacao, configurar equipes e configurar cadencias. As acoes nao foram clicadas nesta continuacao para evitar alteracao de producao.
Status: PARCIAL
Severidade: MEDIA
Impacto: risco de confusao operacional e possivel divergencia entre interface e permissao real.
Evidencias: `EVID-PROD-ADM-MISC-SUPORTE-038.png`, `EVID-PROD-STD-MISC-SUPORTE-038.png`

### Baixo/Medio - `/attention` retorna 404 generico

ID: MISC-ATTENTION-001
Perfis: administrador e usuario padrao
URL: `/attention`
Resultado esperado: se a rota for valida, deveria abrir a tela; se for obsoleta, deveria redirecionar ou exibir erro do produto.
Resultado encontrado: retorna pagina generica `404 This page could not be found`.
Status: FALHOU
Severidade: BAIXA/MEDIA
Impacto: link direto ou referencia antiga gera experiencia quebrada.
Evidencias: `EVID-PROD-ADM-MISC-ATTENTION-038.png`, `EVID-PROD-STD-MISC-ATTENTION-038.png`

### Baixo - Avisos tecnicos recorrentes no console

ID: MISC-CONSOLE-001
Perfis: administrador e usuario padrao
Resultado encontrado: logs recorrentes de inicializacao de push ignorada no ambiente web e avisos de graficos com largura/altura invalidas, especialmente em dashboards.
Status: PARCIAL
Severidade: BAIXA
Impacto: pode explicar blocos vazios/skeleton em dashboards e deve ser investigado junto aos componentes de grafico.
Evidencia relacionada: logs coletados na aba final e prints dos dashboards.

## Pontos aprovados ou esperados

- `/pipeline` redirecionou corretamente para `/crm/pipelines` nos dois perfis.
- `/dashboard/site` abriu nos dois perfis com estado vazio explicito, KPIs zerados e seletor de periodo. Caso analytics do site deva ser restrito a administradores, ainda e necessario adicionar regra de autorizacao.
- A sessao final foi restaurada no administrador com sucesso apos auditar o usuario padrao.

## Acoes nao executadas por seguranca

- Marcar notificacoes como lidas ou nao lidas.
- Clicar em conectar, gerenciar contas, adicionar formularios ou menus de linha de integracoes.
- Acionar quick actions da central de ajuda que poderiam navegar para fluxos administrativos.
- Alterar filtros com potencial de persistencia ou disparo de consultas administrativas sensiveis.

## Evidencias geradas

- `EVID-PROD-ADM-MISC-NOTIFICATIONS-038.png`
- `EVID-PROD-ADM-MISC-SUPORTE-038.png`
- `EVID-PROD-ADM-MISC-ATTENTION-038.png`
- `EVID-PROD-ADM-MISC-DASHBOARD_CAMPAIGNS-038.png`
- `EVID-PROD-ADM-MISC-DASHBOARD_SITE-038.png`
- `EVID-PROD-ADM-MISC-PIPELINE_LEGACY-038.png`
- `EVID-PROD-ADM-MISC-SETTINGS_META-038.png`
- `EVID-PROD-ADM-MISC-SETTINGS_GRUPO_OLX-038.png`
- `EVID-PROD-STD-MISC-LOGIN-DASHBOARD-038.png`
- `EVID-PROD-STD-MISC-NOTIFICATIONS-038.png`
- `EVID-PROD-STD-MISC-SUPORTE-038.png`
- `EVID-PROD-STD-MISC-ATTENTION-038.png`
- `EVID-PROD-STD-MISC-DASHBOARD_CAMPAIGNS-038.png`
- `EVID-PROD-STD-MISC-DASHBOARD_SITE-038.png`
- `EVID-PROD-STD-MISC-PIPELINE_LEGACY-038.png`
- `EVID-PROD-STD-MISC-SETTINGS_META-038.png`
- `EVID-PROD-STD-MISC-SETTINGS_GRUPO_OLX-038.png`
- `EVID-PROD-ADM-MISC-RETORNO-FINAL-038.png`

## Dados criados e limpeza

Dados criados nesta continuacao: nenhum.
Dados alterados nesta continuacao: nenhum.
Limpeza necessaria: nao aplicavel.

## Recomendacao de prioridade

1. Corrigir autorizacao e roteamento direto das integracoes, especialmente Meta.
2. Adicionar bloqueio/feedback claro para rotas de integracao sem permissao.
3. Resolver carregamento vazio do dashboard de campanhas.
4. Limpar placeholders de notificacoes em producao.
5. Revisar a central de ajuda para ocultar ou bloquear acoes administrativas para usuario padrao.
6. Decidir se `/attention` deve existir; se nao, remover referencias e redirecionamentos antigos.
