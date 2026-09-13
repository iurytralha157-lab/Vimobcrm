# Catálogo dos 541 contratos do backend

Gerado automaticamente a partir de `apps/api/internal/app/routes.go`.

Cada contrato abaixo contém o método HTTP, a rota exata, a operação/handler responsável, a camada de acesso registrada e a linha de origem. A indicação “sem middleware na rota” não significa necessariamente acesso irrestrito: webhooks e rotas internas podem validar assinatura, segredo ou token dentro do próprio handler.

## Resumo

- Total: **541 contratos HTTP**.
- GET: **220**.
- POST: **195**.
- PUT: **23**.
- PATCH: **52**.
- DELETE: **51**.
- Grupos de rota: **84**.

## Índice por domínio

| Domínio | Prefixo | Contratos |
| --- | --- | ---: |
| WhatsApp | `whatsapp` | 47 |
| Superadmin | `admin` | 45 |
| Configurações | `settings` | 33 |
| Integrações | `integrations` | 31 |
| APIs públicas | `public` | 30 |
| Imóveis | `properties` | 27 |
| Leads | `leads` | 20 |
| property-developments | `property-developments` | 19 |
| Analytics | `analytics` | 15 |
| Site | `site` | 15 |
| Inteligência artificial | `ai` | 13 |
| Gamificação | `gamification` | 12 |
| Agenda | `schedule` | 11 |
| Contratos financeiros | `contracts` | 11 |
| Central de atenção | `attention` | 10 |
| Automações | `automations` | 9 |
| Dashboard | `dashboard` | 9 |
| Equipes | `teams` | 9 |
| Financeiro | `financial` | 8 |
| Filas de distribuição | `round-robins` | 7 |
| Pipelines | `pipelines` | 7 |
| Convites | `invitations` | 6 |
| DRE | `dre` | 6 |
| Notificações | `notifications` | 6 |
| Automações de etapa | `stage-automations` | 5 |
| Etapas | `stages` | 5 |
| Usuários | `users` | 5 |
| Webhooks | `webhooks` | 5 |
| Execuções de automação | `automation-executions` | 4 |
| Página inicial | `home` | 4 |
| Regras de comissão | `commission-rules` | 4 |
| Regras de distribuição | `round-robin-rules` | 4 |
| Tags | `tags` | 4 |
| Tarefas de leads | `lead-tasks` | 4 |
| Bairros dos imóveis | `property-neighborhoods` | 3 |
| Características dos imóveis | `property-features` | 3 |
| Central de ajuda | `help` | 3 |
| Cidades dos imóveis | `property-cities` | 3 |
| Comissões | `commissions` | 3 |
| Condomínios dos imóveis | `property-condominiums` | 3 |
| Conta e organização atual | `me` | 3 |
| Membros de equipe | `team-members` | 3 |
| Mídias de automação | `automation-media` | 3 |
| Modelos de automação | `automation-templates` | 3 |
| Pipelines das equipes | `team-pipelines` | 3 |
| Proprietários dos imóveis | `property-owners` | 3 |
| Proximidades dos imóveis | `property-proximities` | 3 |
| Tarefas de cadência | `cadence-tasks` | 3 |
| Analytics de leads | `lead-analytics` | 2 |
| Anexos de leads | `lead-attachments` | 2 |
| Atividades | `activities` | 2 |
| Auditoria | `audit-logs` | 2 |
| Configurações operacionais de etapa | `stage-operational-configs` | 2 |
| Disponibilidade dos membros | `member-availability` | 2 |
| Membros da distribuição | `round-robin-members` | 2 |
| Runtime de automação | `automation-runtime` | 2 |
| Saúde da aplicação | `health` | 2 |
| SLA do pipeline | `pipeline-sla-settings` | 2 |
| Solicitações de onboarding | `onboarding-requests` | 2 |
| Solicitações de recursos | `feature-requests` | 2 |
| Tipos de imóveis | `property-types` | 2 |
| Captadores de imóveis | `property-captors` | 1 |
| Comunicados | `announcements` | 1 |
| Contagem por etapa | `pipeline-stage-counts` | 1 |
| Contatos | `contacts` | 1 |
| Enriquecimento de leads | `lead-enrichments` | 1 |
| Eventos em tempo real | `realtime` | 1 |
| Filtros de metadados de leads | `lead-meta-filters` | 1 |
| Imagens dos imóveis | `property-images` | 1 |
| Informações públicas do imóvel | `property-site-info` | 1 |
| Leads por etapa | `pipeline-stage-leads` | 1 |
| Metadados de leads | `lead-meta` | 1 |
| Modelos de cadência | `cadence-templates` | 1 |
| Organizações dos usuários | `user-organizations` | 1 |
| Planos de assinatura | `subscription-plans` | 1 |
| Quadro do pipeline | `pipeline-board` | 1 |
| Resumos dos imóveis | `property-summaries` | 1 |
| Resumos dos usuários | `user-summaries` | 1 |
| round-robin-meta-forms | `round-robin-meta-forms` | 1 |
| round-robin-whatsapp-sessions | `round-robin-whatsapp-sessions` | 1 |
| Telemetria | `telemetry` | 1 |
| user-presence | `user-presence` | 1 |
| Visibilidade de leads | `lead-visibility` | 1 |
| WhatsApp interno | `internal-whatsapp` | 1 |

## Lista completa

### Saúde da aplicação — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 1 | GET | `/healthz` | `Health` | `healthHandler.Health` | Saúde pública | 184 |
| 2 | GET | `/readyz` | `Ready` | `healthHandler.Ready` | Saúde pública | 185 |

### WhatsApp interno — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 3 | POST | `/v1/internal/whatsapp/auto-reply` | `AutoReply` | `whatsappHandler.AutoReply` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 186 |

### Conta e organização atual — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 4 | GET | `/v1/me` | `Show` | `meHandler.Show` | Usuário autenticado | 187 |
| 5 | GET | `/v1/me/profile` | `ShowProfile` | `meHandler.ShowProfile` | Usuário autenticado | 188 |
| 6 | POST | `/v1/me/switch-organization` | `SwitchOrganization` | `meHandler.SwitchOrganization` | Usuário autenticado | 189 |

### Eventos em tempo real — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 7 | GET | `/v1/realtime/events` | `Events` | `realtimeHandler.Events` | Organização ativa | 190 |

### Telemetria — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 8 | POST | `/v1/telemetry/errors` | `CreateErrorEvent` | `telemetryHandler.CreateErrorEvent` | Usuário autenticado | 191 |

### Auditoria — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 9 | GET | `/v1/audit-logs` | `List` | `auditHandler.List` | Usuário autenticado | 192 |
| 10 | POST | `/v1/audit-logs` | `Create` | `auditHandler.Create` | Usuário autenticado | 193 |

### Analytics — 15

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 11 | GET | `/v1/analytics/meta-insights` | `MetaInsights` | `analyticsHandler.MetaInsights` | Módulo campaigns + permissão DashboardCampaignsView | 194 |
| 12 | GET | `/v1/analytics/campaign-insights` | `CampaignInsights` | `analyticsHandler.CampaignInsights` | Módulo campaigns + permissão DashboardCampaignsView | 195 |
| 13 | GET | `/v1/analytics/lead` | `LeadAnalytics` | `analyticsHandler.LeadAnalytics` | Módulo site + permissão DashboardSiteView | 196 |
| 14 | GET | `/v1/analytics/site-summary` | `SiteSummary` | `analyticsHandler.SiteSummary` | Módulo site + permissão DashboardSiteView | 197 |
| 15 | GET | `/v1/analytics/site-detailed` | `SiteDetailed` | `analyticsHandler.SiteDetailed` | Módulo site + permissão DashboardSiteView | 198 |
| 16 | GET | `/v1/analytics/enterprise-kpis` | `EnterpriseKPIs` | `analyticsHandler.EnterpriseKPIs` | Organização + permissão DashboardView | 199 |
| 17 | GET | `/v1/analytics/dre-executive` | `DREExecutive` | `analyticsHandler.DREExecutive` | Organização + permissão FinancialView | 200 |
| 18 | GET | `/v1/analytics/sla-summary` | `SlaSummary` | `analyticsHandler.SlaSummary` | Organização + permissão DashboardView | 201 |
| 19 | GET | `/v1/analytics/sla-performance-by-user` | `SlaPerformanceByUser` | `analyticsHandler.SlaPerformanceByUser` | Organização + permissão DashboardView | 202 |
| 20 | GET | `/v1/analytics/team-ranking` | `TeamRanking` | `analyticsHandler.TeamRanking` | Organização + permissão DashboardView | 203 |
| 21 | GET | `/v1/analytics/vgv-stats` | `VGVStats` | `analyticsHandler.VGVStats` | Organização + permissão DashboardView | 204 |
| 22 | GET | `/v1/analytics/vgv-by-broker` | `VGVByBroker` | `analyticsHandler.VGVByBroker` | Organização + permissão DashboardView | 205 |
| 23 | GET | `/v1/analytics/stage-vgv` | `StageVGV` | `analyticsHandler.StageVGV` | Organização + permissão DashboardView | 206 |
| 24 | GET | `/v1/analytics/leader-stats` | `LeaderStats` | `analyticsHandler.LeaderStats` | Organização + permissão DashboardView | 207 |
| 25 | GET | `/v1/analytics/team-leader-stats/{teamId}` | `TeamLeaderStats` | `analyticsHandler.TeamLeaderStats` | Organização + permissão DashboardView | 208 |

### Central de atenção — 10

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 26 | GET | `/v1/attention/settings` | `GetSettings` | `attentionHandler.GetSettings` | Organização + permissão AttentionView | 209 |
| 27 | PATCH | `/v1/attention/settings` | `UpdateSettings` | `attentionHandler.UpdateSettings` | Organização + permissão AttentionView | 210 |
| 28 | GET | `/v1/attention/policies` | `ListPolicies` | `attentionHandler.ListPolicies` | Organização + permissão AttentionView | 211 |
| 29 | POST | `/v1/attention/policies` | `CreatePolicy` | `attentionHandler.CreatePolicy` | Organização + permissão AttentionView | 212 |
| 30 | PATCH | `/v1/attention/policies/{id}` | `UpdatePolicy` | `attentionHandler.UpdatePolicy` | Organização + permissão AttentionView | 213 |
| 31 | GET | `/v1/attention/items` | `ListItems` | `attentionHandler.ListItems` | Organização + permissão AttentionView | 214 |
| 32 | GET | `/v1/attention/summary` | `Summary` | `attentionHandler.Summary` | Organização + permissão AttentionView | 215 |
| 33 | POST | `/v1/attention/items/{id}/acknowledge` | `AcknowledgeItem` | `attentionHandler.AcknowledgeItem` | Organização + permissão AttentionView | 216 |
| 34 | POST | `/v1/attention/items/{id}/snooze` | `SnoozeItem` | `attentionHandler.SnoozeItem` | Organização + permissão AttentionView | 217 |
| 35 | POST | `/v1/attention/items/{id}/resolve` | `ResolveItem` | `attentionHandler.ResolveItem` | Organização + permissão AttentionView | 218 |

### Página inicial — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 36 | GET | `/v1/home/focus` | `List` | `homeFocusHandler.List` | Organização + permissão AttentionView | 219 |
| 37 | GET | `/v1/home/notices` | `Notices` | `homeFocusHandler.Notices` | Organização ativa | 220 |
| 113 | GET | `/v1/home/publications` | `ListHomePublications` | `adminHandler.ListHomePublications` | Usuário autenticado | 296 |
| 114 | POST | `/v1/home/assistant` | `AnswerHomeAssistant` | `adminHandler.AnswerHomeAssistant` | Usuário autenticado | 297 |

