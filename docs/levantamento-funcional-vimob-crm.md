# Levantamento funcional do Vimob CRM

Data do levantamento: 29/07/2026

Este documento inventaria o produto pelo que o usuário enxerga e pelo que o backend executa. A contagem não usa número de componentes React como sinônimo de funcionalidade.

## Resumo executivo

| Métrica | Quantidade | Como interpretar |
| --- | ---: | --- |
| Arquivos de rota `page.tsx` | 73 | Entradas físicas do App Router |
| Redirecionamentos puros | 5 | Não renderizam uma tela própria |
| Rotas que renderizam tela | **68** | Número objetivo de páginas endereçáveis |
| Páginas protegidas da organização/conta | **33** | Operação do CRM, sem o superadmin |
| Páginas de superadmin | **19** | Administração global do SaaS |
| Páginas de autenticação | **4** | Login, cadastro, convite e redefinição |
| Páginas públicas, checkout e site público | **12** | Rotas fora da aplicação autenticada |
| Dashboards distintos | **3** | Geral, campanhas e site |
| Tags HTML `<form>` | **23** | Formulários técnicos encontrados em 17 arquivos |
| Tags `<form>` hoje alcançáveis | **21** | Duas implementações existem, mas não estão ligadas à UI |
| Interações de entrada/edição/configuração catalogadas | **93** | Visão de produto: inclui dialogs, sheets, construtores e ações confirmáveis sem `<form>` |
| Contratos HTTP no backend Go | **472** | Rotas registradas no servidor principal |
| Supabase Edge Functions | **22** | Funções serverless adicionais |
| Entradas executáveis Go + Edge | **494** | Não significa 494 funções visíveis; há endpoints auxiliares e sobreposição |
| Pacotes de domínio no backend Go | **40** | Domínios técnicos isolados |
| Workers iniciados com o backend | **10** | Processamento assíncrono e supervisores |
| Integrações mostradas em Configurações | **9** | WhatsApp, IA, Meta, OLX, Google, Vista, Imoview, webhooks e API |
| Arquivos da camada de API do frontend | **60** | Clientes centralizados em `lib/api` |
| Arquivos de hooks | **158** | Estado e lógica de consumo por domínio |

### Resposta direta sobre os dashboards

Hoje existem exatamente três rotas de dashboard:

1. **Dashboard geral** — `/dashboard`
2. **Marketing** — `/marketing` (`/dashboard/campaigns` redireciona por compatibilidade)
3. **Dashboard do site** — `/dashboard/site`

“Dashboard principal” e “dashboard geral” são a mesma página, não duas páginas diferentes.

## 1. Inventário de páginas

### 1.1 Operação da organização e conta — 33 páginas

#### Página inicial — 1

- `/inicio` — entrada operacional com busca de ajuda, pesquisa de leads e foco do dia.

#### Dashboards — 3

- `/dashboard` — visão geral operacional e comercial.
- `/marketing` — aquisição, campanhas, mídia, social e inteligência comercial.
- `/dashboard/site` — desempenho, conversões e jornadas do site.

#### CRM — 4

- `/crm/contacts` — contatos/leads.
- `/crm/conversas` — conversas e atendimento.
- `/crm/management` — equipes, distribuição, pipelines e tags.
- `/crm/pipelines` — funil em Kanban.

#### Agenda e automações — 2

- `/agenda` — compromissos, tarefas e sincronização de agenda.
- `/automations` — automações, modelos, execuções e saúde.

#### Imóveis — 7

- `/properties` — listagem de imóveis.
- `/properties/new` — cadastro de imóvel.
- `/properties/[id]/edit` — edição de imóvel.
- `/properties/locations` — cidades, bairros, condomínios e proprietários.
- `/properties/condominiums` — condomínios.
- `/properties/owners` — proprietários.
- `/properties/rentals` — locações.

#### Financeiro — 8

