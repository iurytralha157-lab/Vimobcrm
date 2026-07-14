# Relatorio de Auditoria - Producao - Continuacao 43

Data: 2026-07-14
Ambiente: producao, `https://app.vimobcrm.com.br`
Navegador: Chrome real, viewport desktop controlado durante a rodada
Escopo: formularios e controles seguros da tela de Contatos/Leads
Perfis: administrador de organizacao e usuario padrao
Restricao: nenhum lead criado, nenhum arquivo importado, nenhuma exportacao executada e nenhum registro real alterado.

## Resumo executivo

Foi executada uma rodada focada em controles de formulario da tela `/crm/contacts`: abertura do formulario `Novo Lead`, validacao de envio vazio na primeira etapa, filtros avancados e menu `Importar / Exportar`. Foram geradas 11 evidencias validas novas, elevando o total acumulado para 446 imagens `EVID-PROD-*.png`.

Resultado principal: a validacao do formulario `Novo Lead` funcionou para administrador e usuario padrao quando o botao `Avancar` foi acionado com campos vazios. O modal permaneceu aberto e exibiu mensagens para nome obrigatorio e exigencia de pelo menos um contato.

Achado de permissao: o usuario padrao visualiza o menu `Importar / Exportar` com opcoes `Importar CSV/Excel` e `Exportar`. A execucao dessas opcoes nao foi feita por seguranca, mas a exposicao do controle ja representa risco: exportacao pode vazar base de contatos/leads e importacao pode alterar dados em massa se o backend permitir.

A sessao final foi restaurada como administrador no dashboard. O viewport foi resetado e as abas do Chrome foram finalizadas.

## Cobertura desta rodada

| Funcionalidade | Administrador | Usuario padrao | Status |
| --- | --- | --- | --- |
| Lista `/crm/contacts` | 206 leads visiveis e acoes completas. | 2 leads visiveis, menu lateral reduzido e tema escuro. | Aprovado/parcial |
| `Novo Lead` aberto | Modal abre com abas `Basico`, `Perfil`, `Gestao`. | Modal abre com as mesmas abas. | Aprovado |
| `Novo Lead` vazio + `Avancar` | Exibe validacao de nome e contato. | Exibe validacao de nome e contato. | Aprovado |
| Filtros avancados | Incluem busca, equipe, responsavel/usuario, origem, tags, status e campanhas. | Incluem busca, origem, tags, status e campanhas, sem filtros de equipe/usuario. | Aprovado |
| `Importar / Exportar` | Menu disponivel. | Menu disponivel. | Falhou/parcial |
| Exportacao real | Nao executada por risco de extrair dados reais. | Nao executada por risco de extrair dados reais. | Bloqueado por seguranca |
| Importacao real | Nao executada por risco de inserir dados em massa. | Nao executada por risco de inserir dados em massa. | Bloqueado por seguranca |

## Achados

### Alto - Usuario padrao ve opcoes de importacao e exportacao de contatos/leads

ID: FORMS-STD-IMPORT-EXPORT-001
Perfil: usuario padrao
URL: `/crm/contacts`
Resultado esperado: controles de importacao em massa e exportacao de base devem ser restritos a perfis administrativos ou, no minimo, escondidos do usuario padrao quando ele nao tiver permissao comprovada.
Resultado encontrado: o usuario padrao visualizou `Importar / Exportar`, com opcoes `Importar CSV/Excel` e `Exportar`. A execucao nao foi testada para evitar vazamento de dados reais ou alteracao em massa.
Status: PARCIAL/FALHOU NA INTERFACE
Severidade: ALTA
Impacto: se o backend permitir a acao, ha risco de extracao de dados ou alteracao em massa por perfil comum. Mesmo que o backend bloqueie, a interface cria divergencia de permissao e fluxo frustrado.
Evidencia: `EVID-PROD-STD-FORMS-CONTACTS-IMPORTAR-EXPORTAR-MENU-FIX-043.png`

### Positivo - Validacao de `Novo Lead` vazio impede avancar sem dados obrigatorios

ID: FORMS-LEAD-VALIDATION-001
Perfis: administrador e usuario padrao
URL: `/crm/contacts`
Resultado esperado: ao tentar avancar sem nome e sem telefone/e-mail, o modal deve permanecer aberto e mostrar mensagens claras.
Resultado encontrado: os dois perfis receberam validacao visual no modal: nome obrigatorio e necessidade de pelo menos um telefone ou e-mail. Nenhum lead foi criado.
Status: APROVADO
Severidade: POSITIVO
Evidencias: `EVID-PROD-ADM-FORMS-CONTACTS-NOVO-LEAD-DEPOIS-AVANCAR-FIX-043.png`, `EVID-PROD-STD-FORMS-CONTACTS-NOVO-LEAD-DEPOIS-AVANCAR-043.png`