### Superadmin — 45

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 38 | GET | `/v1/admin/error-events` | `ListErrorEvents` | `telemetryHandler.ListErrorEvents` | Usuário autenticado | 221 |
| 39 | POST | `/v1/admin/error-events/{id}/resolve` | `ResolveErrorEvent` | `telemetryHandler.ResolveErrorEvent` | Usuário autenticado | 222 |
| 101 | GET | `/v1/admin/organizations` | `ListOrganizations` | `adminHandler.ListOrganizations` | Usuário autenticado | 284 |
| 102 | POST | `/v1/admin/organizations` | `CreateOrganization` | `adminHandler.CreateOrganization` | Usuário autenticado | 285 |
| 103 | PATCH | `/v1/admin/organizations/{id}` | `UpdateOrganization` | `adminHandler.UpdateOrganization` | Usuário autenticado | 286 |
| 104 | DELETE | `/v1/admin/organizations/{id}` | `DeleteOrganization` | `adminHandler.DeleteOrganization` | Usuário autenticado | 287 |
| 105 | GET | `/v1/admin/organizations/{id}/modules` | `ListOrganizationModules` | `adminHandler.ListOrganizationModules` | Usuário autenticado | 288 |
| 106 | GET | `/v1/admin/organizations/{id}/payments` | `ListOrganizationPayments` | `adminHandler.ListOrganizationPayments` | Usuário autenticado | 289 |
| 107 | POST | `/v1/admin/organizations/{id}/access` | `UpdateOrganizationAccess` | `adminHandler.UpdateOrganizationAccess` | Usuário autenticado | 290 |
| 108 | GET | `/v1/admin/users` | `ListUsers` | `adminHandler.ListUsers` | Usuário autenticado | 291 |
| 109 | PATCH | `/v1/admin/users/{id}` | `UpdateUser` | `adminHandler.UpdateUser` | Usuário autenticado | 292 |
| 110 | DELETE | `/v1/admin/users/{id}` | `DeleteUser` | `adminHandler.DeleteUser` | Usuário autenticado | 293 |
| 111 | POST | `/v1/admin/users/{id}/reset-password` | `ResetUserPassword` | `adminHandler.ResetUserPassword` | Usuário autenticado | 294 |
| 120 | GET | `/v1/admin/home-publications` | `ListHomePublicationsAdmin` | `adminHandler.ListHomePublicationsAdmin` | Usuário autenticado | 303 |
| 121 | POST | `/v1/admin/home-publications` | `CreateHomePublicationAdmin` | `adminHandler.CreateHomePublicationAdmin` | Usuário autenticado | 304 |
| 122 | PUT | `/v1/admin/home-publications/order` | `ReorderHomePublicationsAdmin` | `adminHandler.ReorderHomePublicationsAdmin` | Usuário autenticado | 305 |
| 123 | PATCH | `/v1/admin/home-publications/{id}` | `UpdateHomePublicationAdmin` | `adminHandler.UpdateHomePublicationAdmin` | Usuário autenticado | 306 |
| 124 | DELETE | `/v1/admin/home-publications/{id}` | `DeleteHomePublicationAdmin` | `adminHandler.DeleteHomePublicationAdmin` | Usuário autenticado | 307 |
| 125 | POST | `/v1/admin/home-publications/{id}/image` | `UploadHomePublicationImageAdmin` | `adminHandler.UploadHomePublicationImageAdmin` | Usuário autenticado | 308 |
| 126 | DELETE | `/v1/admin/home-publications/{id}/image` | `DeleteHomePublicationImageAdmin` | `adminHandler.DeleteHomePublicationImageAdmin` | Usuário autenticado | 309 |
| 129 | GET | `/v1/admin/feature-requests` | `ListFeatureRequestsAdmin` | `adminHandler.ListFeatureRequestsAdmin` | Usuário autenticado | 312 |
| 130 | PATCH | `/v1/admin/feature-requests/{id}` | `RespondFeatureRequestAdmin` | `adminHandler.RespondFeatureRequestAdmin` | Usuário autenticado | 313 |
| 139 | GET | `/v1/admin/onboarding-requests` | `ListOnboardingRequestsAdmin` | `adminHandler.ListOnboardingRequestsAdmin` | Usuário autenticado | 322 |
| 140 | PATCH | `/v1/admin/onboarding-requests/{id}` | `UpdateOnboardingRequestAdmin` | `adminHandler.UpdateOnboardingRequestAdmin` | Usuário autenticado | 323 |
| 142 | POST | `/v1/admin/modules` | `UpdateModuleAccess` | `adminHandler.UpdateModuleAccess` | Usuário autenticado | 325 |
| 143 | GET | `/v1/admin/dashboard/overview` | `DashboardOverview` | `adminHandler.DashboardOverview` | Usuário autenticado | 326 |
| 144 | GET | `/v1/admin/dashboard/timeseries` | `DashboardTimeseries` | `adminHandler.DashboardTimeseries` | Usuário autenticado | 327 |
| 145 | GET | `/v1/admin/dashboard/pending` | `DashboardPending` | `adminHandler.DashboardPending` | Usuário autenticado | 328 |
| 146 | GET | `/v1/admin/dashboard/feed` | `DashboardFeed` | `adminHandler.DashboardFeed` | Usuário autenticado | 329 |
| 147 | GET | `/v1/admin/ai-agents` | `ListAgents` | `aiHandler.ListAgents` | Usuário autenticado | 330 |
| 148 | POST | `/v1/admin/ai-agents` | `CreateAgent` | `aiHandler.CreateAgent` | Usuário autenticado | 331 |
| 149 | PATCH | `/v1/admin/ai-agents/{id}` | `UpdateAgent` | `aiHandler.UpdateAgent` | Usuário autenticado | 332 |
| 150 | DELETE | `/v1/admin/ai-agents/{id}` | `DeleteAgent` | `aiHandler.DeleteAgent` | Usuário autenticado | 333 |
| 151 | PUT | `/v1/admin/organizations/{id}/ai-settings` | `AdminUpdateSettings` | `aiHandler.AdminUpdateSettings` | Usuário autenticado | 334 |
| 152 | GET | `/v1/admin/tables/{table}` | `ListTableRows` | `adminHandler.ListTableRows` | Usuário autenticado | 335 |
| 153 | GET | `/v1/admin/tables/{table}/count` | `CountTableRows` | `adminHandler.CountTableRows` | Usuário autenticado | 336 |
| 154 | POST | `/v1/admin/tables/{table}` | `CreateTableRow` | `adminHandler.CreateTableRow` | Usuário autenticado | 337 |
| 155 | PATCH | `/v1/admin/tables/{table}/{id}` | `UpdateTableRow` | `adminHandler.UpdateTableRow` | Usuário autenticado | 338 |
| 156 | DELETE | `/v1/admin/tables/{table}/{id}` | `DeleteTableRow` | `adminHandler.DeleteTableRow` | Usuário autenticado | 339 |
| 157 | GET | `/v1/admin/system-settings/notification-dispatch` | `ShowNotificationDispatchSettings` | `adminHandler.ShowNotificationDispatchSettings` | Usuário autenticado | 340 |
| 158 | PUT | `/v1/admin/system-settings/notification-dispatch` | `UpdateNotificationDispatchSettings` | `adminHandler.UpdateNotificationDispatchSettings` | Usuário autenticado | 341 |
| 159 | GET | `/v1/admin/notification-deliveries` | `ShowNotificationDeliveryOperations` | `adminHandler.ShowNotificationDeliveryOperations` | Usuário autenticado | 342 |
| 160 | POST | `/v1/admin/notification-deliveries/{id}/replay` | `ReplayNotificationDelivery` | `adminHandler.ReplayNotificationDelivery` | Usuário autenticado | 343 |
| 161 | GET | `/v1/admin/orphan-members` | `OrphanMemberStats` | `adminHandler.OrphanMemberStats` | Usuário autenticado | 344 |
| 162 | POST | `/v1/admin/orphan-members/cleanup` | `CleanupOrphanMembers` | `adminHandler.CleanupOrphanMembers` | Usuário autenticado | 345 |

### Gamificação — 12

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 40 | GET | `/v1/gamification/overview` | `Overview` | `gamificationHandler.Overview` | Módulo gamification + permissão GamificationView | 223 |
| 41 | GET | `/v1/gamification/ranking` | `Ranking` | `gamificationHandler.Ranking` | Módulo gamification + permissão GamificationView | 224 |
| 42 | GET | `/v1/gamification/events` | `Events` | `gamificationHandler.Events` | Módulo gamification + permissão GamificationView | 225 |
| 43 | GET | `/v1/gamification/admin` | `AdminSnapshot` | `gamificationHandler.AdminSnapshot` | Módulo gamification + permissão GamificationView | 226 |
| 44 | PUT | `/v1/gamification/rules/{actionType}` | `UpsertRule` | `gamificationHandler.UpsertRule` | Módulo gamification + permissão GamificationManage | 227 |
| 45 | PATCH | `/v1/gamification/participants/{userId}` | `SetParticipant` | `gamificationHandler.SetParticipant` | Módulo gamification + permissão GamificationManage | 228 |
| 46 | POST | `/v1/gamification/missions` | `CreateMission` | `gamificationHandler.CreateMission` | Módulo gamification + permissão GamificationManage | 229 |
| 47 | PATCH | `/v1/gamification/missions/{id}` | `UpdateMission` | `gamificationHandler.UpdateMission` | Módulo gamification + permissão GamificationManage | 230 |
| 48 | DELETE | `/v1/gamification/missions/{id}` | `DeleteMission` | `gamificationHandler.DeleteMission` | Módulo gamification + permissão GamificationManage | 231 |
| 49 | POST | `/v1/gamification/manual-entries` | `CreateManualEntry` | `gamificationHandler.CreateManualEntry` | Módulo gamification + permissão GamificationView | 232 |
| 50 | PATCH | `/v1/gamification/manual-entries/{id}` | `DecideManualEntry` | `gamificationHandler.DecideManualEntry` | Módulo gamification + permissão GamificationManage | 233 |
| 51 | POST | `/v1/gamification/seasons` | `ResetSeason` | `gamificationHandler.ResetSeason` | Módulo gamification + permissão GamificationManage | 234 |

### Modelos de cadência — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 52 | GET | `/v1/cadence-templates` | `ListTemplates` | `cadencesHandler.ListTemplates` | Organização ativa | 235 |

### Etapas — 5

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 53 | GET | `/v1/stages/{id}/operational-rules` | `GetOperationalRules` | `cadencesHandler.GetOperationalRules` | Organização ativa | 236 |
| 54 | PUT | `/v1/stages/{id}/operational-rules` | `UpsertOperationalRules` | `cadencesHandler.UpsertOperationalRules` | Organização + permissão PipelineManage | 237 |
| 521 | GET | `/v1/stages` | `ListStages` | `pipelinesHandler.ListStages` | Organização ativa | 708 |
| 525 | PATCH | `/v1/stages/{id}` | `UpdateStage` | `pipelinesHandler.UpdateStage` | Organização + permissão PipelineManage | 712 |
| 526 | DELETE | `/v1/stages/{id}` | `DeleteStage` | `pipelinesHandler.DeleteStage` | Organização + permissão PipelineManage | 713 |

### Leads — 20

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 55 | GET | `/v1/leads/{id}/cadence-state` | `GetLeadCadenceState` | `cadencesHandler.GetLeadCadenceState` | Organização ativa | 238 |
| 59 | POST | `/v1/leads/{id}/cadence` | `SwitchLeadCadence` | `cadencesHandler.SwitchLeadCadence` | Organização + permissão LeadOperate | 242 |
| 211 | POST | `/v1/leads/{id}/automation-executions/cancel` | `CancelLeadExecutions` | `automationsHandler.CancelLeadExecutions` | Módulo automations + permissão AutomationsManage | 394 |
| 405 | GET | `/v1/leads` | `List` | `leadsHandler.List` | Organização ativa | 588 |
| 406 | POST | `/v1/leads` | `Create` | `leadsHandler.Create` | Organização ativa | 593 |
| 407 | GET | `/v1/leads/{id}/timeline` | `ListLeadTimeline` | `leadsHandler.ListLeadTimeline` | Organização ativa | 594 |
| 408 | GET | `/v1/leads/{id}/journey` | `ListLeadJourney` | `leadsHandler.ListLeadJourney` | Organização ativa | 595 |
| 409 | GET | `/v1/leads/{id}/history-raw` | `ShowLeadHistoryRaw` | `leadsHandler.ShowLeadHistoryRaw` | Organização ativa | 596 |
| 410 | GET | `/v1/leads/{id}/conversation-detail` | `ShowConversationDetail` | `leadsHandler.ShowConversationDetail` | Organização ativa | 597 |
| 411 | GET | `/v1/leads/{id}/sensitive-profile` | `ShowSensitiveProfile` | `leadsHandler.ShowSensitiveProfile` | Organização + permissão LeadOperate | 598 |
| 412 | GET | `/v1/leads/{id}` | `Show` | `leadsHandler.Show` | Organização ativa | 599 |
| 413 | PATCH | `/v1/leads/{id}` | `Update` | `leadsHandler.Update` | Organização + permissão LeadOperate | 600 |
| 414 | DELETE | `/v1/leads/{id}` | `Delete` | `leadsHandler.Delete` | Organização + permissão LeadDelete | 601 |
| 415 | POST | `/v1/leads/{id}/attachments` | `UploadLeadAttachment` | `leadsHandler.UploadLeadAttachment` | Organização + permissão LeadOperate | 602 |
| 416 | POST | `/v1/leads/{id}/first-response` | `RecordFirstResponse` | `leadsHandler.RecordFirstResponse` | Organização + permissão LeadOperate | 603 |
| 417 | POST | `/v1/leads/{id}/move-stage` | `MoveStage` | `leadsHandler.MoveStage` | Organização + permissão LeadOperate | 604 |
| 418 | POST | `/v1/leads/{id}/assign` | `Assign` | `leadsHandler.Assign` | Organização + permissão LeadOperate | 605 |
| 419 | POST | `/v1/leads/{id}/redistribute` | `RedistributeRoundRobin` | `leadsHandler.RedistributeRoundRobin` | Organização + permissão LeadOperate | 606 |
| 420 | POST | `/v1/leads/{id}/tags` | `AddTag` | `leadsHandler.AddTag` | Organização + permissão LeadOperate | 607 |
| 421 | DELETE | `/v1/leads/{id}/tags/{tagId}` | `RemoveTag` | `leadsHandler.RemoveTag` | Organização + permissão LeadOperate | 608 |