- `/financeiro` — dashboard financeiro.
- `/financeiro/contas` — contas e lançamentos.
- `/financeiro/contratos` — contratos.
- `/financeiro/contratos/[id]` — detalhe de um contrato.
- `/financeiro/comissoes` — previsão, aprovação e pagamento de comissões.
- `/financeiro/corretor` — visão financeira do corretor.
- `/financeiro/dre` — DRE e configuração.
- `/financeiro/relatorios` — relatórios financeiros.

#### Administração da organização e utilidades — 8

- `/gamificacao` — arena, painel individual, histórico e configuração.
- `/notifications` — central de notificações.
- `/settings` — conta, equipe, integrações, imóveis e assinatura.
- `/settings/site` — editor e publicação do site.
- `/settings/users/[id]` — permissões individuais.
- `/suporte` — catálogo autenticado da Central de Ajuda.
- `/suporte/[slug]` — leitura de um artigo autenticado da Central de Ajuda.
- `/select-organization` — seleção/troca de organização.

### 1.2 Superadmin — 19 páginas

- `/admin` — dashboard administrativo global.
- `/admin/organizations` — organizações.
- `/admin/organizations/[id]` — detalhe, plano, limites, usuários, status e exclusão.
- `/admin/users` — usuários globais.
- `/admin/plans` — planos.
- `/admin/requests` — solicitações.
- `/admin/notifications` — notificações administrativas.
- `/admin/onboarding` — acompanhamento de onboarding.
- `/admin/announcements` — comunicados.
- `/admin/email-templates` — modelos de e-mail.
- `/admin/email-logs` — logs de e-mail.
- `/admin/help` — conteúdo de ajuda.
- `/admin/home-content` — rascunhos configuráveis da Home; o canal de cards está desativado.
- `/admin/audit` — auditoria.
- `/admin/error-logs` — erros capturados.
- `/admin/database` — visão administrativa do banco.
- `/admin/ai` — operações de IA.
- `/admin/settings` — configurações do superadmin.
- `/admin/system-settings` — configurações do sistema.

### 1.3 Autenticação — 4 páginas

- `/login`
- `/cadastro`
- `/convite/[token]`
- `/reset-password`

O fluxo de “esqueci minha senha” vive dentro da página de login. `/onboarding` apenas redireciona para `/cadastro`.

### 1.4 Públicas, checkout e sites — 12 páginas

- `/` — entrada pública principal.
- `/help`
- `/help/[slug]` — leitura pública de um artigo da Central de Ajuda.
- `/politica-de-privacidade`
- `/termos-de-uso`
- `/checkout/[token]`
- `/contato`
- `/favoritos`
- `/imoveis/[[...path]]`
- `/imovel/[code]`
- `/sobre`
- `/sites/[slug]/[[...path]]`

O renderizador do site público reconhece oito tipos de tela: início, lista de imóveis, detalhe do imóvel, sobre, contato, privacidade, favoritos e não encontrado.

### 1.5 Rotas que existem apenas como redirecionamento — 5

- `/onboarding` → `/cadastro`
- `/pipeline` → `/crm/pipelines`
- `/settings/ai` → área correspondente de `/settings`
- `/settings/integrations/meta` → integração Meta dentro de `/settings`
- `/settings/integrations/grupo-olx` → integração OLX dentro de `/settings`

## 2. Páginas compostas: as áreas que uma simples contagem de rotas esconde

