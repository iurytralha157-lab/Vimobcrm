# Relatório de Auditoria Funcional - Produção - Continuação 32

Data: 14/07/2026
Ambiente: produção, navegador, VIMob CRM
Módulo auditado: Gestão
Perfis: administrador e usuário padrão
Escopo: menu Gestão, Equipes, Distribuição, Pipelines e Tags
Dados alterados: nenhum

## Resumo executivo

A auditoria desta continuação cobriu a área **Gestão** em produção. Foram avaliadas as rotas administrativas com perfil administrador, os formulários de criação sem salvamento e o acesso direto às mesmas rotas com usuário padrão.

O administrador visualiza e opera a área de Gestão com controles administrativos para equipes, filas de distribuição, restrição de pipelines e tags. O usuário padrão não vê Gestão no menu lateral e, ao tentar acessar as rotas diretamente, é redirecionado para o Dashboard. O bloqueio impede exposição da área, mas não exibe mensagem explícita de acesso restrito.

Não foram ativadas/desativadas equipes ou filas, não foram criadas tags, equipes ou filas, e nenhum formulário foi salvo.

## Cobertura executada

- Menu admin: Gestão, Automações, Imóveis, Financeiro e Configurações mapeados para confirmar rotas pendentes.
- Gestão admin:
  - `/crm/management?tab=teams`
  - `/crm/management?tab=distribution`
  - `/crm/management?tab=pipelines`
  - `/crm/management?tab=tags`
- Formulários admin:
  - Nova Equipe
  - Nova Fila
  - Nova Tag
  - Busca de Tags
- Subáreas do formulário Nova Fila:
  - Informações básicas
  - Regras de entrada
  - Ordem de distribuição
  - Redistribuição
- Usuário padrão:
  - menu lateral sem Gestão
  - acesso direto às quatro rotas de Gestão

## Achados principais

### Médio - Acesso direto do usuário padrão redireciona sem mensagem explícita

ID: GESTAO-STD-PERM-001
Perfil: usuário padrão
URLs testadas:

- `/crm/management?tab=teams`
- `/crm/management?tab=distribution`
- `/crm/management?tab=pipelines`
- `/crm/management?tab=tags`

Resultado encontrado: todas as rotas retornaram ao Dashboard. Não houve exposição de dados administrativos, mas também não houve aviso visível de `Acesso restrito`, `Sem permissão` ou equivalente.

Status: Parcial
Severidade: Médio
Evidências:

- `EVID-PROD-STD-GESTAO-EQUIPES-DIRETO-032.png`
- `EVID-PROD-STD-GESTAO-DISTRIBUICAO-DIRETO-032.png`
- `EVID-PROD-STD-GESTAO-PIPELINES-DIRETO-032.png`
- `EVID-PROD-STD-GESTAO-TAGS-DIRETO-032.png`

Impacto: a autorização aparenta bloquear a rota, mas a ausência de mensagem dificulta diagnóstico e cria comportamento diferente do bloqueio claro observado em outras áreas.

### Médio - Ações críticas aparecem como switches diretos no admin

ID: GESTAO-ADM-SWITCH-001
Perfil: administrador
Áreas: Equipes e Distribuição
Resultado encontrado: as listas mostram switches de ativar/desativar equipe e fila diretamente na tabela.

Status: Bloqueado por segurança
Severidade: Médio
Evidências:

- `EVID-PROD-ADM-GESTAO-EQUIPES-032.png`
- `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-032.png`

Impacto: é uma ação administrativa sensível com potencial de alterar distribuição de leads. Não foi clicada em produção. Recomenda-se confirmar se há confirmação, auditoria ou feedback claro ao alternar esses switches.

### Baixo - Validação visual da Nova Tag parece permissiva

ID: GESTAO-ADM-TAGS-001
Perfil: administrador
URL: `/crm/management?tab=tags`
Resultado encontrado: no formulário Nova Tag, o botão `Criar` apareceu habilitado durante a inspeção visual do formulário. O campo de nome não foi submetido e o backend não foi testado para evitar criação real.

Status: Parcial
Severidade: Baixo
Evidência: `EVID-PROD-ADM-GESTAO-TAGS-NOVA-TAG-FORM-032.png`

Impacto: pode haver validação apenas no envio ou validação visual incompleta. Recomenda-se bloquear o botão até os campos obrigatórios estarem válidos.

### Baixo - Avisos técnicos recorrentes no console

ID: GESTAO-TECH-001
Perfis: administrador e usuário padrão
Resultado encontrado: os mesmos avisos técnicos observados em módulos anteriores continuaram aparecendo:

- gráfico com largura/altura inválida;
- `DialogContent` sem descrição ou `aria-describedby`.

Status: Parcial
Severidade: Baixo
Impacto: afeta qualidade técnica, acessibilidade e estabilidade visual. Não houve erro crítico bloqueante nesta continuação.

## Comparação por perfil

| Área | Administrador | Usuário padrão | Resultado |
|---|---|---|---|
| Menu Gestão | Visível | Não visível | Aprovado |
| Equipes | Lista equipes, membros, status e abre Nova Equipe | URL direta volta ao Dashboard | Parcial por falta de mensagem |
| Distribuição | Lista filas e abre Nova Fila com abas internas | URL direta volta ao Dashboard | Parcial por falta de mensagem |
| Pipelines | Visualiza vínculo/restrição de pipelines | URL direta volta ao Dashboard | Parcial por falta de mensagem |
| Tags | Lista métricas, busca e abre Nova Tag | URL direta volta ao Dashboard | Parcial por falta de mensagem |