### Tarefas de cadência — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 56 | POST | `/v1/cadence-tasks` | `CreateTask` | `cadencesHandler.CreateTask` | Organização + permissão PipelineManage | 239 |
| 57 | PATCH | `/v1/cadence-tasks/{id}` | `UpdateTask` | `cadencesHandler.UpdateTask` | Organização + permissão PipelineManage | 240 |
| 58 | DELETE | `/v1/cadence-tasks/{id}` | `DeleteTask` | `cadencesHandler.DeleteTask` | Organização + permissão PipelineManage | 241 |

### Financeiro — 8

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 60 | GET | `/v1/financial/categories` | `ListCategories` | `financialHandler.ListCategories` | Organização + acesso financeiro | 243 |
| 61 | POST | `/v1/financial/categories` | `CreateCategory` | `financialHandler.CreateCategory` | Organização + acesso financeiro | 244 |
| 62 | GET | `/v1/financial/entries` | `ListEntries` | `financialHandler.ListEntries` | Organização + acesso financeiro | 245 |
| 63 | POST | `/v1/financial/entries` | `CreateEntry` | `financialHandler.CreateEntry` | Organização + acesso financeiro | 246 |
| 64 | PATCH | `/v1/financial/entries/{id}` | `UpdateEntry` | `financialHandler.UpdateEntry` | Organização + acesso financeiro | 247 |
| 65 | DELETE | `/v1/financial/entries/{id}` | `DeleteEntry` | `financialHandler.DeleteEntry` | Organização + acesso financeiro | 248 |
| 66 | POST | `/v1/financial/entries/{id}/pay` | `MarkEntryPaid` | `financialHandler.MarkEntryPaid` | Organização + acesso financeiro | 249 |
| 67 | GET | `/v1/financial/dashboard` | `Dashboard` | `financialHandler.Dashboard` | Organização + acesso financeiro | 250 |

### Contratos financeiros — 11

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 68 | GET | `/v1/contracts` | `ListContracts` | `financialHandler.ListContracts` | Organização + acesso financeiro | 251 |
| 69 | POST | `/v1/contracts` | `CreateContract` | `financialHandler.CreateContract` | Organização + acesso financeiro | 252 |
| 70 | GET | `/v1/contracts/{id}` | `ShowContract` | `financialHandler.ShowContract` | Organização + acesso financeiro | 253 |
| 71 | PATCH | `/v1/contracts/{id}` | `UpdateContract` | `financialHandler.UpdateContract` | Organização + acesso financeiro | 254 |
| 72 | DELETE | `/v1/contracts/{id}` | `DeleteContract` | `financialHandler.DeleteContract` | Organização + acesso financeiro | 255 |
| 73 | POST | `/v1/contracts/{id}/activate` | `ActivateContract` | `financialHandler.ActivateContract` | Organização + acesso financeiro | 256 |
| 74 | POST | `/v1/contracts/{id}/regenerate-commissions` | `RegenerateCommissions` | `financialHandler.RegenerateCommissions` | Organização + acesso financeiro | 257 |
| 75 | GET | `/v1/contracts/{id}/documents` | `ListContractDocuments` | `financialHandler.ListContractDocuments` | Organização + acesso financeiro | 258 |
| 76 | POST | `/v1/contracts/{id}/documents` | `UploadContractDocument` | `financialHandler.UploadContractDocument` | Organização + acesso financeiro | 259 |
| 77 | DELETE | `/v1/contracts/{id}/documents` | `DeleteContractDocument` | `financialHandler.DeleteContractDocument` | Organização + acesso financeiro | 260 |
| 78 | POST | `/v1/contracts/{id}/documents/signed-url` | `ContractDocumentSignedURL` | `financialHandler.ContractDocumentSignedURL` | Organização + acesso financeiro | 261 |

### Regras de comissão — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 79 | GET | `/v1/commission-rules` | `ListCommissionRules` | `financialHandler.ListCommissionRules` | Organização + acesso financeiro | 262 |
| 80 | POST | `/v1/commission-rules` | `CreateCommissionRule` | `financialHandler.CreateCommissionRule` | Organização + acesso financeiro | 263 |
| 81 | PATCH | `/v1/commission-rules/{id}` | `UpdateCommissionRule` | `financialHandler.UpdateCommissionRule` | Organização + acesso financeiro | 264 |
| 82 | DELETE | `/v1/commission-rules/{id}` | `DeleteCommissionRule` | `financialHandler.DeleteCommissionRule` | Organização + acesso financeiro | 265 |

### Comissões — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 83 | GET | `/v1/commissions` | `ListCommissions` | `financialHandler.ListCommissions` | Organização + acesso financeiro | 266 |
| 84 | POST | `/v1/commissions/{id}/{action}` | `CommissionStatus` | `financialHandler.CommissionStatus` | Organização + acesso financeiro | 267 |
| 85 | GET | `/v1/commissions/by-broker` | `CommissionsByBroker` | `financialHandler.CommissionsByBroker` | Organização + acesso financeiro | 268 |

### DRE — 6

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 86 | GET | `/v1/dre/input` | `DREInput` | `financialHandler.DREInput` | Organização + acesso financeiro | 269 |
| 87 | GET | `/v1/dre/groups` | `DREGroups` | `financialHandler.DREGroups` | Organização + acesso financeiro | 270 |
| 88 | GET | `/v1/dre/mappings` | `DREMappings` | `financialHandler.DREMappings` | Organização + acesso financeiro | 271 |
| 89 | POST | `/v1/dre/mappings` | `CreateDREMapping` | `financialHandler.CreateDREMapping` | Organização + acesso financeiro | 272 |
| 90 | DELETE | `/v1/dre/mappings/{id}` | `DeleteDREMapping` | `financialHandler.DeleteDREMapping` | Organização + acesso financeiro | 273 |
| 91 | POST | `/v1/dre/groups/initialize` | `InitializeDREGroups` | `financialHandler.InitializeDREGroups` | Organização + acesso financeiro | 274 |

### Automações de etapa — 5

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 92 | GET | `/v1/stage-automations` | `ListAutomations` | `stageConfigHandler.ListAutomations` | Módulo automations + permissão AutomationsView | 275 |
| 93 | POST | `/v1/stage-automations` | `CreateAutomation` | `stageConfigHandler.CreateAutomation` | Módulo automations + permissão AutomationsManage | 276 |
| 94 | PATCH | `/v1/stage-automations/{id}` | `UpdateAutomation` | `stageConfigHandler.UpdateAutomation` | Módulo automations + permissão AutomationsManage | 277 |
| 95 | DELETE | `/v1/stage-automations/{id}` | `DeleteAutomation` | `stageConfigHandler.DeleteAutomation` | Módulo automations + permissão AutomationsManage | 278 |
| 96 | PATCH | `/v1/stage-automations/{id}/status` | `ToggleAutomation` | `stageConfigHandler.ToggleAutomation` | Módulo automations + permissão AutomationsManage | 279 |

### Configurações operacionais de etapa — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 97 | GET | `/v1/stage-operational-configs` | `ListOperationalConfigs` | `stageConfigHandler.ListOperationalConfigs` | Organização + permissão PipelineManage | 280 |
| 98 | PUT | `/v1/stage-operational-configs` | `UpsertOperationalConfig` | `stageConfigHandler.UpsertOperationalConfig` | Organização + permissão PipelineManage | 281 |

### SLA do pipeline — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 99 | GET | `/v1/pipeline-sla-settings` | `ListPipelineSLASettings` | `stageConfigHandler.ListPipelineSLASettings` | Organização + permissão PipelineManage | 282 |
| 100 | PUT | `/v1/pipeline-sla-settings` | `UpsertPipelineSLASettings` | `stageConfigHandler.UpsertPipelineSLASettings` | Organização + permissão PipelineManage | 283 |

### Comunicados — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 112 | GET | `/v1/announcements/active` | `ListActiveAnnouncements` | `adminHandler.ListActiveAnnouncements` | Usuário autenticado | 295 |

### Central de ajuda — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 115 | GET | `/v1/help/articles` | `ListArticles` | `helpHandler.ListArticles` | Usuário autenticado | 298 |
| 116 | GET | `/v1/help/articles/{slug}` | `ShowArticle` | `helpHandler.ShowArticle` | Usuário autenticado | 299 |
| 117 | POST | `/v1/help/search` | `SearchArticles` | `helpHandler.SearchArticles` | Usuário autenticado | 300 |

### APIs públicas — 30

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 118 | GET | `/v1/public/help/articles` | `ListPublicArticles` | `helpHandler.ListPublicArticles` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 301 |
| 119 | GET | `/v1/public/help/articles/{slug}` | `ShowPublicArticle` | `helpHandler.ShowPublicArticle` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 302 |
| 220 | POST | `/v1/public/webhooks/generic` | `ReceiveLead` | `webhooksHandler.ReceiveLead` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 403 |
| 221 | GET | `/v1/public/integrations/meta/webhook` | `Webhook` | `metaHandler.Webhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 404 |
| 222 | POST | `/v1/public/integrations/meta/webhook` | `Webhook` | `metaHandler.Webhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 405 |
| 223 | GET | `/v1/public/integrations/meta/oauth/callback` | `metaOAuthCallbackHandler` | `metaOAuthCallbackHandler` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 406 |
| 224 | GET | `/v1/public/integrations/portals/grupo-olx/feed/{token}` | `GrupoOLXFeed` | `portalsHandler.GrupoOLXFeed` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 407 |
| 225 | POST | `/v1/public/integrations/portals/grupo-olx/leads/{token}` | `GrupoOLXLeadWebhook` | `portalsHandler.GrupoOLXLeadWebhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 408 |
| 226 | POST | `/v1/public/integrations/portals/grupo-olx/import-reports/{token}` | `GrupoOLXImportReportWebhook` | `portalsHandler.GrupoOLXImportReportWebhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 409 |
| 227 | GET | `/v1/public/property-publications/{publicationId}/versions/{version}/assets/{assetId}` | `PublicMedia` | `publicationsHandler.PublicMedia` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 410 |
| 228 | GET | `/v1/public/onboarding/plans` | `PublicSubscriptionPlans` | `adminHandler.PublicSubscriptionPlans` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 411 |
| 229 | POST | `/v1/public/onboarding/validate-step` | `PublicOnboardingValidateStep` | `adminHandler.PublicOnboardingValidateStep` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 412 |
| 230 | POST | `/v1/public/onboarding/signup` | `PublicOnboardingSignup` | `adminHandler.PublicOnboardingSignup` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 413 |
| 231 | POST | `/v1/public/onboarding/signup/recovery` | `PublicRecoverOnboardingSignup` | `adminHandler.PublicRecoverOnboardingSignup` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 414 |
| 232 | POST | `/v1/public/onboarding/email-confirmation/resend` | `PublicResendOnboardingEmailConfirmation` | `adminHandler.PublicResendOnboardingEmailConfirmation` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 415 |
| 233 | POST | `/v1/public/onboarding/checkout-plan` | `PublicCheckoutPlan` | `adminHandler.PublicCheckoutPlan` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 416 |
| 234 | GET | `/v1/public/system-settings` | `PublicSystemSettings` | `settingsHandler.PublicSystemSettings` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 417 |
| 235 | GET | `/v1/public/site/resolve` | `ResolvePublicSite` | `siteHandler.ResolvePublicSite` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 418 |
| 236 | GET | `/v1/public/site/data` | `PublicSiteData` | `siteHandler.PublicSiteData` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 419 |
| 237 | GET | `/v1/public/site/menu-items` | `ListPublicMenuItems` | `siteHandler.ListPublicMenuItems` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 420 |
| 238 | GET | `/v1/public/site/search-filters` | `ListPublicSearchFilters` | `siteHandler.ListPublicSearchFilters` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 421 |
| 239 | POST | `/v1/public/site/contact` | `SubmitPublicContact` | `siteHandler.SubmitPublicContact` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 422 |
| 240 | POST | `/v1/public/tracking/events` | `TrackPublicEvent` | `siteHandler.TrackPublicEvent` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 423 |
| 241 | GET | `/v1/public/payments/checkout-info` | `PublicCheckoutInfo` | `integrationsHandler.PublicCheckoutInfo` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 424 |
| 242 | GET | `/v1/public/payments/status` | `PublicPaymentStatus` | `integrationsHandler.PublicPaymentStatus` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 425 |
| 243 | POST | `/v1/public/payments/charge` | `PublicCreateCharge` | `integrationsHandler.PublicCreateCharge` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 426 |
| 244 | POST | `/v1/public/payments/cancel` | `PublicCancelPayment` | `integrationsHandler.PublicCancelPayment` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 427 |
| 245 | GET | `/v1/public/invitations/{token}` | `ShowInvitationByToken` | `adminHandler.ShowInvitationByToken` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 428 |
| 246 | POST | `/v1/public/invitations/{token}/accept` | `AcceptInvitationPublic` | `adminHandler.AcceptInvitationPublic` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 429 |
| 283 | GET | `/v1/public/push-config` | `PublicPushConfig` | `settingsHandler.PublicPushConfig` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 466 |