| Página/fluxo | Áreas visuais internas |
| --- | --- |
| Gestão do CRM | Equipes; Distribuição; Pipelines; Tags |
| Configurações | Conta; Notificações; Usuários/equipe; Integrações; Configuração de imóveis; Assinatura/faturamento |
| Catálogo de integrações | WhatsApp; IA; Meta; Grupo OLX; Google Agenda; Vista; Imoview; Webhooks; API keys |
| Assistente de IA | Visão; Conexões; Agentes; Roteamento; Teste; Logs |
| Configurações do site | Geral; Aparência; Menu; Sobre; Contato; Social; SEO; guia de domínio |
| Dashboard do site | Visão geral; Jornadas |
| Automações | Automações; Modelos; Histórico; Saúde; construtor de criação; construtor de edição |
| Localizações de imóveis | Cidades; Bairros; Condomínios; Proprietários |
| Formulário de imóvel | Proprietário; Dados do imóvel; Localização; Valores; Características; Extras; Mídia e descrições; Publicação; Comissões; Confidencial |
| Criação de lead | Contato; Pessoa; Interesse; Gestão |
| Edição de lead | Contato; Pessoa; Interesse |
| Detalhe do lead | Atividades; Contato; Negócio; Agenda; Histórico |
| Gamificação | Arena; Meu painel; Histórico; Configuração |
| Configuração da gamificação | Regras; Missões; Participantes; Temporada; Aprovações |
| Comissões | Previsão; Pendente; Aprovada; Paga; Regras |
| DRE | Relatório; Configuração |
| Detalhe do contrato | Parcelas; Comissões; Documentos; Histórico |
| Formulário do contrato | Geral; Imóvel; Valores; Corretores; Datas |

Portanto, **68 é a quantidade correta de URLs que renderizam página**, mas não representa a quantidade de ambientes de trabalho que o usuário percebe. Uma rota como `/settings` contém várias áreas funcionais completas.

## 3. Formulários e fluxos de edição

### 3.1 Contagem técnica

Foram encontradas 23 tags HTML `<form>` em 17 arquivos TSX. Duas implementações não possuem consumidor ativo:

- `components/features/financial/SmartEntryForm.tsx`
- `components/features/properties/PropertyFormDialog.tsx`

Assim, existem **21 formulários HTML alcançáveis** no produto atual.

Essa métrica, sozinha, subestima o sistema. Muitos fluxos usam botão + dialog/sheet + mutation e não uma tag `<form>`. O inventário funcional abaixo conta 93 interações em que o usuário informa, edita, configura ou confirma dados.

### 3.2 Inventário funcional de entradas e edições — 93 interações

#### Autenticação, conta e organização — 9

1. Login.
2. Solicitação de recuperação de senha.
3. Definição/redefinição de senha.
4. Cadastro da empresa e onboarding.
5. Aceite de convite.
6. Checkout/pagamento.
7. Edição de perfil pessoal.
8. Alteração de senha autenticada.
9. Edição dos dados da organização.

#### Leads, pipelines, equipes e distribuição — 20

1. Cadastro de lead.
2. Edição de lead.
3. Edição do perfil/contato no detalhe do lead.
4. Edição de oportunidade/negócio.
5. Registro de feedback ou observação.
6. Registro de motivo de perda.
7. Registro do resultado de tarefa.
8. Importação de contatos por CSV.
9. Cadastro e edição de tag.
10. Criação de pipeline.
11. Criação de coluna/etapa.
12. Edição, ordenação e gestão de colunas.
13. Configurações gerais de uma etapa.
14. Criação e edição de tarefa de cadência.
15. Criação e edição de automação da etapa.
16. Configuração de SLA do pipeline.
17. Criação e edição de equipe.
18. Disponibilidade dos membros.
19. Vínculo entre equipe e pipeline.
20. Criação e edição de fila/regra de distribuição.

#### Imóveis — 9

1. Cadastro e edição de imóvel.
2. Cadastro e edição de proprietário.
3. Vínculo de imóveis ao proprietário.
4. Cadastro de cidade.
5. Cadastro de bairro.
6. Cadastro de condomínio.
7. Configuração dos padrões de imóveis.
8. Conexão e teste do Vista.
9. Conexão e teste do Imoview.

#### Agenda — 3

1. Criação e edição de compromisso/tarefa.
2. Conexão com Google Agenda.
3. Configurações de sincronização.

#### Automações — 5

1. Criação e edição no construtor visual.
2. Simulador de fluxo.
3. Envio de mídia para automação.
4. Gravação/envio de áudio.
5. Criação de tag dentro do construtor.