### Positivo - Filtros avancados reduzem opcoes sensiveis para usuario padrao

ID: FORMS-FILTERS-PERM-001
Perfis: administrador e usuario padrao
URL: `/crm/contacts`
Resultado encontrado: o administrador visualizou filtros mais amplos, incluindo equipe e usuario/responsavel. O usuario padrao visualizou filtros mais restritos, sem os seletores amplos de equipe/usuario.
Status: APROVADO
Severidade: POSITIVO
Evidencias: `EVID-PROD-ADM-FORMS-CONTACTS-IMPORTAR-EXPORTAR-MENU-043.png`, `EVID-PROD-STD-FORMS-CONTACTS-FILTROS-ABERTO-FIX-043.png`

### Medio - Modal de formulario continua emitindo aviso de acessibilidade

ID: FORMS-A11Y-DIALOG-001
Perfis: administrador e usuario padrao
URL: `/crm/contacts`
Resultado esperado: modais devem possuir descricao acessivel ou `aria-describedby` apropriado.
Resultado encontrado: o console registrou avisos `Missing Description or aria-describedby={undefined} for DialogContent` ao abrir modais.
Status: PARCIAL
Severidade: MEDIA
Impacto: usuarios com tecnologias assistivas podem ter contexto insuficiente ao abrir formularios/dialogs.
Evidencias: `EVID-PROD-ADM-FORMS-CONTACTS-NOVO-LEAD-ABERTO-043.png`, `EVID-PROD-STD-FORMS-CONTACTS-NOVO-LEAD-ABERTO-FIX-043.png`

### Baixo/recorrente - Avisos de dimensao de graficos persistem ao retornar ao dashboard

ID: FORMS-CONSOLE-CHART-001
Perfil: administrador
URL: `/dashboard`
Resultado encontrado: ao restaurar a sessao final no dashboard, o console voltou a registrar avisos de graficos com dimensao invalida. Este item ja apareceu em rodadas anteriores e permanece recorrente.
Status: PARCIAL
Severidade: BAIXA/MEDIA
Evidencia: `EVID-PROD-ADM-FORMS-RETORNO-FINAL-043.png`

## Evidencias novas validas

- `EVID-PROD-ADM-FORMS-CONTACTS-INICIAL-043.png`
- `EVID-PROD-ADM-FORMS-CONTACTS-NOVO-LEAD-ABERTO-043.png`
- `EVID-PROD-ADM-FORMS-CONTACTS-NOVO-LEAD-DEPOIS-AVANCAR-FIX-043.png`
- `EVID-PROD-ADM-FORMS-CONTACTS-IMPORTAR-EXPORTAR-MENU-043.png`
- `EVID-PROD-STD-FORMS-CONTACTS-INICIAL-043.png`
- `EVID-PROD-STD-FORMS-CONTACTS-NOVO-LEAD-ABERTO-FIX-043.png`
- `EVID-PROD-STD-FORMS-CONTACTS-NOVO-LEAD-ANTES-AVANCAR-043.png`
- `EVID-PROD-STD-FORMS-CONTACTS-NOVO-LEAD-DEPOIS-AVANCAR-043.png`
- `EVID-PROD-STD-FORMS-CONTACTS-FILTROS-ABERTO-FIX-043.png`
- `EVID-PROD-STD-FORMS-CONTACTS-IMPORTAR-EXPORTAR-MENU-FIX-043.png`
- `EVID-PROD-ADM-FORMS-RETORNO-FINAL-043.png`

## Dados e seguranca

Dados criados: nenhum.
Dados editados: nenhum.
Importacao executada: nao.
Exportacao executada: nao.
Dados reais preservados: sim; a rodada ficou limitada a abertura de modais, validacao vazia e menus.
Credenciais: nao registradas neste relatorio.
Sessao final: administrador restaurado no dashboard.
Viewport: resetado ao final.
Abas do Chrome: finalizadas ao final da rodada.

## Proxima prioridade recomendada

1. Verificar no backend se `Exportar` e `Importar CSV/Excel` realmente bloqueiam usuario padrao; se bloquearem, esconder as opcoes na interface.
2. Adicionar descricao acessivel aos dialogs de formulario.
3. Ampliar a auditoria de formularios para edicao de lead existente, filtros combinados e fluxos de cancelamento/perda de dados sem salvar.