### Solicitações de recursos — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 127 | GET | `/v1/feature-requests/mine` | `ListMyFeatureRequests` | `adminHandler.ListMyFeatureRequests` | Usuário autenticado | 310 |
| 128 | POST | `/v1/feature-requests` | `CreateFeatureRequest` | `adminHandler.CreateFeatureRequest` | Organização ativa | 311 |

### Convites — 6

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 131 | GET | `/v1/invitations` | `ListInvitations` | `adminHandler.ListInvitations` | Organização + permissão UsersManage | 314 |
| 132 | POST | `/v1/invitations` | `CreateInvitation` | `adminHandler.CreateInvitation` | Organização + permissão UsersManage | 315 |
| 133 | PATCH | `/v1/invitations/{id}` | `UpdateInvitationRole` | `adminHandler.UpdateInvitationRole` | Organização + permissão UsersManage | 316 |
| 134 | POST | `/v1/invitations/{id}/resend` | `ResendInvitation` | `adminHandler.ResendInvitation` | Organização + permissão UsersManage | 317 |
| 135 | DELETE | `/v1/invitations/{id}` | `DeleteInvitation` | `adminHandler.DeleteInvitation` | Organização + permissão UsersManage | 318 |
| 136 | POST | `/v1/invitations/{token}/accept` | `AcceptInvitationAuthenticated` | `adminHandler.AcceptInvitationAuthenticated` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 319 |

### Solicitações de onboarding — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 137 | GET | `/v1/onboarding-requests/mine` | `ShowMyOnboardingRequest` | `adminHandler.ShowMyOnboardingRequest` | Usuário autenticado | 320 |
| 138 | POST | `/v1/onboarding-requests` | `CreateOnboardingRequest` | `adminHandler.CreateOnboardingRequest` | Usuário autenticado | 321 |

### Planos de assinatura — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 141 | GET | `/v1/subscription-plans/active` | `ListActiveSubscriptionPlans` | `adminHandler.ListActiveSubscriptionPlans` | Usuário autenticado | 324 |

### Dashboard — 9

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 163 | GET | `/v1/dashboard/stats` | `ShowDashboardStats` | `leadsHandler.ShowDashboardStats` | Organização + permissão DashboardView | 346 |
| 164 | GET | `/v1/dashboard/funnel` | `ShowDashboardFunnel` | `leadsHandler.ShowDashboardFunnel` | Organização + permissão DashboardView | 347 |
| 165 | GET | `/v1/dashboard/sources` | `ShowDashboardSources` | `leadsHandler.ShowDashboardSources` | Organização + permissão DashboardView | 348 |
| 166 | GET | `/v1/dashboard/top-brokers` | `ShowDashboardTopBrokers` | `leadsHandler.ShowDashboardTopBrokers` | Organização + permissão DashboardView | 349 |
| 167 | GET | `/v1/dashboard/upcoming-tasks` | `ListDashboardUpcomingTasks` | `leadsHandler.ListDashboardUpcomingTasks` | Organização + permissão DashboardView | 350 |
| 168 | GET | `/v1/dashboard/deals-evolution` | `ShowDashboardDealsEvolution` | `leadsHandler.ShowDashboardDealsEvolution` | Organização + permissão DashboardView | 351 |
| 169 | GET | `/v1/dashboard/extra-counts` | `ShowDashboardExtraCounts` | `leadsHandler.ShowDashboardExtraCounts` | Organização + permissão DashboardView | 352 |
| 170 | GET | `/v1/dashboard/recent-activities` | `ListDashboardRecentActivities` | `leadsHandler.ListDashboardRecentActivities` | Organização + permissão DashboardView | 353 |
| 171 | GET | `/v1/dashboard/team-lead-ids` | `ListDashboardTeamLeadIDs` | `leadsHandler.ListDashboardTeamLeadIDs` | Organização + permissão DashboardView | 354 |

### Inteligência artificial — 13

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 172 | GET | `/v1/ai/settings` | `ShowSettings` | `aiHandler.ShowSettings` | Organização + permissão SettingsAI | 355 |
| 173 | PUT | `/v1/ai/settings` | `UpdateSettings` | `aiHandler.UpdateSettings` | Organização + permissão SettingsAI | 356 |
| 174 | GET | `/v1/ai/agents` | `ListOrganizationAgents` | `aiHandler.ListOrganizationAgents` | Organização + permissão SettingsAI | 357 |
| 175 | POST | `/v1/ai/agents` | `CreateOrganizationAgent` | `aiHandler.CreateOrganizationAgent` | Organização + permissão SettingsAI | 358 |
| 176 | PATCH | `/v1/ai/agents/{id}` | `UpdateOrganizationAgent` | `aiHandler.UpdateOrganizationAgent` | Organização + permissão SettingsAI | 359 |
| 177 | DELETE | `/v1/ai/agents/{id}` | `DeleteOrganizationAgent` | `aiHandler.DeleteOrganizationAgent` | Organização + permissão SettingsAI | 360 |
| 178 | GET | `/v1/ai/routing-rules` | `ListRoutingRules` | `aiHandler.ListRoutingRules` | Organização + permissão SettingsAI | 361 |
| 179 | POST | `/v1/ai/routing-rules` | `CreateRoutingRule` | `aiHandler.CreateRoutingRule` | Organização + permissão SettingsAI | 362 |
| 180 | PATCH | `/v1/ai/routing-rules/{id}` | `UpdateRoutingRule` | `aiHandler.UpdateRoutingRule` | Organização + permissão SettingsAI | 363 |
| 181 | DELETE | `/v1/ai/routing-rules/{id}` | `DeleteRoutingRule` | `aiHandler.DeleteRoutingRule` | Organização + permissão SettingsAI | 364 |
| 182 | GET | `/v1/ai/metrics` | `Metrics` | `aiHandler.Metrics` | Organização + permissão SettingsAI | 365 |
| 183 | GET | `/v1/ai/events` | `ListEvents` | `aiHandler.ListEvents` | Organização + permissão SettingsAI | 366 |
| 184 | POST | `/v1/ai/run` | `Run` | `aiHandler.Run` | Organização + permissão SettingsAI | 367 |

### Agenda — 11

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 185 | GET | `/v1/schedule/capabilities` | `ShowCapabilities` | `scheduleHandler.ShowCapabilities` | Organização + permissão ScheduleView | 368 |
| 186 | GET | `/v1/schedule/events` | `ListEvents` | `scheduleHandler.ListEvents` | Organização + permissão ScheduleView | 369 |
| 187 | POST | `/v1/schedule/events` | `CreateEvent` | `scheduleHandler.CreateEvent` | Organização + permissão ScheduleManage | 370 |
| 188 | PATCH | `/v1/schedule/events/{id}` | `UpdateEvent` | `scheduleHandler.UpdateEvent` | Organização + permissão ScheduleManage | 371 |
| 189 | DELETE | `/v1/schedule/events/{id}` | `DeleteEvent` | `scheduleHandler.DeleteEvent` | Organização + permissão ScheduleManage | 372 |
| 190 | POST | `/v1/schedule/events/{id}/complete` | `CompleteEvent` | `scheduleHandler.CompleteEvent` | Organização + permissão ScheduleManage | 373 |
| 191 | GET | `/v1/schedule/events/{id}/comments` | `ListComments` | `scheduleHandler.ListComments` | Organização + permissão ScheduleView | 374 |
| 192 | POST | `/v1/schedule/events/{id}/comments` | `AddComment` | `scheduleHandler.AddComment` | Organização + permissão ScheduleManage | 375 |
| 193 | GET | `/v1/schedule/events/{id}/assignees` | `ListAssignees` | `scheduleHandler.ListAssignees` | Organização + permissão ScheduleView | 376 |
| 194 | POST | `/v1/schedule/events/{id}/assignees` | `AddAssignee` | `scheduleHandler.AddAssignee` | Organização + permissão ScheduleManage | 377 |
| 195 | DELETE | `/v1/schedule/events/{id}/assignees/{userId}` | `RemoveAssignee` | `scheduleHandler.RemoveAssignee` | Organização + permissão ScheduleManage | 378 |

### Automações — 9

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 196 | GET | `/v1/automations` | `List` | `automationsHandler.List` | Módulo automations + permissão AutomationsView | 379 |
| 197 | POST | `/v1/automations` | `Create` | `automationsHandler.Create` | Módulo automations + permissão AutomationsManage | 380 |
| 198 | GET | `/v1/automations/{id}` | `Show` | `automationsHandler.Show` | Módulo automations + permissão AutomationsView | 381 |
| 199 | PATCH | `/v1/automations/{id}` | `Update` | `automationsHandler.Update` | Módulo automations + permissão AutomationsManage | 382 |
| 200 | DELETE | `/v1/automations/{id}` | `Delete` | `automationsHandler.Delete` | Módulo automations + permissão AutomationsManage | 383 |
| 201 | POST | `/v1/automations/{id}/duplicate` | `Duplicate` | `automationsHandler.Duplicate` | Módulo automations + permissão AutomationsManage | 384 |
| 202 | PUT | `/v1/automations/{id}/flow` | `SaveFlow` | `automationsHandler.SaveFlow` | Módulo automations + permissão AutomationsManage | 385 |
| 203 | POST | `/v1/automations/{id}/start` | `Start` | `automationsHandler.Start` | Módulo automations + permissão AutomationsManage | 386 |
| 212 | POST | `/v1/automations/{id}/executions/cancel` | `CancelAutomationExecutions` | `automationsHandler.CancelAutomationExecutions` | Módulo automations + permissão AutomationsManage | 395 |

### Modelos de automação — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 204 | GET | `/v1/automation-templates` | `ListTemplates` | `automationsHandler.ListTemplates` | Módulo automations + permissão AutomationsView | 387 |
| 205 | POST | `/v1/automation-templates` | `CreateTemplate` | `automationsHandler.CreateTemplate` | Módulo automations + permissão AutomationsManage | 388 |
| 206 | DELETE | `/v1/automation-templates/{id}` | `DeleteTemplate` | `automationsHandler.DeleteTemplate` | Módulo automations + permissão AutomationsManage | 389 |

### Execuções de automação — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 207 | GET | `/v1/automation-executions` | `ListExecutions` | `automationsHandler.ListExecutions` | Módulo automations + permissão AutomationsView | 390 |
| 208 | GET | `/v1/automation-executions/summary` | `ListExecutionSummaries` | `automationsHandler.ListExecutionSummaries` | Módulo automations + permissão AutomationsView | 391 |
| 209 | GET | `/v1/automation-executions/{id}/steps` | `ListExecutionSteps` | `automationsHandler.ListExecutionSteps` | Módulo automations + permissão AutomationsView | 392 |
| 210 | POST | `/v1/automation-executions/{id}/cancel` | `CancelExecution` | `automationsHandler.CancelExecution` | Módulo automations + permissão AutomationsManage | 393 |

### Runtime de automação — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 213 | GET | `/v1/automation-runtime/issues` | `ListRuntimeIssues` | `automationsHandler.ListRuntimeIssues` | Módulo automations + permissão AutomationsView | 396 |
| 214 | POST | `/v1/automation-runtime/issues/{kind}/{id}/retry` | `RetryRuntimeIssue` | `automationsHandler.RetryRuntimeIssue` | Módulo automations + permissão AutomationsManage | 397 |

### Mídias de automação — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 215 | GET | `/v1/automation-media` | `ListMedia` | `automationsHandler.ListMedia` | Módulo automations + permissão AutomationsView | 398 |
| 216 | POST | `/v1/automation-media` | `UploadMedia` | `automationsHandler.UploadMedia` | Módulo automations + permissão AutomationsManage | 399 |
| 217 | DELETE | `/v1/automation-media` | `DeleteMedia` | `automationsHandler.DeleteMedia` | Módulo automations + permissão AutomationsManage | 400 |