#### Financeiro — 8

1. Criação e edição de lançamento.
2. Marcação de lançamento como pago.
3. Criação e edição de contrato.
4. Envio e gestão de documento do contrato.
5. Criação e edição de regra de comissão.
6. Registro de pagamento de comissão.
7. Cancelamento de comissão.
8. Mapeamento de categorias da DRE.

#### Configurações e integrações — 15

1. Preferências e teste de notificações.
2. Convite de usuário.
3. Alteração de função do usuário.
4. Permissões individuais.
5. Dados de cobrança.
6. Seleção de plano e pagamento.
7. Criação e edição de webhook.
8. Geração de chave de API.
9. Criação de conexão WhatsApp.
10. Conexão Meta e mapeamento de formulários.
11. Configuração do Grupo OLX.
12. Configuração da triagem por IA.
13. Criação e edição de agente de IA.
14. Criação e edição de regra de roteamento da IA.
15. Teste do atendimento por IA.

#### Site — 3

1. Formulário composto de configurações gerais, aparência, conteúdo, contato, redes e SEO.
2. Criação e edição de item do menu.
3. Criação e edição de filtro de busca.

A verificação e conexão do domínio é uma ação operacional adicional, mas não foi contada como formulário.

#### WhatsApp e conversas — 6

1. Compositor de texto e mídia.
2. Gravação e envio de áudio.
3. Criação de mensagem rápida.
4. Início de automação pela conversa.
5. Sincronização e associação de etiquetas.
6. Edição de nome e descrição de grupo.

O cadastro de lead a partir de uma conversa reutiliza o formulário de lead e, por isso, não foi contado duas vezes.

#### Gamificação — 5

1. Registro manual de atividade externa.
2. Edição de regras de pontuação.
3. Criação e edição de missão.
4. Início/reinício de temporada.
5. Lançamento e aprovação manual de pontos.

#### Superadmin — 7

1. Edição de plano, status, limites e módulos da organização.
2. Criação de usuário.
3. Redefinição administrativa de senha.
4. Criação e edição de plano.
5. Publicação de comunicado.
6. Criação e edição de agente administrativo de IA.
7. Configuração e teste do despachante de notificações.

#### Público e suporte — 3

1. Formulário público de contato.
2. Formulário de interesse em imóvel.
3. Solicitação de recurso/suporte.

## 4. Contratos e domínios do backend

### 4.1 Servidor Go

O servidor registra **472 contratos HTTP** em `apps/api/internal/app/app.go`.

O catálogo individual, com método, rota, operação, handler, proteção e linha de origem, está disponível em:

- [Catálogo navegável dos 472 contratos](./catalogo-contratos-backend.md)
- [Catálogo dos 472 contratos em CSV](./catalogo-contratos-backend.csv)

| Método | Quantidade |
| --- | ---: |
| GET | 198 |
| POST | 160 |
| DELETE | 50 |
| PATCH | 48 |
| PUT | 16 |

Os maiores agrupamentos por prefixo são:

| Prefixo funcional | Contratos |
| --- | ---: |
| WhatsApp | 47 |
| Superadmin | 41 |
| Configurações | 32 |
| Integrações | 23 |
| Público | 25 |
| Leads | 19 |
| Site | 15 |
| Analytics | 15 |
| IA | 13 |
| Gamificação | 12 |
| Agenda | 11 |
| Contratos financeiros | 11 |
| Central de atenção | 10 |
| Dashboard | 9 |
| Automações | 9 |
| Financeiro | 8 |
| Pipelines | 7 |
| Imóveis | 7 |
| Round-robin | 7 |
| DRE | 6 |
| Equipes | 6 |
| Notificações | 6 |
| Usuários | 5 |
| Webhooks | 5 |
| Automações de etapa | 5 |
| Convites | 5 |
| Execuções de automação | 4 |
| Tags | 4 |
| Regras de comissão | 4 |
| Regras de round-robin | 4 |

