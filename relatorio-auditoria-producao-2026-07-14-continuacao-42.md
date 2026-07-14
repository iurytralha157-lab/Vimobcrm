# Relatorio de Auditoria - Producao - Continuacao 42

Data: 2026-07-14
Ambiente: producao, `https://app.vimobcrm.com.br`
Navegador: Chrome controlado pelo navegador real, viewport mobile `390x844`
Escopo: responsividade mobile e navegacao inferior para administrador e usuario padrao
Perfis: administrador de organizacao e usuario padrao
Restricao: nenhum formulario salvo, nenhum registro criado, editado ou excluido.

## Resumo executivo

Foi executada uma rodada especifica de auditoria mobile em producao, com login explicito nos dois perfis. Foram abertas e evidenciadas as rotas `Dashboard`, `Pipelines`, `Conversas`, `Configuracoes` e a acao `Mais` da navegacao inferior. Foram geradas 12 evidencias validas novas, elevando o total acumulado para 435 imagens `EVID-PROD-*.png`.

Achados principais:

- No mobile, os prompts flutuantes de instalacao/notificacao ficam sobre a mesma faixa da navegacao inferior e impediram a abertura confiavel do item `Mais`. No usuario padrao, a tentativa de abrir `Mais` foi interceptada pelo prompt de notificacao, que ficou preso em `Ativando...`.
- O usuario padrao ve dados de funil no dashboard, mas ao abrir `/crm/pipelines` no mobile recebe estado vazio/inconsistente de pipeline, impedindo o uso normal do quadro pelo celular.
- O dashboard mobile gera avisos repetidos de grafico com `width(0)`/`height(0)` ou `width(-1)`/`height(-1)` no console.
- A permissao de configuracoes de empresa se comportou corretamente: administrador visualiza acao de edicao, usuario padrao recebe bloqueio textual para editar dados da empresa.

A sessao final foi restaurada como administrador no dashboard, com senha atualizada informada pelo solicitante. O viewport do Chrome foi resetado ao final e as abas de auditoria foram finalizadas.

## Cobertura desta rodada

| Area | Administrador | Usuario padrao | Status |
| --- | --- | --- | --- |
| Dashboard mobile | Carrega indicadores completos e funil. | Carrega indicadores reduzidos e guia de configuracao inicial. | Parcial |
| Navegacao `Mais` | Clique nao abriu menu visivel; tela permaneceu no dashboard. | Clique foi interceptado por prompt de notificacao em overlay. | Falhou |
| Pipelines mobile | Quadro com cards e etapas visiveis. | Estado vazio/inconsistente apesar de dashboard listar funil e leads. | Falhou para usuario padrao |
| Conversas mobile | Lista de conversas carregada. | Estado vazio carregado, aparentemente coerente com permissao/dados do perfil. | Aprovado/parcial |
| Configuracoes mobile | Perfil e dados da empresa com acao de edicao. | Perfil visivel e dados da empresa bloqueados para edicao. | Aprovado |
| Retorno final | Administrador restaurado no dashboard. | Nao aplicavel. | Aprovado |

## Achados

### Medio/Alto - Prompts flutuantes sobrepoem a navegacao inferior mobile

ID: MOBILE-NAV-OVERLAY-001
Perfis: administrador e usuario padrao
URLs: `/dashboard`, `/crm/pipelines`, `/crm/conversas`, `/settings`
Resultado esperado: prompts de instalacao/notificacao devem respeitar a area segura da navegacao inferior, permitir fechamento confiavel e nao interceptar cliques em `Dashboard`, `Pipelines`, `Conversas` ou `Mais`.
Resultado encontrado: os prompts flutuantes ficam ancorados na mesma faixa vertical da bottom nav. No usuario padrao, ao tentar abrir `Mais`, o clique foi capturado pelo prompt de notificacao, que mudou para `Ativando...` e permaneceu em carregamento. Tentativas de fechar os prompts nao removeram o overlay de forma confiavel.
Status: FALHOU
Severidade: MEDIA/ALTA
Impacto: usuarios mobile podem nao conseguir acessar menus secundarios, e uma tentativa de navegacao pode disparar acao de notificacao/PWA nao pretendida.
Evidencias: `EVID-PROD-ADM-MOBILE-MAIS-VALID-042.png`, `EVID-PROD-STD-MOBILE-MAIS-VALID-042.png`, `EVID-PROD-STD-MOBILE-PIPELINES-VALID-042.png`, `EVID-PROD-STD-MOBILE-CONVERSAS-VALID-042.png`

### Alto - Pipeline mobile do usuario padrao abre em estado vazio/inconsistente

ID: MOBILE-STD-PIPELINE-001
Perfil: usuario padrao
URL: `/crm/pipelines`
Resultado esperado: o quadro mobile deveria exibir a pipeline e os leads/etapas permitidos para o usuario, de forma coerente com o funil exibido no dashboard.
Resultado encontrado: o dashboard do usuario padrao exibiu funil `Vendas` com 2 leads, mas a rota de pipelines mobile apresentou estado vazio/inconsistente de pipeline, sem cards trabalhaveis.
Status: FALHOU
Severidade: ALTA
Impacto: bloqueia o uso central do CRM pelo usuario padrao em celular, mesmo quando o dashboard indica que existem leads no funil.
Evidencias: `EVID-PROD-STD-MOBILE-DASHBOARD-VALID-042.png`, `EVID-PROD-STD-MOBILE-PIPELINES-VALID-042.png`