### WhatsApp — 47

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 218 | GET | `/v1/whatsapp/webhook/evolution-go` | `EvolutionGoWebhook` | `whatsappHandler.EvolutionGoWebhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 401 |
| 219 | POST | `/v1/whatsapp/webhook/evolution-go` | `EvolutionGoWebhook` | `whatsappHandler.EvolutionGoWebhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 402 |
| 332 | GET | `/v1/whatsapp/message-templates` | `ListMessageTemplates` | `whatsappHandler.ListMessageTemplates` | Módulo whatsapp + permissão WhatsAppView | 515 |
| 333 | POST | `/v1/whatsapp/message-templates` | `CreateMessageTemplate` | `whatsappHandler.CreateMessageTemplate` | Módulo whatsapp + permissão WhatsAppOperate | 516 |
| 334 | PATCH | `/v1/whatsapp/message-templates/{id}` | `UpdateMessageTemplate` | `whatsappHandler.UpdateMessageTemplate` | Módulo whatsapp + permissão WhatsAppOperate | 517 |
| 335 | DELETE | `/v1/whatsapp/message-templates/{id}` | `DeleteMessageTemplate` | `whatsappHandler.DeleteMessageTemplate` | Módulo whatsapp + permissão WhatsAppOperate | 518 |
| 336 | GET | `/v1/whatsapp/sessions` | `ListSessions` | `whatsappHandler.ListSessions` | Módulo whatsapp + permissão WhatsAppView | 519 |
| 337 | POST | `/v1/whatsapp/sessions` | `CreateSession` | `whatsappHandler.CreateSession` | Módulo whatsapp + permissão WhatsAppManage | 520 |
| 338 | GET | `/v1/whatsapp/sessions/{id}` | `ShowSession` | `whatsappHandler.ShowSession` | Módulo whatsapp + permissão WhatsAppView | 521 |
| 339 | DELETE | `/v1/whatsapp/sessions/{id}` | `DeleteSession` | `whatsappHandler.DeleteSession` | Módulo whatsapp + permissão WhatsAppManage | 522 |
| 340 | POST | `/v1/whatsapp/sessions/{id}/qr` | `GetQRCode` | `whatsappHandler.GetQRCode` | Módulo whatsapp + permissão WhatsAppManage | 523 |
| 341 | POST | `/v1/whatsapp/sessions/{id}/status` | `GetConnectionStatus` | `whatsappHandler.GetConnectionStatus` | Módulo whatsapp + permissão WhatsAppManage | 524 |
| 342 | POST | `/v1/whatsapp/sessions/{id}/recreate` | `RecreateSession` | `whatsappHandler.RecreateSession` | Módulo whatsapp + permissão WhatsAppManage | 525 |
| 343 | POST | `/v1/whatsapp/sessions/{id}/logout` | `LogoutSession` | `whatsappHandler.LogoutSession` | Módulo whatsapp + permissão WhatsAppManage | 526 |
| 344 | POST | `/v1/whatsapp/sessions/{id}/notification-session` | `ToggleNotificationSession` | `whatsappHandler.ToggleNotificationSession` | Módulo whatsapp + permissão WhatsAppManage | 527 |
| 345 | POST | `/v1/whatsapp/sessions/{id}/ai-auto-reply` | `ToggleAutoReplySession` | `whatsappHandler.ToggleAutoReplySession` | Módulo whatsapp + permissão WhatsAppManage | 528 |
| 346 | GET | `/v1/whatsapp/sessions/{id}/access` | `ListSessionAccess` | `whatsappHandler.ListSessionAccess` | Módulo whatsapp + permissão WhatsAppManage | 529 |
| 347 | POST | `/v1/whatsapp/sessions/{id}/access` | `GrantSessionAccess` | `whatsappHandler.GrantSessionAccess` | Módulo whatsapp + permissão WhatsAppManage | 530 |
| 348 | DELETE | `/v1/whatsapp/sessions/{id}/access/{userId}` | `RevokeSessionAccess` | `whatsappHandler.RevokeSessionAccess` | Módulo whatsapp + permissão WhatsAppManage | 531 |
| 349 | GET | `/v1/whatsapp/sessions/{id}/labels` | `ListLabels` | `whatsappHandler.ListLabels` | Módulo whatsapp + permissão WhatsAppView | 532 |
| 350 | POST | `/v1/whatsapp/sessions/{id}/labels/sync` | `SyncLabels` | `whatsappHandler.SyncLabels` | Módulo whatsapp + permissão WhatsAppOperate | 533 |
| 351 | POST | `/v1/whatsapp/sessions/{id}/labels/assign` | `AssignLabel` | `whatsappHandler.AssignLabel` | Módulo whatsapp + permissão WhatsAppOperate | 534 |
| 352 | GET | `/v1/whatsapp/sessions/{id}/groups` | `ListGroups` | `whatsappHandler.ListGroups` | Módulo whatsapp + permissão WhatsAppView | 535 |
| 353 | POST | `/v1/whatsapp/sessions/{id}/groups/sync` | `SyncGroups` | `whatsappHandler.SyncGroups` | Módulo whatsapp + permissão WhatsAppOperate | 536 |
| 354 | POST | `/v1/whatsapp/sessions/{id}/groups/info` | `GroupInfo` | `whatsappHandler.GroupInfo` | Módulo whatsapp + permissão WhatsAppOperate | 537 |
| 355 | POST | `/v1/whatsapp/sessions/{id}/groups/invite-link` | `GroupInviteLink` | `whatsappHandler.GroupInviteLink` | Módulo whatsapp + permissão WhatsAppOperate | 538 |
| 356 | POST | `/v1/whatsapp/sessions/{id}/groups/update` | `UpdateGroup` | `whatsappHandler.UpdateGroup` | Módulo whatsapp + permissão WhatsAppOperate | 539 |
| 357 | POST | `/v1/whatsapp/sessions/{id}/contacts/check` | `CheckNumbers` | `whatsappHandler.CheckNumbers` | Módulo whatsapp + permissão WhatsAppOperate | 540 |
| 358 | POST | `/v1/whatsapp/sessions/{id}/contacts/avatar` | `FetchAvatar` | `whatsappHandler.FetchAvatar` | Módulo whatsapp + permissão WhatsAppOperate | 541 |
| 359 | POST | `/v1/whatsapp/sessions/{id}/contacts/sync` | `SyncContactsAvatars` | `whatsappHandler.SyncContactsAvatars` | Módulo whatsapp + permissão WhatsAppOperate | 542 |
| 360 | POST | `/v1/whatsapp/sessions/{id}/history-sync` | `HistorySync` | `whatsappHandler.HistorySync` | Módulo whatsapp + permissão WhatsAppOperate | 543 |
| 361 | POST | `/v1/whatsapp/provider-action` | `ProviderAction` | `whatsappHandler.ProviderAction` | Módulo whatsapp + permissão WhatsAppManage | 544 |
| 362 | GET | `/v1/whatsapp/conversations` | `ListConversations` | `whatsappHandler.ListConversations` | Módulo whatsapp + permissão WhatsAppView | 545 |
| 363 | POST | `/v1/whatsapp/conversations/start` | `StartConversation` | `whatsappHandler.StartConversation` | Módulo whatsapp + permissão WhatsAppOperate | 546 |
| 364 | GET | `/v1/whatsapp/conversations/find` | `FindConversation` | `whatsappHandler.FindConversation` | Módulo whatsapp + permissão WhatsAppView | 547 |
| 365 | GET | `/v1/whatsapp/history` | `HistoryAccess` | `whatsappHandler.HistoryAccess` | Módulo whatsapp + permissão WhatsAppView | 548 |
| 366 | GET | `/v1/whatsapp/conversations/{id}` | `ShowConversation` | `whatsappHandler.ShowConversation` | Módulo whatsapp + permissão WhatsAppView | 549 |
| 367 | GET | `/v1/whatsapp/conversations/{id}/messages` | `ListMessages` | `whatsappHandler.ListMessages` | Módulo whatsapp + permissão WhatsAppView | 550 |
| 368 | POST | `/v1/whatsapp/conversations/{id}/send-message` | `SendMessage` | `whatsappHandler.SendMessage` | Módulo whatsapp + permissão WhatsAppOperate | 551 |
| 369 | POST | `/v1/whatsapp/conversations/{id}/messages/{messageId}/reaction` | `ReactToMessage` | `whatsappHandler.ReactToMessage` | Módulo whatsapp + permissão WhatsAppOperate | 552 |
| 370 | POST | `/v1/whatsapp/conversations/{id}/mark-read` | `MarkConversationAsRead` | `whatsappHandler.MarkConversationAsRead` | Módulo whatsapp + permissão WhatsAppOperate | 553 |
| 371 | POST | `/v1/whatsapp/conversations/{id}/mark-seen` | `MarkAsSeenOnWhatsApp` | `whatsappHandler.MarkAsSeenOnWhatsApp` | Módulo whatsapp + permissão WhatsAppOperate | 554 |
| 372 | POST | `/v1/whatsapp/conversations/{id}/archive` | `ArchiveConversation` | `whatsappHandler.ArchiveConversation` | Módulo whatsapp + permissão WhatsAppOperate | 555 |
| 373 | DELETE | `/v1/whatsapp/conversations/{id}` | `DeleteConversation` | `whatsappHandler.DeleteConversation` | Módulo whatsapp + permissão WhatsAppOperate | 556 |
| 374 | POST | `/v1/whatsapp/conversations/{id}/link-lead` | `LinkConversationToLead` | `whatsappHandler.LinkConversationToLead` | Módulo whatsapp + permissão WhatsAppOperate | 557 |
| 375 | GET | `/v1/whatsapp/conversations/{id}/labels` | `ListChatLabels` | `whatsappHandler.ListChatLabels` | Módulo whatsapp + permissão WhatsAppView | 558 |
| 376 | POST | `/v1/whatsapp/messages/{id}/retry-media` | `RetryMediaDownload` | `whatsappHandler.RetryMediaDownload` | Módulo whatsapp + permissão WhatsAppOperate | 559 |

### Webhooks — 5

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 247 | GET | `/v1/webhooks` | `List` | `webhooksHandler.List` | Organização + permissão SettingsIntegrations | 430 |
| 248 | POST | `/v1/webhooks` | `Create` | `webhooksHandler.Create` | Organização + permissão SettingsIntegrations | 431 |
| 249 | PATCH | `/v1/webhooks/{id}` | `Update` | `webhooksHandler.Update` | Organização + permissão SettingsIntegrations | 432 |
| 250 | DELETE | `/v1/webhooks/{id}` | `Delete` | `webhooksHandler.Delete` | Organização + permissão SettingsIntegrations | 433 |
| 251 | POST | `/v1/webhooks/{id}/regenerate-token` | `RegenerateToken` | `webhooksHandler.RegenerateToken` | Organização + permissão SettingsIntegrations | 434 |