Os 40 pacotes em `apps/api/internal` cobrem:

- administração global;
- IA;
- analytics;
- central de atenção;
- auditoria;
- autorização e permissões;
- automações;
- assinaturas e acesso por faturamento;
- cadências;
- configurações;
- distribuição de leads;
- financeiro;
- gamificação;
- saúde da aplicação;
- Central de Ajuda;
- integrações;
- leads;
- identidade do usuário;
- Meta;
- pipelines;
- portais imobiliários;
- entradas públicas;
- imóveis;
- realtime;
- round-robin;
- agenda;
- site;
- configurações de etapas;
- equipes;
- telemetria;
- tenant/organização;
- usuários;
- webhooks;
- WhatsApp.

### 4.2 Supabase Edge Functions — 22

- `asaas-cancel-payment`
- `asaas-checkout-info`
- `asaas-create-charge`
- `asaas-payment-status`
- `asaas-webhook`
- `automation-delay-processor`
- `automation-executor`
- `automation-inactivity`
- `automation-runner`
- `automation-trigger`
- `evolution-go-proxy`
- `evolution-go-webhook`
- `google-calendar-oauth`
- `google-calendar-sync`
- `google-calendar-webhook`
- `imoview-scheduled-sync`
- `imoview-sync`
- `sync-whatsapp-contacts`
- `vista-scheduled-sync`
- `vista-sync`
- `whatsapp-history-access`
- `whatsapp-notifier`

### 4.3 Processamento em segundo plano — 10 workers/supervisores

1. Central de atenção.
2. Gamificação.
3. Redistribuição de leads.
4. Despacho de notificações de lead.
5. Runtime de automações.
6. IA do WhatsApp.
7. Fila de saída do WhatsApp.
8. Processamento de webhooks do WhatsApp.
9. Supervisor de sessões do WhatsApp.
10. Processamento de webhooks da Meta.

## 5. Mapa das capacidades do produto

| Domínio | O que o CRM faz | Onde analisar a interface | Onde analisar o backend |
| --- | --- | --- | --- |
| Dashboards e Marketing | KPIs empresariais, campanhas, VGV, SLA, ranking, site, conversões e jornadas | `/dashboard`, `/marketing`, `/dashboard/site` | `apps/api/internal/analytics`, rotas `/v1/analytics` e `/v1/dashboard` |
| Leads e contatos | Cadastro, edição, histórico, tarefas, origem, atribuição, qualificação, perda, venda e importação | `/crm/contacts` e detalhe do lead | `apps/api/internal/leads`, rotas `/v1/leads` |
| Pipelines | Kanban, etapas, movimentação, SLA, automações e cadências por etapa | `/crm/pipelines` | `apps/api/internal/pipelines`, `cadences`, `stageconfig` |
| Equipes e distribuição | Equipes, disponibilidade, filas, regras, distribuição e round-robin | `/crm/management` | `apps/api/internal/teams` e `roundrobin` |
| Conversas e WhatsApp | Sessões, conversas, mensagens, áudio, mídia, grupos, etiquetas, histórico, IA e automações | `/crm/conversas` e Configurações → Integrações | `apps/api/internal/whatsapp` |
| Meta | OAuth, páginas/formulários, mapeamento, Lead Ads, atribuição e insights | Configurações → Integrações → Meta e dashboard de campanhas | `apps/api/internal/meta`, `integrations` e `analytics` |
| Grupo OLX | Configuração, publicação/feed, relatórios e entrada de leads | Configurações → Integrações → Grupo OLX | `apps/api/internal/portals` e `integrations` |
| Imóveis | Cadastro completo, mídia, proprietário, localização, publicação, comissão e confidencialidade | `/properties` e subpáginas | `apps/api/internal/properties` |
| Vista e Imoview | Importação e sincronização manual/agendada de imóveis | Configurações → Integrações | Edge Functions de Vista e Imoview |
| Site público | Conteúdo, tema, menu, busca, SEO, domínio, imóveis, formulários e analytics | `/settings/site`, `/dashboard/site` e site público | `apps/api/internal/site`, rotas `/v1/site` e `/v1/public` |
| Agenda | Eventos, tarefas, cadências e sincronização com Google Agenda | `/agenda` | `apps/api/internal/schedule` e Edge Functions do Google Calendar |
| Automações | Gatilhos, condições, ações, espera, modelos, execuções, simulação e saúde | `/automations` | `apps/api/internal/automations` e Edge Functions `automation-*` |
| Financeiro | Contas, lançamentos, contratos, documentos, parcelas, comissões, DRE e relatórios | `/financeiro/*` | `apps/api/internal/financial` |
| Gamificação | Pontos, ranking, missões, temporadas, participantes e aprovações | `/gamificacao` | `apps/api/internal/gamification` |
| IA | Agentes, conexões, roteamento, testes, logs e autoatendimento | Configurações → IA e `/admin/ai` | `apps/api/internal/ai` e worker de IA do WhatsApp |
| Notificações | Central, preferências, e-mail, push, eventos em tempo real e despacho | `/notifications` e Configurações → Notificações | rotas `/v1/notifications`, workers e serviços de push/e-mail |
| Segurança e gestão | Multi-organização, papéis, permissões, auditoria, telemetria e administração global | Configurações, usuário e `/admin/*` | `tenant`, `permissions`, `authorization`, `audit`, `telemetry`, `admin` |
| Integração aberta | Webhooks de entrada/saída e chaves de API | Configurações → Integrações | `apps/api/internal/webhooks` e `/v1/integrations` |