### Medio - Avisos repetidos de dimensao zero nos graficos mobile

ID: MOBILE-CHART-001
Perfis: administrador e usuario padrao
URL: `/dashboard`
Resultado esperado: graficos responsivos devem calcular dimensoes validas no viewport mobile, sem avisos repetidos.
Resultado encontrado: o console registrou multiplos avisos de grafico com largura/altura `0` ou `-1`, apontando container sem dimensao suficiente durante renderizacao.
Status: PARCIAL
Severidade: MEDIA
Impacto: risco de graficos renderizarem vazios, instaveis ou com layout quebrado em celulares, especialmente durante carregamento ou troca de abas do dashboard.
Evidencias: `EVID-PROD-ADM-MOBILE-DASHBOARD-VALID-042.png`, `EVID-PROD-STD-MOBILE-DASHBOARD-VALID-042.png`, `EVID-PROD-ADM-MOBILE-RETORNO-FINAL-VALID-042.png`

### Baixo/Medio - Guia de configuracao cobre o primeiro acesso mobile do usuario padrao

ID: MOBILE-STD-GUIDE-001
Perfil: usuario padrao
URL: `/dashboard`
Resultado esperado: se o guia abrir automaticamente, deve preservar contexto suficiente da tela, ser claramente dispensavel e nao concorrer com prompts inferiores.
Resultado encontrado: apos login do usuario padrao, o guia ocupou praticamente toda a tela mobile, enquanto banner superior e prompts inferiores tambem estavam presentes. O guia tinha botao de fechar e foi fechado para prosseguir.
Status: PARCIAL
Severidade: BAIXA/MEDIA
Impacto: primeira experiencia mobile fica congestionada e pode atrasar o acesso ao dashboard, especialmente porque ha outros overlays simultaneos.
Evidencia: `EVID-PROD-STD-MOBILE-DASHBOARD-GUIDE-VALID-042.png`

### Positivo - Configuracoes de empresa respeitam permissao do perfil

ID: MOBILE-SETTINGS-PERM-001
Perfis: administrador e usuario padrao
URL: `/settings`
Resultado encontrado: o administrador visualizou o bloco de dados da empresa com acao de edicao. O usuario padrao visualizou a informacao com mensagem indicando que apenas administradores podem editar dados da empresa.
Status: APROVADO
Severidade: POSITIVO
Evidencias: `EVID-PROD-ADM-MOBILE-SETTINGS-VALID-042.png`, `EVID-PROD-STD-MOBILE-SETTINGS-VALID-042.png`

## Evidencias novas

- `EVID-PROD-ADM-MOBILE-DASHBOARD-VALID-042.png`
- `EVID-PROD-ADM-MOBILE-MAIS-VALID-042.png`
- `EVID-PROD-ADM-MOBILE-PIPELINES-VALID-042.png`
- `EVID-PROD-ADM-MOBILE-CONVERSAS-VALID-042.png`
- `EVID-PROD-ADM-MOBILE-SETTINGS-VALID-042.png`
- `EVID-PROD-STD-MOBILE-DASHBOARD-GUIDE-VALID-042.png`
- `EVID-PROD-STD-MOBILE-DASHBOARD-VALID-042.png`
- `EVID-PROD-STD-MOBILE-MAIS-VALID-042.png`
- `EVID-PROD-STD-MOBILE-PIPELINES-VALID-042.png`
- `EVID-PROD-STD-MOBILE-CONVERSAS-VALID-042.png`
- `EVID-PROD-STD-MOBILE-SETTINGS-VALID-042.png`
- `EVID-PROD-ADM-MOBILE-RETORNO-FINAL-VALID-042.png`

## Dados e seguranca

Dados criados: nenhum.
Dados editados: nenhum registro de CRM, imovel, contato, usuario, pipeline ou configuracao foi salvo.
Observacao: uma tentativa de abrir `Mais` no usuario padrao foi interceptada pelo prompt de notificacao, que entrou em estado `Ativando...`; nao houve mensagem de sucesso, confirmacao de permissao ou evidencia de alteracao persistida.
Credenciais: nao registradas neste relatorio.
Sessao final: administrador restaurado no dashboard.
Viewport: resetado ao final.
Abas do Chrome: finalizadas ao final da rodada.

## Proxima prioridade recomendada

1. Corrigir z-index/posicionamento dos prompts PWA/notificacao no mobile para nao sobrepor a bottom nav.
2. Reproduzir e corrigir a discrepancia do pipeline mobile do usuario padrao.
3. Ajustar containers responsivos dos graficos do dashboard para eliminar warnings de dimensao zero.
4. Revisar a estrategia de overlays simultaneos no primeiro acesso mobile: banner de novidades, guia de configuracao, instalacao PWA e notificacoes.