### Integrações — 31

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 252 | POST | `/v1/integrations/functions/{name}` | `InvokeFunction` | `integrationsHandler.InvokeFunction` | Organização + permissão SettingsIntegrations | 435 |
| 253 | GET | `/v1/integrations/vista` | `GetVista` | `integrationsHandler.GetVista` | Organização + permissão SettingsIntegrations | 436 |
| 254 | PUT | `/v1/integrations/vista` | `SaveVista` | `integrationsHandler.SaveVista` | Organização + permissão SettingsIntegrations | 437 |
| 255 | DELETE | `/v1/integrations/vista` | `DeleteVista` | `integrationsHandler.DeleteVista` | Organização + permissão SettingsIntegrations | 438 |
| 256 | GET | `/v1/integrations/imoview` | `GetImoview` | `integrationsHandler.GetImoview` | Organização + permissão SettingsIntegrations | 439 |
| 257 | PUT | `/v1/integrations/imoview` | `SaveImoview` | `integrationsHandler.SaveImoview` | Organização + permissão SettingsIntegrations | 440 |
| 258 | DELETE | `/v1/integrations/imoview` | `DeleteImoview` | `integrationsHandler.DeleteImoview` | Organização + permissão SettingsIntegrations | 441 |
| 259 | GET | `/v1/integrations/meta` | `ListMetaIntegrations` | `integrationsHandler.ListMetaIntegrations` | Organização + permissão SettingsIntegrations | 442 |
| 260 | PUT | `/v1/integrations/meta/conversion-feedback` | `SaveMetaConversionFeedback` | `integrationsHandler.SaveMetaConversionFeedback` | Módulo campaigns + permissão SettingsIntegrations | 443 |
| 261 | POST | `/v1/integrations/meta/oauth/actions` | `metaOAuthActionHandler` | `metaOAuthActionHandler` | Organização + permissão SettingsIntegrations | 444 |
| 262 | POST | `/v1/integrations/meta/marketing/sync` | `Sync` | `metaMarketingSyncHandler.Sync` | Módulo campaigns + permissão SettingsIntegrations | 445 |
| 263 | GET | `/v1/integrations/meta/pages/{pageId}/forms` | `ListMetaPageForms` | `integrationsHandler.ListMetaPageForms` | Organização + permissão SettingsIntegrations | 446 |
| 264 | GET | `/v1/integrations/meta/oauth-flows/{id}` | `ShowMetaOAuthFlow` | `integrationsHandler.ShowMetaOAuthFlow` | Organização + permissão SettingsIntegrations | 447 |
| 265 | GET | `/v1/integrations/meta/form-configs` | `ListMetaFormConfigs` | `integrationsHandler.ListMetaFormConfigs` | Organização + permissão SettingsIntegrations | 448 |
| 266 | POST | `/v1/integrations/meta/form-configs` | `SaveMetaFormConfig` | `integrationsHandler.SaveMetaFormConfig` | Organização + permissão SettingsIntegrations | 449 |
| 267 | PATCH | `/v1/integrations/meta/form-configs` | `ToggleMetaFormConfig` | `integrationsHandler.ToggleMetaFormConfig` | Organização + permissão SettingsIntegrations | 450 |
| 268 | DELETE | `/v1/integrations/meta/form-configs` | `DeleteMetaFormConfig` | `integrationsHandler.DeleteMetaFormConfig` | Organização + permissão SettingsIntegrations | 451 |
| 269 | GET | `/v1/integrations/meta/webhook-health` | `MetaWebhookHealth` | `integrationsHandler.MetaWebhookHealth` | Organização + permissão SettingsIntegrations | 452 |
| 270 | GET | `/v1/integrations/meta/conversations` | `ListMetaConversations` | `integrationsHandler.ListMetaConversations` | Módulos whatsapp + campaigns + permissão WhatsAppView | 453 |
| 271 | GET | `/v1/integrations/meta/conversations/{id}/messages` | `ListMetaMessages` | `integrationsHandler.ListMetaMessages` | Módulos whatsapp + campaigns + permissão WhatsAppView | 454 |
| 272 | POST | `/v1/integrations/meta/conversations/{id}/messages` | `SendMetaMessage` | `integrationsHandler.SendMetaMessage` | Módulos whatsapp + campaigns + permissão WhatsAppOperate | 455 |
| 273 | GET | `/v1/integrations/portals/grupo-olx` | `GetGrupoOLX` | `portalsHandler.GetGrupoOLX` | Módulo portals + permissão SettingsIntegrations | 456 |
| 274 | PUT | `/v1/integrations/portals/grupo-olx` | `SaveGrupoOLX` | `portalsHandler.SaveGrupoOLX` | Módulo portals + permissão SettingsIntegrations | 457 |
| 275 | POST | `/v1/integrations/portals/grupo-olx/activate` | `ActivateGrupoOLX` | `portalsHandler.ActivateGrupoOLX` | Módulo portals + permissão SettingsIntegrations | 458 |
| 276 | POST | `/v1/integrations/portals/grupo-olx/pause` | `PauseGrupoOLX` | `portalsHandler.PauseGrupoOLX` | Módulo portals + permissão SettingsIntegrations | 459 |
| 277 | POST | `/v1/integrations/portals/grupo-olx/regenerate-feed-token` | `RegenerateGrupoOLXFeedToken` | `portalsHandler.RegenerateGrupoOLXFeedToken` | Módulo portals + permissão SettingsIntegrations | 460 |
| 278 | POST | `/v1/integrations/portals/grupo-olx/regenerate-webhook-token` | `RegenerateGrupoOLXWebhookToken` | `portalsHandler.RegenerateGrupoOLXWebhookToken` | Módulo portals + permissão SettingsIntegrations | 461 |
| 279 | GET | `/v1/integrations/portals/grupo-olx/publications` | `ListGrupoOLXPublications` | `portalsHandler.ListGrupoOLXPublications` | Módulo portals + permissão SettingsIntegrations | 462 |
| 280 | PUT | `/v1/integrations/portals/grupo-olx/publications` | `UpsertGrupoOLXPublications` | `portalsHandler.UpsertGrupoOLXPublications` | Módulo portals + permissão SettingsIntegrations | 463 |
| 281 | GET | `/v1/integrations/portals/grupo-olx/import-reports` | `ListGrupoOLXImportReports` | `portalsHandler.ListGrupoOLXImportReports` | Módulo portals + permissão SettingsIntegrations | 464 |
| 282 | POST | `/v1/integrations/portals/grupo-olx/import-reports/{id}/replay` | `ReplayGrupoOLXImportReport` | `portalsHandler.ReplayGrupoOLXImportReport` | Módulo portals + permissão SettingsIntegrations | 465 |

### Configurações — 33

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 284 | PATCH | `/v1/settings/profile` | `UpdateProfile` | `settingsHandler.UpdateProfile` | Usuário autenticado | 467 |
| 285 | POST | `/v1/settings/profile/avatar` | `UploadProfileAvatar` | `settingsHandler.UploadProfileAvatar` | Usuário autenticado | 468 |
| 286 | PATCH | `/v1/settings/organization` | `UpdateOrganization` | `settingsHandler.UpdateOrganization` | Organização + permissão SettingsOrganization | 469 |
| 287 | POST | `/v1/settings/organization/logo` | `UploadOrganizationLogo` | `settingsHandler.UploadOrganizationLogo` | Organização + permissão SettingsOrganization | 470 |
| 288 | POST | `/v1/settings/password` | `ChangePassword` | `settingsHandler.ChangePassword` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 471 |
| 289 | GET | `/v1/settings/password/status` | `PasswordStatus` | `settingsHandler.PasswordStatus` | Usuário autenticado | 472 |
| 290 | GET | `/v1/settings/modules` | `ListOrganizationModules` | `settingsHandler.ListOrganizationModules` | Organização ativa | 473 |
| 291 | GET | `/v1/settings/setup-guide-progress` | `ShowSetupGuideProgress` | `settingsHandler.ShowSetupGuideProgress` | Usuário autenticado | 474 |
| 292 | PUT | `/v1/settings/setup-guide-progress` | `UpdateSetupGuideProgress` | `settingsHandler.UpdateSetupGuideProgress` | Usuário autenticado | 475 |
| 293 | POST | `/v1/settings/push-tokens` | `SavePushToken` | `settingsHandler.SavePushToken` | Organização ativa | 476 |
| 294 | GET | `/v1/settings/push-tokens` | `ListPushDevices` | `settingsHandler.ListPushDevices` | Organização ativa | 477 |
| 295 | POST | `/v1/settings/push-tokens/deactivate` | `DeactivatePushToken` | `settingsHandler.DeactivatePushToken` | Usuário autenticado | 478 |
| 296 | GET | `/v1/settings/api-keys` | `ListAPIKeys` | `settingsHandler.ListAPIKeys` | Organização + permissão SettingsIntegrations | 479 |
| 297 | POST | `/v1/settings/api-keys` | `CreateAPIKey` | `settingsHandler.CreateAPIKey` | Organização + permissão SettingsIntegrations | 480 |
| 298 | DELETE | `/v1/settings/api-keys/{id}` | `DeleteAPIKey` | `settingsHandler.DeleteAPIKey` | Organização + permissão SettingsIntegrations | 481 |
| 299 | GET | `/v1/settings/subscription` | `ShowSubscription` | `settingsHandler.ShowSubscription` | Organização + permissão SettingsBilling | 482 |
| 300 | POST | `/v1/settings/subscription/payments/{id}/refresh` | `RefreshSubscriptionPayment` | `settingsHandler.RefreshSubscriptionPayment` | Organização + permissão SettingsBilling | 483 |
| 301 | PATCH | `/v1/settings/subscription/billing` | `UpdateSubscriptionBilling` | `settingsHandler.UpdateSubscriptionBilling` | Organização + permissão SettingsBilling | 484 |
| 302 | PATCH | `/v1/settings/subscription/plan` | `SelectSubscriptionPlan` | `settingsHandler.SelectSubscriptionPlan` | Organização + permissão SettingsBilling | 485 |
| 303 | POST | `/v1/settings/subscription/charge` | `CreateSubscriptionCharge` | `integrationsHandler.CreateSubscriptionCharge` | Organização + permissão SettingsBilling | 486 |
| 304 | GET | `/v1/settings/roles` | `ListOrganizationRoles` | `settingsHandler.ListOrganizationRoles` | Organização + permissão PermissionsManage | 487 |
| 305 | POST | `/v1/settings/roles` | `CreateRole` | `settingsHandler.CreateRole` | Organização + permissão PermissionsManage | 488 |
| 306 | PATCH | `/v1/settings/roles/{id}` | `UpdateRole` | `settingsHandler.UpdateRole` | Organização + permissão PermissionsManage | 489 |
| 307 | DELETE | `/v1/settings/roles/{id}` | `DeleteRole` | `settingsHandler.DeleteRole` | Organização + permissão PermissionsManage | 490 |
| 308 | GET | `/v1/settings/roles/{id}/permissions` | `ListRolePermissions` | `settingsHandler.ListRolePermissions` | Organização + permissão PermissionsManage | 491 |
| 309 | PUT | `/v1/settings/roles/{id}/permissions` | `ReplaceRolePermissions` | `settingsHandler.ReplaceRolePermissions` | Organização + permissão PermissionsManage | 492 |
| 310 | GET | `/v1/settings/permissions` | `ListAvailablePermissions` | `settingsHandler.ListAvailablePermissions` | Usuário autenticado | 493 |
| 311 | GET | `/v1/settings/users/{id}/permissions` | `ShowUserPermissions` | `settingsHandler.ShowUserPermissions` | Organização + permissão PermissionsManage | 494 |
| 312 | PUT | `/v1/settings/users/{id}/permissions` | `ReplaceUserPermissions` | `settingsHandler.ReplaceUserPermissions` | Organização + permissão PermissionsManage | 495 |
| 313 | DELETE | `/v1/settings/users/{id}/permissions` | `ResetUserPermissions` | `settingsHandler.ResetUserPermissions` | Organização + permissão PermissionsManage | 496 |
| 314 | GET | `/v1/settings/user-roles` | `ListUserOrganizationRoles` | `settingsHandler.ListUserOrganizationRoles` | Organização + permissão PermissionsManage | 497 |
| 315 | PUT | `/v1/settings/user-roles` | `AssignUserRole` | `settingsHandler.AssignUserRole` | Organização + permissão PermissionsManage | 498 |
| 316 | GET | `/v1/settings/has-permission` | `HasPermission` | `settingsHandler.HasPermission` | Usuário autenticado | 499 |

### Site — 15

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 317 | GET | `/v1/site` | `ShowSite` | `siteHandler.ShowSite` | Módulo site + permissão SettingsSite | 500 |
| 318 | POST | `/v1/site` | `CreateSite` | `siteHandler.CreateSite` | Módulo site + permissão SettingsSite | 501 |
| 319 | PATCH | `/v1/site` | `UpdateSite` | `siteHandler.UpdateSite` | Módulo site + permissão SettingsSite | 502 |
| 320 | POST | `/v1/site/domain/verify` | `VerifyDomain` | `siteHandler.VerifyDomain` | Módulo site + permissão SettingsSite | 503 |
| 321 | POST | `/v1/site/assets` | `UploadAsset` | `siteHandler.UploadAsset` | Módulo site + permissão SettingsSite | 504 |
| 322 | GET | `/v1/site/menu-items` | `ListMenuItems` | `siteHandler.ListMenuItems` | Módulo site + permissão SettingsSite | 505 |
| 323 | POST | `/v1/site/menu-items` | `CreateMenuItem` | `siteHandler.CreateMenuItem` | Módulo site + permissão SettingsSite | 506 |
| 324 | PATCH | `/v1/site/menu-items/{id}` | `UpdateMenuItem` | `siteHandler.UpdateMenuItem` | Módulo site + permissão SettingsSite | 507 |
| 325 | DELETE | `/v1/site/menu-items/{id}` | `DeleteMenuItem` | `siteHandler.DeleteMenuItem` | Módulo site + permissão SettingsSite | 508 |
| 326 | POST | `/v1/site/menu-items/reorder` | `ReorderMenuItems` | `siteHandler.ReorderMenuItems` | Módulo site + permissão SettingsSite | 509 |
| 327 | GET | `/v1/site/search-filters` | `ListSearchFilters` | `siteHandler.ListSearchFilters` | Módulo site + permissão SettingsSite | 510 |
| 328 | POST | `/v1/site/search-filters` | `CreateSearchFilter` | `siteHandler.CreateSearchFilter` | Módulo site + permissão SettingsSite | 511 |
| 329 | PATCH | `/v1/site/search-filters/{id}` | `UpdateSearchFilter` | `siteHandler.UpdateSearchFilter` | Módulo site + permissão SettingsSite | 512 |
| 330 | DELETE | `/v1/site/search-filters/{id}` | `DeleteSearchFilter` | `siteHandler.DeleteSearchFilter` | Módulo site + permissão SettingsSite | 513 |
| 331 | POST | `/v1/site/search-filters/reorder` | `ReorderSearchFilters` | `siteHandler.ReorderSearchFilters` | Módulo site + permissão SettingsSite | 514 |

### Enriquecimento de leads — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 377 | GET | `/v1/lead-enrichments` | `ListEnrichments` | `leadsHandler.ListEnrichments` | Organização ativa | 560 |

### Quadro do pipeline — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 378 | GET | `/v1/pipeline-board` | `ShowPipelineBoard` | `leadsHandler.ShowPipelineBoard` | Organização ativa | 561 |