## 6. Integrações externas

### Expostas no catálogo da organização

1. WhatsApp/Evolution Go.
2. IA de atendimento.
3. Facebook/Meta.
4. Grupo OLX/Canal Pro.
5. Google Agenda.
6. Vista.
7. Imoview.
8. Webhooks.
9. Chaves de API.

### Serviços e infraestrutura também presentes

- Supabase: banco, autenticação, storage e realtime.
- OpenAI: agentes e respostas de IA.
- Resend: e-mails transacionais.
- Asaas: checkout, cobrança, status e cancelamento.
- Web Push/FCM: notificações push.

## 7. O que acontece quando um lead entra

Os canais não usam exatamente o mesmo handler, mas convergem para o mesmo modelo de lead, atribuição, histórico e acompanhamento.

### Canais de entrada identificados

- cadastro manual;
- importação CSV;
- formulário do site e interesse em imóvel;
- Meta Lead Ads;
- webhook genérico/API;
- Grupo OLX;
- WhatsApp/Evolution Go.

### Fluxo funcional consolidado

1. **Identificação da origem e organização**  
   O sistema resolve qual integração, formulário, site ou canal gerou o lead.

2. **Normalização e correspondência**  
   Telefone, e-mail e identificadores são usados para localizar um contato existente ou criar um novo.

3. **Registro de atribuição**  
   Origem, campanha, formulário, conexão e evento de entrada são persistidos para histórico e analytics.

4. **Definição do destino**  
   O canal pode indicar pipeline, etapa, equipe ou usuário padrão.

5. **Distribuição**  
   Quando não há responsável fixo, entram regras de fila/round-robin, disponibilidade dos membros e histórico de distribuição.

6. **Notificação e atendimento**  
   O responsável recebe os avisos aplicáveis. Conversas, agenda e tarefas passam a atualizar o histórico.

7. **Cadência, SLA e automação**  
   Regras da etapa, automações, cadências e tempos de atendimento controlam os próximos passos.

8. **Redistribuição**  
   O worker pode alertar e redistribuir leads sem atendimento, respeitando atividade humana e disponibilidade.

9. **Medição**  
   Conversão, VGV, SLA, origem, campanha, desempenho por corretor/equipe e gamificação alimentam os dashboards.

### Principais pontos de inspeção