## Testes executados

| ID | Perfil | Funcionalidade | Status | Evidência |
|---|---|---|---|---|
| GESTAO-ADM-001 | Admin | Menu Gestão | Aprovado visual | `EVID-PROD-ADM-MENU-GESTAO-ARIA-032.png` |
| GESTAO-ADM-002 | Admin | Equipes | Aprovado visual | `EVID-PROD-ADM-GESTAO-EQUIPES-032.png` |
| GESTAO-ADM-003 | Admin | Nova Equipe | Bloqueado sem salvar | `EVID-PROD-ADM-GESTAO-EQUIPES-NOVA-EQUIPE-FORM-032.png` |
| GESTAO-ADM-004 | Admin | Distribuição | Aprovado visual | `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-032.png` |
| GESTAO-ADM-005 | Admin | Nova Fila | Bloqueado sem salvar | `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-NOVA-FILA-FORM-032.png` |
| GESTAO-ADM-006 | Admin | Fila - Informações | Aprovado visual | `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-FORM-INFORMACOES-032.png` |
| GESTAO-ADM-007 | Admin | Fila - Regras | Aprovado visual | `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-FORM-REGRAS-032.png` |
| GESTAO-ADM-008 | Admin | Fila - Ordem | Aprovado visual | `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-FORM-ORDEM-032.png` |
| GESTAO-ADM-009 | Admin | Fila - Redistribuição | Aprovado visual | `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-FORM-REDISTRIBUICAO-032.png` |
| GESTAO-ADM-010 | Admin | Pipelines | Aprovado visual | `EVID-PROD-ADM-GESTAO-PIPELINES-032.png` |
| GESTAO-ADM-011 | Admin | Tags | Aprovado visual | `EVID-PROD-ADM-GESTAO-TAGS-032.png` |
| GESTAO-ADM-012 | Admin | Busca de tags | Aprovado | `EVID-PROD-ADM-GESTAO-TAGS-BUSCA-CRM-032.png` |
| GESTAO-ADM-013 | Admin | Nova Tag | Parcial | `EVID-PROD-ADM-GESTAO-TAGS-NOVA-TAG-FORM-032.png` |
| GESTAO-STD-001 | Padrão | Menu sem Gestão | Aprovado | `EVID-PROD-STD-GESTAO-MENU-AUSENTE-032.png` |
| GESTAO-STD-002 | Padrão | URL direta Equipes | Parcial | `EVID-PROD-STD-GESTAO-EQUIPES-DIRETO-032.png` |
| GESTAO-STD-003 | Padrão | URL direta Distribuição | Parcial | `EVID-PROD-STD-GESTAO-DISTRIBUICAO-DIRETO-032.png` |
| GESTAO-STD-004 | Padrão | URL direta Pipelines | Parcial | `EVID-PROD-STD-GESTAO-PIPELINES-DIRETO-032.png` |
| GESTAO-STD-005 | Padrão | URL direta Tags | Parcial | `EVID-PROD-STD-GESTAO-TAGS-DIRETO-032.png` |

## Evidências principais

- `EVID-PROD-ADM-GESTAO-EQUIPES-032.png`
- `EVID-PROD-ADM-GESTAO-EQUIPES-NOVA-EQUIPE-FORM-032.png`
- `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-032.png`
- `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-NOVA-FILA-FORM-032.png`
- `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-FORM-INFORMACOES-032.png`
- `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-FORM-REGRAS-032.png`
- `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-FORM-ORDEM-032.png`
- `EVID-PROD-ADM-GESTAO-DISTRIBUICAO-FORM-REDISTRIBUICAO-032.png`
- `EVID-PROD-ADM-GESTAO-PIPELINES-032.png`
- `EVID-PROD-ADM-GESTAO-TAGS-032.png`
- `EVID-PROD-ADM-GESTAO-TAGS-BUSCA-CRM-032.png`
- `EVID-PROD-ADM-GESTAO-TAGS-NOVA-TAG-FORM-032.png`
- `EVID-PROD-STD-GESTAO-MENU-AUSENTE-032.png`
- `EVID-PROD-STD-GESTAO-EQUIPES-DIRETO-032.png`
- `EVID-PROD-STD-GESTAO-DISTRIBUICAO-DIRETO-032.png`
- `EVID-PROD-STD-GESTAO-PIPELINES-DIRETO-032.png`
- `EVID-PROD-STD-GESTAO-TAGS-DIRETO-032.png`

## Limitações

- Switches de ativação/desativação não foram acionados por risco de impactar operação real.
- Formulários foram abertos, inspecionados e cancelados; nenhum salvamento foi executado.
- Não foram alterados vínculos de pipelines, filas, usuários, equipes ou tags.
- O comportamento de backend no envio inválido não foi testado para evitar criação ou alteração em produção.

## Recomendações

1. Exibir mensagem explícita para usuário padrão ao bloquear rotas de Gestão.
2. Confirmar se switches administrativos possuem confirmação, log de auditoria e feedback de sucesso/erro.
3. Revisar validação visual do formulário Nova Tag.
4. Manter o bloqueio do menu Gestão para usuário padrão.
5. Corrigir avisos recorrentes de acessibilidade em dialogs.

## Estado final

A sessão foi retornada ao perfil administrador. Nenhum dado de produção foi criado, salvo, removido, ativado, desativado ou redistribuído durante esta continuação.