### Leads por etapa — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 379 | GET | `/v1/pipeline-stage-leads` | `ListPipelineStageLeads` | `leadsHandler.ListPipelineStageLeads` | Organização ativa | 562 |

### Contagem por etapa — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 380 | GET | `/v1/pipeline-stage-counts` | `ListPipelineStageCounts` | `leadsHandler.ListPipelineStageCounts` | Organização ativa | 563 |

### Filtros de metadados de leads — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 381 | GET | `/v1/lead-meta-filters` | `ListLeadMetaFilters` | `leadsHandler.ListLeadMetaFilters` | Organização ativa | 564 |

### Visibilidade de leads — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 382 | GET | `/v1/lead-visibility` | `ShowLeadVisibility` | `leadsHandler.ShowLeadVisibility` | Organização ativa | 565 |

### Contatos — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 383 | GET | `/v1/contacts` | `ListContacts` | `leadsHandler.ListContacts` | Organização ativa | 566 |

### Tags — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 384 | GET | `/v1/tags` | `ListTags` | `leadsHandler.ListTags` | Organização ativa | 567 |
| 385 | POST | `/v1/tags` | `CreateTag` | `leadsHandler.CreateTag` | Organização + permissão TagManage | 568 |
| 386 | PATCH | `/v1/tags/{id}` | `UpdateTag` | `leadsHandler.UpdateTag` | Organização + permissão TagManage | 569 |
| 387 | DELETE | `/v1/tags/{id}` | `DeleteTag` | `leadsHandler.DeleteTag` | Organização + permissão TagManage | 570 |

### Atividades — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 388 | GET | `/v1/activities` | `ListActivities` | `leadsHandler.ListActivities` | Organização ativa | 571 |
| 389 | POST | `/v1/activities` | `CreateActivity` | `leadsHandler.CreateActivity` | Organização + permissão LeadOperate | 572 |

### Metadados de leads — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 390 | GET | `/v1/lead-meta` | `ShowLeadMeta` | `leadsHandler.ShowLeadMeta` | Organização ativa | 573 |

### Anexos de leads — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 391 | GET | `/v1/lead-attachments` | `ListLeadAttachments` | `leadsHandler.ListLeadAttachments` | Organização ativa | 574 |
| 392 | POST | `/v1/lead-attachments` | `CreateLeadAttachment` | `leadsHandler.CreateLeadAttachment` | Organização + permissão LeadOperate | 575 |

### Analytics de leads — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 393 | GET | `/v1/lead-analytics/first-response-metrics` | `ShowFirstResponseMetrics` | `leadsHandler.ShowFirstResponseMetrics` | Organização ativa | 576 |
| 394 | GET | `/v1/lead-analytics/first-response-ranking` | `ListFirstResponseRanking` | `leadsHandler.ListFirstResponseRanking` | Organização ativa | 577 |

### Tarefas de leads — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 395 | GET | `/v1/lead-tasks` | `ListLeadTasks` | `leadsHandler.ListLeadTasks` | Organização ativa | 578 |
| 396 | POST | `/v1/lead-tasks` | `CreateLeadTask` | `leadsHandler.CreateLeadTask` | Organização + permissão LeadOperate | 579 |
| 397 | PATCH | `/v1/lead-tasks/{id}` | `PatchLeadTask` | `leadsHandler.PatchLeadTask` | Organização + permissão LeadOperate | 580 |
| 398 | POST | `/v1/lead-tasks/complete-cadence` | `CompleteCadenceTask` | `leadsHandler.CompleteCadenceTask` | Organização + permissão LeadOperate | 581 |

### Notificações — 6

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 399 | GET | `/v1/notifications` | `ListNotifications` | `leadsHandler.ListNotifications` | Organização ativa | 582 |
| 400 | POST | `/v1/notifications` | `CreateNotification` | `leadsHandler.CreateNotification` | Organização ativa | 583 |
| 401 | POST | `/v1/notifications/dispatch` | `DispatchNotification` | `leadsHandler.DispatchNotification` | Organização ativa | 584 |
| 402 | GET | `/v1/notifications/unread-count` | `CountUnreadNotifications` | `leadsHandler.CountUnreadNotifications` | Organização ativa | 585 |
| 403 | POST | `/v1/notifications/{id}/read` | `MarkNotificationRead` | `leadsHandler.MarkNotificationRead` | Organização ativa | 586 |
| 404 | POST | `/v1/notifications/read-all` | `MarkAllNotificationsRead` | `leadsHandler.MarkAllNotificationsRead` | Organização ativa | 587 |

### property-developments — 19

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 422 | GET | `/v1/property-developments` | `List` | `developmentsHandler.List` | Módulo properties + permissão PropertyView | 609 |
| 423 | POST | `/v1/property-developments` | `Create` | `developmentsHandler.Create` | Módulo properties + permissão PropertyManage | 610 |
| 424 | GET | `/v1/property-developments/{id}/workspace` | `ShowWorkspace` | `developmentsHandler.ShowWorkspace` | Módulo properties + permissão PropertyView | 611 |
| 425 | GET | `/v1/property-developments/{id}/units` | `ListUnits` | `developmentsHandler.ListUnits` | Módulo properties + permissão PropertyView | 612 |
| 426 | GET | `/v1/property-developments/{id}/reservations` | `ListReservations` | `developmentsHandler.ListReservations` | Módulo properties + permissão PropertyView | 613 |
| 427 | POST | `/v1/property-developments/{id}/phases` | `CreatePhase` | `developmentsHandler.CreatePhase` | Módulo properties + permissão PropertyManage | 614 |
| 428 | POST | `/v1/property-developments/{id}/buildings` | `CreateBuilding` | `developmentsHandler.CreateBuilding` | Módulo properties + permissão PropertyManage | 615 |
| 429 | POST | `/v1/property-developments/{id}/floor-plans` | `CreateFloorPlan` | `developmentsHandler.CreateFloorPlan` | Módulo properties + permissão PropertyManage | 616 |
| 430 | POST | `/v1/property-developments/{id}/units/bulk` | `BulkCreateUnits` | `developmentsHandler.BulkCreateUnits` | Módulo properties + permissão PropertyManage | 617 |
| 431 | PATCH | `/v1/property-developments/{id}/units/{unitId}` | `UpdateUnit` | `developmentsHandler.UpdateUnit` | Módulo properties + permissão PropertyManage | 618 |
| 432 | POST | `/v1/property-developments/{id}/units/{unitId}/link-property` | `LinkUnitProperty` | `developmentsHandler.LinkUnitProperty` | Módulo properties + permissão PropertyManage | 619 |
| 433 | POST | `/v1/property-developments/{id}/units/{unitId}/promote-property` | `PromoteUnitProperty` | `developmentsHandler.PromoteUnitProperty` | Módulo properties + permissão PropertyManage | 620 |
| 434 | POST | `/v1/property-developments/{id}/units/{unitId}/unlink-property` | `UnlinkUnitProperty` | `developmentsHandler.UnlinkUnitProperty` | Módulo properties + permissão PropertyManage | 621 |
| 435 | PUT | `/v1/property-developments/{id}/units/{unitId}/price` | `UpdateUnitPrice` | `developmentsHandler.UpdateUnitPrice` | Módulo properties + permissão PropertyManage | 622 |
| 436 | POST | `/v1/property-developments/{id}/units/{unitId}/reservations` | `CreateReservation` | `developmentsHandler.CreateReservation` | Módulo properties + permissão PropertyManage | 623 |
| 437 | POST | `/v1/property-developments/{id}/reservations/{reservationId}/cancel` | `CancelReservation` | `developmentsHandler.CancelReservation` | Módulo properties + permissão PropertyManage | 624 |
| 438 | POST | `/v1/property-developments/{id}/reservations/{reservationId}/convert` | `ConvertReservation` | `developmentsHandler.ConvertReservation` | Módulo properties + permissão PropertyManage | 625 |
| 439 | POST | `/v1/property-developments/{id}/reservations/{reservationId}/extend` | `ExtendReservation` | `developmentsHandler.ExtendReservation` | Módulo properties + permissão PropertyManage | 626 |
| 440 | POST | `/v1/property-developments/{id}/price-tables/{priceTableId}/activate` | `ActivatePriceTable` | `developmentsHandler.ActivatePriceTable` | Módulo properties + permissão PropertyManage | 627 |

### Imóveis — 27

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 441 | GET | `/v1/properties` | `List` | `propertiesHandler.List` | Módulo properties + permissão PropertyView | 628 |
| 442 | GET | `/v1/properties/stats` | `Stats` | `propertiesHandler.Stats` | Módulo properties + permissão PropertyView | 629 |
| 443 | POST | `/v1/properties` | `Create` | `propertiesHandler.Create` | Módulo properties + permissão PropertyManage | 630 |
| 444 | GET | `/v1/properties/{id}` | `Show` | `propertiesHandler.Show` | Módulo properties + permissão PropertyView | 631 |
| 445 | GET | `/v1/properties/{id}/workspace` | `ShowWorkspace` | `propertiesHandler.ShowWorkspace` | Módulo properties + permissão PropertyView | 632 |
| 446 | GET | `/v1/properties/{id}/history` | `History` | `propertiesHandler.History` | Módulo properties + permissão PropertyView | 633 |
| 447 | GET | `/v1/properties/{id}/publications` | `Overview` | `publicationsHandler.Overview` | Módulo properties + permissão PropertyView | 634 |
| 448 | POST | `/v1/properties/{id}/publications/site/publish` | `Publish` | `publicationsHandler.Publish` | Módulos properties + site + permissão PropertyManage | 635 |
| 449 | POST | `/v1/properties/{id}/publications/site/unpublish` | `Unpublish` | `publicationsHandler.Unpublish` | Módulo properties + permissão PropertyManage | 636 |
| 450 | POST | `/v1/properties/{id}/publications/site/retry` | `Retry` | `publicationsHandler.Retry` | Módulo properties + permissão PropertyManage | 637 |
| 451 | POST | `/v1/properties/{id}/publications/grupo-olx/publish` | `PublishGrupoOLX` | `publicationsHandler.PublishGrupoOLX` | Módulos properties + portals + permissão PropertyManage | 638 |
| 452 | POST | `/v1/properties/{id}/publications/grupo-olx/unpublish` | `UnpublishGrupoOLX` | `publicationsHandler.UnpublishGrupoOLX` | Módulo properties + permissão PropertyManage | 639 |
| 453 | POST | `/v1/properties/{id}/publications/grupo-olx/retry` | `RetryGrupoOLX` | `publicationsHandler.RetryGrupoOLX` | Módulo properties + permissão PropertyManage | 640 |
| 454 | PUT | `/v1/properties/{id}/offers/{offerType}` | `UpsertOffer` | `propertiesHandler.UpsertOffer` | Módulo properties + permissão PropertyManage | 641 |
| 455 | POST | `/v1/properties/{id}/ownerships` | `CreateOwnership` | `propertiesHandler.CreateOwnership` | Módulo properties + permissão PropertyManage | 642 |
| 456 | PATCH | `/v1/properties/{id}/ownerships/{ownershipId}` | `UpdateOwnership` | `propertiesHandler.UpdateOwnership` | Módulo properties + permissão PropertyManage | 643 |
| 457 | POST | `/v1/properties/{id}/ownerships/{ownershipId}/end` | `EndOwnership` | `propertiesHandler.EndOwnership` | Módulo properties + permissão PropertyManage | 644 |
| 458 | POST | `/v1/properties/{id}/assets` | `CreateAsset` | `propertiesHandler.CreateAsset` | Módulo properties + permissão PropertyManage | 645 |
| 459 | POST | `/v1/properties/{id}/assets/upload-intents` | `CreateAssetUploadIntent` | `propertiesHandler.CreateAssetUploadIntent` | Módulo properties + permissão PropertyManage | 646 |
| 460 | PUT | `/v1/properties/{id}/assets/order` | `ReorderAssets` | `propertiesHandler.ReorderAssets` | Módulo properties + permissão PropertyManage | 647 |
| 461 | PATCH | `/v1/properties/{id}/assets/{assetId}` | `UpdateAsset` | `propertiesHandler.UpdateAsset` | Módulo properties + permissão PropertyManage | 648 |
| 462 | DELETE | `/v1/properties/{id}/assets/{assetId}` | `DeleteAsset` | `propertiesHandler.DeleteAsset` | Módulo properties + permissão PropertyManage | 649 |
| 463 | PUT | `/v1/properties/{id}/assets/{assetId}/primary` | `SetPrimaryAsset` | `propertiesHandler.SetPrimaryAsset` | Módulo properties + permissão PropertyManage | 650 |
| 464 | POST | `/v1/properties/{id}/keys` | `CreateKey` | `propertiesHandler.CreateKey` | Módulo properties + permissão PropertyManage | 651 |
| 465 | POST | `/v1/properties/{id}/keys/{keyId}/movements` | `MoveKey` | `propertiesHandler.MoveKey` | Módulo properties + permissão PropertyManage | 652 |
| 466 | PATCH | `/v1/properties/{id}` | `Update` | `propertiesHandler.Update` | Módulo properties + permissão PropertyManage | 653 |
| 467 | DELETE | `/v1/properties/{id}` | `Delete` | `propertiesHandler.Delete` | Módulo properties + permissão PropertyManage | 654 |