- Entrada e persistência do lead: `apps/api/internal/leads`.
- Meta Lead Ads: `apps/api/internal/meta`.
- WhatsApp: `apps/api/internal/whatsapp`.
- OLX e portais: `apps/api/internal/portals`.
- Distribuição: `apps/api/internal/roundrobin`.
- Equipes: `apps/api/internal/teams`.
- Cadências: `apps/api/internal/cadences`.
- Automações: `apps/api/internal/automations`.
- Métricas: `apps/api/internal/analytics`.

## 8. Recursos implementados, mas pouco ou nada expostos na navegação

Estes pontos merecem revisão de produto porque aumentam o valor percebido sem necessariamente exigir um backend novo:

1. **Central de atenção**  
   Há 10 endpoints, worker e componentes completos de fila/políticas, mas não foi encontrada uma rota ativa que exponha a tela.

2. **Cadências como área própria da Gestão**  
   `CadencesTab.tsx` existe, mas Gestão do CRM mostra somente Equipes, Distribuição, Pipelines e Tags. As cadências continuam presentes dentro das etapas.

3. **Operação como aba própria**  
   `OperationalTab.tsx` existe, mas não está conectada à página de Gestão.

4. **Papéis personalizados**  
   `RolesTab.tsx` existe, mas Configurações não o renderiza. A página de permissões individuais está ativa.

5. **Gerenciador de round-robin por pipeline**  
   `PipelineRoundRobinManager.tsx` existe sem consumidor localizado.

6. **Gerenciador alternativo de formulários Meta**  
   `MetaFormManager.tsx` não está ligado; a integração usa diretamente outro diálogo de configuração.

7. **Formulários alternativos/legados**  
   `SmartEntryForm.tsx` e `PropertyFormDialog.tsx` possuem `<form>`, mas não têm consumidor ativo.

8. **Ações do detalhe de contrato**  
   Os botões “Editar contrato” e “Gerar aditivo” devem ser verificados ponta a ponta; visualmente existem, mas não foi confirmada uma ação ativa conectada.

9. **Navegação da gamificação**  
   Há referência de navegação para `#rankings`, enquanto as abas atuais são Arena, Meu painel, Histórico e Configuração. É preciso alinhar URL e conteúdo real.

## 9. Onde começar uma análise funcional

Uma auditoria de produto pode ser feita em quatro passagens:

1. **Valor percebido**  
   Percorrer as 33 páginas da organização e cada aba da seção 2.

2. **Conversão e operação do lead**  
   Testar um lead entrando por cada canal, seguindo distribuição, primeira resposta, cadência, automação, agenda, venda/perda e dashboard.

3. **Cobertura frontend × backend**  
   Comparar as 472 rotas Go e 22 Edge Functions com as telas realmente expostas. A Central de Atenção é o exemplo mais claro de capacidade pronta com baixa exposição.

4. **Qualidade ponta a ponta**  
   Para cada uma das 93 interações catalogadas, validar permissão, estado de carregamento, erro, sucesso, atualização da tela e persistência por organização.

## 10. Fontes técnicas principais

- Rotas visuais: `app/**/page.tsx`
- Registro de contratos HTTP: `apps/api/internal/app/app.go`
- Domínios do backend: `apps/api/internal/*`
- Funções serverless: `supabase/functions/*`
- Clientes de API do frontend: `lib/api/*`
- Lógica de tela: `hooks/*`
- Componentes funcionais: `components/features/*`
- Navegação do superadmin: `components/features/admin/admin-navigation.ts`
- Renderização do site público: `components/features/public-site/route-renderer.tsx`

## Conclusão

O Vimob CRM já é uma plataforma imobiliária ampla, não apenas um funil de leads. O produto atual reúne aquisição, distribuição, atendimento, imóveis, site, agenda, automações, financeiro, gamificação, IA, analytics, integrações e administração multi-organização.

O principal ponto não é falta de função: é **tornar a capacidade existente mais visível, consolidar fluxos duplicados/legados e validar cada caminho de ponta a ponta**.