### Imagens dos imóveis — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 468 | POST | `/v1/property-images` | `UploadImage` | `propertiesHandler.UploadImage` | Módulo properties + permissão PropertyManage | 655 |

### Captadores de imóveis — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 469 | GET | `/v1/property-captors/{id}` | `ShowPropertyCaptor` | `propertiesHandler.ShowPropertyCaptor` | Módulo properties + permissão PropertyView | 656 |

### Informações públicas do imóvel — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 470 | GET | `/v1/property-site-info` | `ShowPropertySiteInfo` | `propertiesHandler.ShowPropertySiteInfo` | Módulo properties + permissão PropertyView | 657 |

### Resumos dos imóveis — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 471 | GET | `/v1/property-summaries` | `ListPropertySummaries` | `propertiesHandler.ListPropertySummaries` | Módulo properties + permissão PropertyView | 658 |

### Organizações dos usuários — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 472 | GET | `/v1/user-organizations` | `ListUserOrganizations` | `usersHandler.ListUserOrganizations` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 659 |

### Usuários — 5

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 473 | GET | `/v1/users` | `ListOrganizationUsers` | `usersHandler.ListOrganizationUsers` | Organização ativa | 660 |
| 474 | POST | `/v1/users` | `CreateOrganizationUser` | `usersHandler.CreateOrganizationUser` | Organização + permissão UsersManage | 661 |
| 475 | PATCH | `/v1/users/{id}` | `UpdateOrganizationUser` | `usersHandler.UpdateOrganizationUser` | Organização + permissão UsersManage | 662 |
| 476 | GET | `/v1/users/{id}/delete-impact` | `GetDeleteUserImpact` | `usersHandler.GetDeleteUserImpact` | Organização + permissão UsersManage | 663 |
| 477 | DELETE | `/v1/users/{id}` | `DeleteOrganizationUser` | `usersHandler.DeleteOrganizationUser` | Organização + permissão UsersManage | 664 |

### user-presence — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 478 | GET | `/v1/user-presence` | `List` | `presenceHandler.List` | Organização + permissão UsersPresenceView | 665 |

### Resumos dos usuários — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 479 | GET | `/v1/user-summaries` | `ListSummaries` | `usersHandler.ListSummaries` | Organização ativa | 666 |

### Equipes — 9

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 480 | GET | `/v1/teams` | `List` | `teamsHandler.List` | Organização + permissão TeamView | 667 |
| 481 | GET | `/v1/teams/{id}` | `Get` | `teamsHandler.Get` | Organização + permissão TeamView | 668 |
| 482 | GET | `/v1/teams/{id}/history` | `ListHistory` | `teamsHandler.ListHistory` | Organização + permissão TeamView | 669 |
| 483 | GET | `/v1/teams/{teamId}/distribution-stats` | `GetTeamDistributionStats` | `roundRobinHandler.GetTeamDistributionStats` | Organização + permissão TeamView | 670 |
| 484 | POST | `/v1/teams` | `Create` | `teamsHandler.Create` | Organização + permissão TeamManage | 671 |
| 485 | PATCH | `/v1/teams/{id}` | `Update` | `teamsHandler.Update` | Organização + permissão TeamManage | 672 |
| 486 | DELETE | `/v1/teams/{id}` | `Delete` | `teamsHandler.Delete` | Organização + permissão TeamManage | 673 |
| 487 | PATCH | `/v1/teams/{id}/status` | `UpdateStatus` | `teamsHandler.UpdateStatus` | Organização + permissão TeamManage | 674 |
| 488 | POST | `/v1/teams/logo` | `UploadLogo` | `teamsHandler.UploadLogo` | Organização + permissão TeamManage | 675 |

### Pipelines das equipes — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 489 | GET | `/v1/team-pipelines` | `ListTeamPipelines` | `teamsHandler.ListTeamPipelines` | Organização + permissão TeamView | 676 |
| 490 | POST | `/v1/team-pipelines` | `AssignPipelineToTeam` | `teamsHandler.AssignPipelineToTeam` | Organização + permissão PipelineManage | 677 |
| 491 | DELETE | `/v1/team-pipelines` | `RemovePipelineFromTeam` | `teamsHandler.RemovePipelineFromTeam` | Organização + permissão PipelineManage | 678 |

### Membros de equipe — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 492 | PATCH | `/v1/team-members/leader` | `SetTeamLeader` | `teamsHandler.SetTeamLeader` | Organização + permissão TeamManage | 679 |
| 495 | GET | `/v1/team-members/{id}/availability` | `ListTeamMemberAvailability` | `teamsHandler.ListTeamMemberAvailability` | Organização ativa | 682 |
| 496 | PUT | `/v1/team-members/{id}/availability` | `ReplaceAvailability` | `teamsHandler.ReplaceAvailability` | Organização ativa | 683 |

### Disponibilidade dos membros — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 493 | GET | `/v1/member-availability` | `ListMemberAvailability` | `teamsHandler.ListMemberAvailability` | Organização ativa | 680 |
| 494 | PATCH | `/v1/member-availability` | `UpsertAvailability` | `teamsHandler.UpsertAvailability` | Organização ativa | 681 |

### Tipos de imóveis — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 497 | GET | `/v1/property-types` | `ListPropertyTypes` | `propertiesHandler.ListPropertyTypes` | Módulo properties + permissão PropertyView | 684 |
| 498 | POST | `/v1/property-types` | `CreatePropertyType` | `propertiesHandler.CreatePropertyType` | Módulo properties + permissão PropertyManage | 685 |

### Características dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 499 | GET | `/v1/property-features` | `ListPropertyFeatures` | `propertiesHandler.ListPropertyFeatures` | Módulo properties + permissão PropertyView | 686 |
| 500 | POST | `/v1/property-features` | `CreatePropertyFeature` | `propertiesHandler.CreatePropertyFeature` | Módulo properties + permissão PropertyManage | 687 |
| 501 | POST | `/v1/property-features/seed-defaults` | `SeedPropertyFeatures` | `propertiesHandler.SeedPropertyFeatures` | Módulo properties + permissão PropertyManage | 688 |

### Proximidades dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 502 | GET | `/v1/property-proximities` | `ListPropertyProximities` | `propertiesHandler.ListPropertyProximities` | Módulo properties + permissão PropertyView | 689 |
| 503 | POST | `/v1/property-proximities` | `CreatePropertyProximity` | `propertiesHandler.CreatePropertyProximity` | Módulo properties + permissão PropertyManage | 690 |
| 504 | POST | `/v1/property-proximities/seed-defaults` | `SeedPropertyProximities` | `propertiesHandler.SeedPropertyProximities` | Módulo properties + permissão PropertyManage | 691 |

### Cidades dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 505 | GET | `/v1/property-cities` | `ListCities` | `propertiesHandler.ListCities` | Módulo properties + permissão PropertyView | 692 |
| 506 | POST | `/v1/property-cities` | `CreateCity` | `propertiesHandler.CreateCity` | Módulo properties + permissão PropertyManage | 693 |
| 507 | DELETE | `/v1/property-cities/{id}` | `DeleteCity` | `propertiesHandler.DeleteCity` | Módulo properties + permissão PropertyManage | 694 |

### Bairros dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 508 | GET | `/v1/property-neighborhoods` | `ListNeighborhoods` | `propertiesHandler.ListNeighborhoods` | Módulo properties + permissão PropertyView | 695 |
| 509 | POST | `/v1/property-neighborhoods` | `CreateNeighborhood` | `propertiesHandler.CreateNeighborhood` | Módulo properties + permissão PropertyManage | 696 |
| 510 | DELETE | `/v1/property-neighborhoods/{id}` | `DeleteNeighborhood` | `propertiesHandler.DeleteNeighborhood` | Módulo properties + permissão PropertyManage | 697 |

### Condomínios dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 511 | GET | `/v1/property-condominiums` | `ListCondominiums` | `propertiesHandler.ListCondominiums` | Módulo properties + permissão PropertyView | 698 |
| 512 | POST | `/v1/property-condominiums` | `CreateCondominium` | `propertiesHandler.CreateCondominium` | Módulo properties + permissão PropertyManage | 699 |
| 513 | DELETE | `/v1/property-condominiums/{id}` | `DeleteCondominium` | `propertiesHandler.DeleteCondominium` | Módulo properties + permissão PropertyManage | 700 |

### Proprietários dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 514 | GET | `/v1/property-owners` | `ListOwners` | `propertiesHandler.ListOwners` | Módulo properties + permissão PropertyView | 701 |
| 515 | POST | `/v1/property-owners` | `CreateOwner` | `propertiesHandler.CreateOwner` | Módulo properties + permissão PropertyManage | 702 |
| 516 | PATCH | `/v1/property-owners/{id}` | `UpdateOwner` | `propertiesHandler.UpdateOwner` | Módulo properties + permissão PropertyManage | 703 |

### Pipelines — 7

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 517 | GET | `/v1/pipelines` | `List` | `pipelinesHandler.List` | Organização ativa | 704 |
| 518 | POST | `/v1/pipelines` | `Create` | `pipelinesHandler.Create` | Organização + permissão PipelineManage | 705 |
| 519 | PATCH | `/v1/pipelines/{id}` | `Update` | `pipelinesHandler.Update` | Organização + permissão PipelineManage | 706 |
| 520 | DELETE | `/v1/pipelines/{id}` | `Delete` | `pipelinesHandler.Delete` | Organização + permissão PipelineManage | 707 |
| 522 | POST | `/v1/pipelines/{id}/stages` | `CreateStage` | `pipelinesHandler.CreateStage` | Organização + permissão PipelineManage | 709 |
| 523 | POST | `/v1/pipelines/{id}/stages/reorder` | `ReorderStages` | `pipelinesHandler.ReorderStages` | Organização + permissão PipelineManage | 710 |
| 524 | POST | `/v1/pipelines/{id}/round-robin` | `SetDefaultRoundRobin` | `pipelinesHandler.SetDefaultRoundRobin` | Organização + permissão PipelineManage | 711 |

### round-robin-whatsapp-sessions — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 527 | GET | `/v1/round-robin-whatsapp-sessions` | `ListWhatsAppSessionOptions` | `roundRobinHandler.ListWhatsAppSessionOptions` | Organização + permissão DistributionManage | 714 |

### round-robin-meta-forms — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 528 | GET | `/v1/round-robin-meta-forms` | `ListMetaFormOptions` | `roundRobinHandler.ListMetaFormOptions` | Organização + permissão DistributionManage | 715 |

### Filas de distribuição — 7

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 529 | GET | `/v1/round-robins` | `List` | `roundRobinHandler.List` | Organização + permissão DistributionManage | 716 |
| 530 | POST | `/v1/round-robins` | `Create` | `roundRobinHandler.Create` | Organização + permissão DistributionManage | 717 |
| 531 | PATCH | `/v1/round-robins/{id}` | `Update` | `roundRobinHandler.Update` | Organização + permissão DistributionManage | 718 |
| 532 | DELETE | `/v1/round-robins/{id}` | `Delete` | `roundRobinHandler.Delete` | Organização + permissão DistributionManage | 719 |
| 533 | GET | `/v1/round-robins/{id}/rules` | `ListRules` | `roundRobinHandler.ListRules` | Organização + permissão DistributionManage | 720 |
| 534 | POST | `/v1/round-robins/{id}/rules` | `CreateRule` | `roundRobinHandler.CreateRule` | Organização + permissão DistributionManage | 721 |
| 539 | POST | `/v1/round-robins/{id}/members` | `AddMember` | `roundRobinHandler.AddMember` | Organização + permissão DistributionManage | 726 |

### Regras de distribuição — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 535 | GET | `/v1/round-robin-rules` | `ListRules` | `roundRobinHandler.ListRules` | Organização + permissão DistributionManage | 722 |
| 536 | POST | `/v1/round-robin-rules` | `CreateRule` | `roundRobinHandler.CreateRule` | Organização + permissão DistributionManage | 723 |
| 537 | PATCH | `/v1/round-robin-rules/{id}` | `UpdateRule` | `roundRobinHandler.UpdateRule` | Organização + permissão DistributionManage | 724 |
| 538 | DELETE | `/v1/round-robin-rules/{id}` | `DeleteRule` | `roundRobinHandler.DeleteRule` | Organização + permissão DistributionManage | 725 |

### Membros da distribuição — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 540 | PATCH | `/v1/round-robin-members/{id}` | `UpdateMember` | `roundRobinHandler.UpdateMember` | Organização + permissão DistributionManage | 727 |
| 541 | DELETE | `/v1/round-robin-members/{id}` | `DeleteMember` | `roundRobinHandler.DeleteMember` | Organização + permissão DistributionManage | 728 |
