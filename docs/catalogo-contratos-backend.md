# Catálogo dos 472 contratos do backend

Gerado automaticamente a partir de `apps/api/internal/app/app.go`.

Cada contrato abaixo contém o método HTTP, a rota exata, a operação/handler responsável, a camada de acesso registrada e a linha de origem. A indicação “sem middleware na rota” não significa necessariamente acesso irrestrito: webhooks e rotas internas podem validar assinatura, segredo ou token dentro do próprio handler.

## Resumo

- Total: **472 contratos HTTP**.
- GET: **198**.
- POST: **160**.
- PUT: **16**.
- PATCH: **48**.
- DELETE: **50**.
- Grupos de rota: **80**.

## Índice por domínio

| Domínio | Prefixo | Contratos |
| --- | --- | ---: |
| WhatsApp | `whatsapp` | 47 |
| Superadmin | `admin` | 41 |
| Configurações | `settings` | 32 |
| APIs públicas | `public` | 25 |
| Integrações | `integrations` | 23 |
| Leads | `leads` | 19 |
| Analytics | `analytics` | 15 |
| Site | `site` | 15 |
| Inteligência artificial | `ai` | 13 |
| Gamificação | `gamification` | 12 |
| Agenda | `schedule` | 11 |
| Contratos financeiros | `contracts` | 11 |
| Central de atenção | `attention` | 10 |
| Automações | `automations` | 9 |
| Dashboard | `dashboard` | 9 |
| Financeiro | `financial` | 8 |
| Filas de distribuição | `round-robins` | 7 |
| Imóveis | `properties` | 7 |
| Pipelines | `pipelines` | 7 |
| DRE | `dre` | 6 |
| Equipes | `teams` | 6 |
| Notificações | `notifications` | 6 |
| Automações de etapa | `stage-automations` | 5 |
| Convites | `invitations` | 5 |
| Usuários | `users` | 5 |
| Webhooks | `webhooks` | 5 |
| Execuções de automação | `automation-executions` | 4 |
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
| Etapas | `stages` | 3 |
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
| Página inicial | `home` | 2 |
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
| Telemetria | `telemetry` | 1 |
| Visibilidade de leads | `lead-visibility` | 1 |
| WhatsApp interno | `internal-whatsapp` | 1 |

## Lista completa

### Saúde da aplicação — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 1 | GET | `/healthz` | `Health` | `healthHandler.Health` | Saúde pública | 301 |
| 2 | GET | `/readyz` | `Ready` | `healthHandler.Ready` | Saúde pública | 302 |

### WhatsApp interno — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 3 | POST | `/v1/internal/whatsapp/auto-reply` | `AutoReply` | `whatsappHandler.AutoReply` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 303 |

### Conta e organização atual — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 4 | GET | `/v1/me` | `Show` | `meHandler.Show` | Usuário autenticado | 304 |
| 5 | GET | `/v1/me/profile` | `ShowProfile` | `meHandler.ShowProfile` | Usuário autenticado | 305 |
| 6 | POST | `/v1/me/switch-organization` | `SwitchOrganization` | `meHandler.SwitchOrganization` | Usuário autenticado | 306 |

### Eventos em tempo real — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 7 | GET | `/v1/realtime/events` | `Events` | `realtimeHandler.Events` | Organização ativa | 307 |

### Telemetria — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 8 | POST | `/v1/telemetry/errors` | `CreateErrorEvent` | `telemetryHandler.CreateErrorEvent` | Usuário autenticado | 308 |

### Auditoria — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 9 | GET | `/v1/audit-logs` | `List` | `auditHandler.List` | Usuário autenticado | 309 |
| 10 | POST | `/v1/audit-logs` | `Create` | `auditHandler.Create` | Usuário autenticado | 310 |

### Analytics — 15

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 11 | GET | `/v1/analytics/meta-insights` | `MetaInsights` | `analyticsHandler.MetaInsights` | Organização + permissão DashboardCampaignsView | 311 |
| 12 | GET | `/v1/analytics/campaign-insights` | `CampaignInsights` | `analyticsHandler.CampaignInsights` | Organização + permissão DashboardCampaignsView | 312 |
| 13 | GET | `/v1/analytics/lead` | `LeadAnalytics` | `analyticsHandler.LeadAnalytics` | Módulo site + permissão DashboardSiteView | 313 |
| 14 | GET | `/v1/analytics/site-summary` | `SiteSummary` | `analyticsHandler.SiteSummary` | Módulo site + permissão DashboardSiteView | 314 |
| 15 | GET | `/v1/analytics/site-detailed` | `SiteDetailed` | `analyticsHandler.SiteDetailed` | Módulo site + permissão DashboardSiteView | 315 |
| 16 | GET | `/v1/analytics/enterprise-kpis` | `EnterpriseKPIs` | `analyticsHandler.EnterpriseKPIs` | Organização + permissão DashboardView | 316 |
| 17 | GET | `/v1/analytics/dre-executive` | `DREExecutive` | `analyticsHandler.DREExecutive` | Organização + permissão FinancialView | 317 |
| 18 | GET | `/v1/analytics/sla-summary` | `SlaSummary` | `analyticsHandler.SlaSummary` | Organização + permissão DashboardView | 318 |
| 19 | GET | `/v1/analytics/sla-performance-by-user` | `SlaPerformanceByUser` | `analyticsHandler.SlaPerformanceByUser` | Organização + permissão DashboardView | 319 |
| 20 | GET | `/v1/analytics/team-ranking` | `TeamRanking` | `analyticsHandler.TeamRanking` | Organização + permissão DashboardView | 320 |
| 21 | GET | `/v1/analytics/vgv-stats` | `VGVStats` | `analyticsHandler.VGVStats` | Organização + permissão DashboardView | 321 |
| 22 | GET | `/v1/analytics/vgv-by-broker` | `VGVByBroker` | `analyticsHandler.VGVByBroker` | Organização + permissão DashboardView | 322 |
| 23 | GET | `/v1/analytics/stage-vgv` | `StageVGV` | `analyticsHandler.StageVGV` | Organização + permissão DashboardView | 323 |
| 24 | GET | `/v1/analytics/leader-stats` | `LeaderStats` | `analyticsHandler.LeaderStats` | Organização + permissão DashboardView | 324 |
| 25 | GET | `/v1/analytics/team-leader-stats/{teamId}` | `TeamLeaderStats` | `analyticsHandler.TeamLeaderStats` | Organização + permissão DashboardView | 325 |

### Central de atenção — 10

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 26 | GET | `/v1/attention/settings` | `GetSettings` | `attentionHandler.GetSettings` | Organização + permissão AttentionView | 326 |
| 27 | PATCH | `/v1/attention/settings` | `UpdateSettings` | `attentionHandler.UpdateSettings` | Organização + permissão AttentionView | 327 |
| 28 | GET | `/v1/attention/policies` | `ListPolicies` | `attentionHandler.ListPolicies` | Organização + permissão AttentionView | 328 |
| 29 | POST | `/v1/attention/policies` | `CreatePolicy` | `attentionHandler.CreatePolicy` | Organização + permissão AttentionView | 329 |
| 30 | PATCH | `/v1/attention/policies/{id}` | `UpdatePolicy` | `attentionHandler.UpdatePolicy` | Organização + permissão AttentionView | 330 |
| 31 | GET | `/v1/attention/items` | `ListItems` | `attentionHandler.ListItems` | Organização + permissão AttentionView | 331 |
| 32 | GET | `/v1/attention/summary` | `Summary` | `attentionHandler.Summary` | Organização + permissão AttentionView | 332 |
| 33 | POST | `/v1/attention/items/{id}/acknowledge` | `AcknowledgeItem` | `attentionHandler.AcknowledgeItem` | Organização + permissão AttentionView | 333 |
| 34 | POST | `/v1/attention/items/{id}/snooze` | `SnoozeItem` | `attentionHandler.SnoozeItem` | Organização + permissão AttentionView | 334 |
| 35 | POST | `/v1/attention/items/{id}/resolve` | `ResolveItem` | `attentionHandler.ResolveItem` | Organização + permissão AttentionView | 335 |

### Superadmin — 41

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 36 | GET | `/v1/admin/error-events` | `ListErrorEvents` | `telemetryHandler.ListErrorEvents` | Usuário autenticado | 336 |
| 37 | POST | `/v1/admin/error-events/{id}/resolve` | `ResolveErrorEvent` | `telemetryHandler.ResolveErrorEvent` | Usuário autenticado | 337 |
| 96 | GET | `/v1/admin/organizations` | `ListOrganizations` | `adminHandler.ListOrganizations` | Usuário autenticado | 396 |
| 97 | POST | `/v1/admin/organizations` | `CreateOrganization` | `adminHandler.CreateOrganization` | Usuário autenticado | 397 |
| 98 | PATCH | `/v1/admin/organizations/{id}` | `UpdateOrganization` | `adminHandler.UpdateOrganization` | Usuário autenticado | 398 |
| 99 | DELETE | `/v1/admin/organizations/{id}` | `DeleteOrganization` | `adminHandler.DeleteOrganization` | Usuário autenticado | 399 |
| 100 | GET | `/v1/admin/organizations/{id}/modules` | `ListOrganizationModules` | `adminHandler.ListOrganizationModules` | Usuário autenticado | 400 |
| 101 | GET | `/v1/admin/organizations/{id}/payments` | `ListOrganizationPayments` | `adminHandler.ListOrganizationPayments` | Usuário autenticado | 401 |
| 102 | POST | `/v1/admin/organizations/{id}/access` | `UpdateOrganizationAccess` | `adminHandler.UpdateOrganizationAccess` | Usuário autenticado | 402 |
| 103 | GET | `/v1/admin/users` | `ListUsers` | `adminHandler.ListUsers` | Usuário autenticado | 403 |
| 104 | PATCH | `/v1/admin/users/{id}` | `UpdateUser` | `adminHandler.UpdateUser` | Usuário autenticado | 404 |
| 105 | DELETE | `/v1/admin/users/{id}` | `DeleteUser` | `adminHandler.DeleteUser` | Usuário autenticado | 405 |
| 106 | POST | `/v1/admin/users/{id}/reset-password` | `ResetUserPassword` | `adminHandler.ResetUserPassword` | Usuário autenticado | 406 |
| 115 | GET | `/v1/admin/home-publications` | `ListHomePublicationsAdmin` | `adminHandler.ListHomePublicationsAdmin` | Usuário autenticado | 415 |
| 116 | POST | `/v1/admin/home-publications` | `CreateHomePublicationAdmin` | `adminHandler.CreateHomePublicationAdmin` | Usuário autenticado | 416 |
| 117 | PUT | `/v1/admin/home-publications/order` | `ReorderHomePublicationsAdmin` | `adminHandler.ReorderHomePublicationsAdmin` | Usuário autenticado | 417 |
| 118 | PATCH | `/v1/admin/home-publications/{id}` | `UpdateHomePublicationAdmin` | `adminHandler.UpdateHomePublicationAdmin` | Usuário autenticado | 418 |
| 119 | DELETE | `/v1/admin/home-publications/{id}` | `DeleteHomePublicationAdmin` | `adminHandler.DeleteHomePublicationAdmin` | Usuário autenticado | 419 |
| 120 | POST | `/v1/admin/home-publications/{id}/image` | `UploadHomePublicationImageAdmin` | `adminHandler.UploadHomePublicationImageAdmin` | Usuário autenticado | 420 |
| 121 | DELETE | `/v1/admin/home-publications/{id}/image` | `DeleteHomePublicationImageAdmin` | `adminHandler.DeleteHomePublicationImageAdmin` | Usuário autenticado | 421 |
| 124 | GET | `/v1/admin/feature-requests` | `ListFeatureRequestsAdmin` | `adminHandler.ListFeatureRequestsAdmin` | Usuário autenticado | 424 |
| 125 | PATCH | `/v1/admin/feature-requests/{id}` | `RespondFeatureRequestAdmin` | `adminHandler.RespondFeatureRequestAdmin` | Usuário autenticado | 425 |
| 133 | GET | `/v1/admin/onboarding-requests` | `ListOnboardingRequestsAdmin` | `adminHandler.ListOnboardingRequestsAdmin` | Usuário autenticado | 433 |
| 134 | PATCH | `/v1/admin/onboarding-requests/{id}` | `UpdateOnboardingRequestAdmin` | `adminHandler.UpdateOnboardingRequestAdmin` | Usuário autenticado | 434 |
| 136 | POST | `/v1/admin/modules` | `UpdateModuleAccess` | `adminHandler.UpdateModuleAccess` | Usuário autenticado | 436 |
| 137 | GET | `/v1/admin/dashboard/overview` | `DashboardOverview` | `adminHandler.DashboardOverview` | Usuário autenticado | 437 |
| 138 | GET | `/v1/admin/dashboard/timeseries` | `DashboardTimeseries` | `adminHandler.DashboardTimeseries` | Usuário autenticado | 438 |
| 139 | GET | `/v1/admin/dashboard/pending` | `DashboardPending` | `adminHandler.DashboardPending` | Usuário autenticado | 439 |
| 140 | GET | `/v1/admin/dashboard/feed` | `DashboardFeed` | `adminHandler.DashboardFeed` | Usuário autenticado | 440 |
| 141 | GET | `/v1/admin/ai-agents` | `ListAgents` | `aiHandler.ListAgents` | Usuário autenticado | 441 |
| 142 | POST | `/v1/admin/ai-agents` | `CreateAgent` | `aiHandler.CreateAgent` | Usuário autenticado | 442 |
| 143 | PATCH | `/v1/admin/ai-agents/{id}` | `UpdateAgent` | `aiHandler.UpdateAgent` | Usuário autenticado | 443 |
| 144 | DELETE | `/v1/admin/ai-agents/{id}` | `DeleteAgent` | `aiHandler.DeleteAgent` | Usuário autenticado | 444 |
| 145 | PUT | `/v1/admin/organizations/{id}/ai-settings` | `AdminUpdateSettings` | `aiHandler.AdminUpdateSettings` | Usuário autenticado | 445 |
| 146 | GET | `/v1/admin/tables/{table}` | `ListTableRows` | `adminHandler.ListTableRows` | Usuário autenticado | 446 |
| 147 | GET | `/v1/admin/tables/{table}/count` | `CountTableRows` | `adminHandler.CountTableRows` | Usuário autenticado | 447 |
| 148 | POST | `/v1/admin/tables/{table}` | `CreateTableRow` | `adminHandler.CreateTableRow` | Usuário autenticado | 448 |
| 149 | PATCH | `/v1/admin/tables/{table}/{id}` | `UpdateTableRow` | `adminHandler.UpdateTableRow` | Usuário autenticado | 449 |
| 150 | DELETE | `/v1/admin/tables/{table}/{id}` | `DeleteTableRow` | `adminHandler.DeleteTableRow` | Usuário autenticado | 450 |
| 151 | GET | `/v1/admin/orphan-members` | `OrphanMemberStats` | `adminHandler.OrphanMemberStats` | Usuário autenticado | 451 |
| 152 | POST | `/v1/admin/orphan-members/cleanup` | `CleanupOrphanMembers` | `adminHandler.CleanupOrphanMembers` | Usuário autenticado | 452 |

### Gamificação — 12

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 38 | GET | `/v1/gamification/overview` | `Overview` | `gamificationHandler.Overview` | Módulo gamification + permissão GamificationView | 338 |
| 39 | GET | `/v1/gamification/ranking` | `Ranking` | `gamificationHandler.Ranking` | Módulo gamification + permissão GamificationView | 339 |
| 40 | GET | `/v1/gamification/events` | `Events` | `gamificationHandler.Events` | Módulo gamification + permissão GamificationView | 340 |
| 41 | GET | `/v1/gamification/admin` | `AdminSnapshot` | `gamificationHandler.AdminSnapshot` | Módulo gamification + permissão GamificationView | 341 |
| 42 | PUT | `/v1/gamification/rules/{actionType}` | `UpsertRule` | `gamificationHandler.UpsertRule` | Módulo gamification + permissão GamificationManage | 342 |
| 43 | PATCH | `/v1/gamification/participants/{userId}` | `SetParticipant` | `gamificationHandler.SetParticipant` | Módulo gamification + permissão GamificationManage | 343 |
| 44 | POST | `/v1/gamification/missions` | `CreateMission` | `gamificationHandler.CreateMission` | Módulo gamification + permissão GamificationManage | 344 |
| 45 | PATCH | `/v1/gamification/missions/{id}` | `UpdateMission` | `gamificationHandler.UpdateMission` | Módulo gamification + permissão GamificationManage | 345 |
| 46 | DELETE | `/v1/gamification/missions/{id}` | `DeleteMission` | `gamificationHandler.DeleteMission` | Módulo gamification + permissão GamificationManage | 346 |
| 47 | POST | `/v1/gamification/manual-entries` | `CreateManualEntry` | `gamificationHandler.CreateManualEntry` | Módulo gamification + permissão GamificationView | 347 |
| 48 | PATCH | `/v1/gamification/manual-entries/{id}` | `DecideManualEntry` | `gamificationHandler.DecideManualEntry` | Módulo gamification + permissão GamificationManage | 348 |
| 49 | POST | `/v1/gamification/seasons` | `ResetSeason` | `gamificationHandler.ResetSeason` | Módulo gamification + permissão GamificationManage | 349 |

### Modelos de cadência — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 50 | GET | `/v1/cadence-templates` | `ListTemplates` | `cadencesHandler.ListTemplates` | Organização ativa | 350 |

### Tarefas de cadência — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 51 | POST | `/v1/cadence-tasks` | `CreateTask` | `cadencesHandler.CreateTask` | Organização + permissão PipelineManage | 351 |
| 52 | PATCH | `/v1/cadence-tasks/{id}` | `UpdateTask` | `cadencesHandler.UpdateTask` | Organização + permissão PipelineManage | 352 |
| 53 | DELETE | `/v1/cadence-tasks/{id}` | `DeleteTask` | `cadencesHandler.DeleteTask` | Organização + permissão PipelineManage | 353 |

### Leads — 19

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 54 | POST | `/v1/leads/{id}/cadence` | `SwitchLeadCadence` | `cadencesHandler.SwitchLeadCadence` | Organização + permissão LeadOperate | 354 |
| 201 | POST | `/v1/leads/{id}/automation-executions/cancel` | `CancelLeadExecutions` | `automationsHandler.CancelLeadExecutions` | Módulo automations + permissão AutomationsManage | 501 |
| 381 | GET | `/v1/leads` | `List` | `leadsHandler.List` | Organização ativa | 681 |
| 382 | POST | `/v1/leads` | `Create` | `leadsHandler.Create` | Organização + permissão LeadCreate | 682 |
| 383 | GET | `/v1/leads/{id}/timeline` | `ListLeadTimeline` | `leadsHandler.ListLeadTimeline` | Organização ativa | 683 |
| 384 | GET | `/v1/leads/{id}/journey` | `ListLeadJourney` | `leadsHandler.ListLeadJourney` | Organização ativa | 684 |
| 385 | GET | `/v1/leads/{id}/history-raw` | `ShowLeadHistoryRaw` | `leadsHandler.ShowLeadHistoryRaw` | Organização ativa | 685 |
| 386 | GET | `/v1/leads/{id}/conversation-detail` | `ShowConversationDetail` | `leadsHandler.ShowConversationDetail` | Organização ativa | 686 |
| 387 | GET | `/v1/leads/{id}/sensitive-profile` | `ShowSensitiveProfile` | `leadsHandler.ShowSensitiveProfile` | Organização + permissão LeadOperate | 687 |
| 388 | GET | `/v1/leads/{id}` | `Show` | `leadsHandler.Show` | Organização ativa | 688 |
| 389 | PATCH | `/v1/leads/{id}` | `Update` | `leadsHandler.Update` | Organização + permissão LeadOperate | 689 |
| 390 | DELETE | `/v1/leads/{id}` | `Delete` | `leadsHandler.Delete` | Organização + permissão LeadDelete | 690 |
| 391 | POST | `/v1/leads/{id}/attachments` | `UploadLeadAttachment` | `leadsHandler.UploadLeadAttachment` | Organização + permissão LeadOperate | 691 |
| 392 | POST | `/v1/leads/{id}/first-response` | `RecordFirstResponse` | `leadsHandler.RecordFirstResponse` | Organização + permissão LeadOperate | 692 |
| 393 | POST | `/v1/leads/{id}/move-stage` | `MoveStage` | `leadsHandler.MoveStage` | Organização + permissão LeadOperate | 693 |
| 394 | POST | `/v1/leads/{id}/assign` | `Assign` | `leadsHandler.Assign` | Organização + permissão LeadOperate | 694 |
| 395 | POST | `/v1/leads/{id}/redistribute` | `RedistributeRoundRobin` | `leadsHandler.RedistributeRoundRobin` | Organização + permissão LeadOperate | 695 |
| 396 | POST | `/v1/leads/{id}/tags` | `AddTag` | `leadsHandler.AddTag` | Organização + permissão LeadOperate | 696 |
| 397 | DELETE | `/v1/leads/{id}/tags/{tagId}` | `RemoveTag` | `leadsHandler.RemoveTag` | Organização + permissão LeadOperate | 697 |

### Financeiro — 8

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 55 | GET | `/v1/financial/categories` | `ListCategories` | `financialHandler.ListCategories` | Organização + acesso financeiro | 355 |
| 56 | POST | `/v1/financial/categories` | `CreateCategory` | `financialHandler.CreateCategory` | Organização + acesso financeiro | 356 |
| 57 | GET | `/v1/financial/entries` | `ListEntries` | `financialHandler.ListEntries` | Organização + acesso financeiro | 357 |
| 58 | POST | `/v1/financial/entries` | `CreateEntry` | `financialHandler.CreateEntry` | Organização + acesso financeiro | 358 |
| 59 | PATCH | `/v1/financial/entries/{id}` | `UpdateEntry` | `financialHandler.UpdateEntry` | Organização + acesso financeiro | 359 |
| 60 | DELETE | `/v1/financial/entries/{id}` | `DeleteEntry` | `financialHandler.DeleteEntry` | Organização + acesso financeiro | 360 |
| 61 | POST | `/v1/financial/entries/{id}/pay` | `MarkEntryPaid` | `financialHandler.MarkEntryPaid` | Organização + acesso financeiro | 361 |
| 62 | GET | `/v1/financial/dashboard` | `Dashboard` | `financialHandler.Dashboard` | Organização + acesso financeiro | 362 |

### Contratos financeiros — 11

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 63 | GET | `/v1/contracts` | `ListContracts` | `financialHandler.ListContracts` | Organização + acesso financeiro | 363 |
| 64 | POST | `/v1/contracts` | `CreateContract` | `financialHandler.CreateContract` | Organização + acesso financeiro | 364 |
| 65 | GET | `/v1/contracts/{id}` | `ShowContract` | `financialHandler.ShowContract` | Organização + acesso financeiro | 365 |
| 66 | PATCH | `/v1/contracts/{id}` | `UpdateContract` | `financialHandler.UpdateContract` | Organização + acesso financeiro | 366 |
| 67 | DELETE | `/v1/contracts/{id}` | `DeleteContract` | `financialHandler.DeleteContract` | Organização + acesso financeiro | 367 |
| 68 | POST | `/v1/contracts/{id}/activate` | `ActivateContract` | `financialHandler.ActivateContract` | Organização + acesso financeiro | 368 |
| 69 | POST | `/v1/contracts/{id}/regenerate-commissions` | `RegenerateCommissions` | `financialHandler.RegenerateCommissions` | Organização + acesso financeiro | 369 |
| 70 | GET | `/v1/contracts/{id}/documents` | `ListContractDocuments` | `financialHandler.ListContractDocuments` | Organização + acesso financeiro | 370 |
| 71 | POST | `/v1/contracts/{id}/documents` | `UploadContractDocument` | `financialHandler.UploadContractDocument` | Organização + acesso financeiro | 371 |
| 72 | DELETE | `/v1/contracts/{id}/documents` | `DeleteContractDocument` | `financialHandler.DeleteContractDocument` | Organização + acesso financeiro | 372 |
| 73 | POST | `/v1/contracts/{id}/documents/signed-url` | `ContractDocumentSignedURL` | `financialHandler.ContractDocumentSignedURL` | Organização + acesso financeiro | 373 |

### Regras de comissão — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 74 | GET | `/v1/commission-rules` | `ListCommissionRules` | `financialHandler.ListCommissionRules` | Organização + acesso financeiro | 374 |
| 75 | POST | `/v1/commission-rules` | `CreateCommissionRule` | `financialHandler.CreateCommissionRule` | Organização + acesso financeiro | 375 |
| 76 | PATCH | `/v1/commission-rules/{id}` | `UpdateCommissionRule` | `financialHandler.UpdateCommissionRule` | Organização + acesso financeiro | 376 |
| 77 | DELETE | `/v1/commission-rules/{id}` | `DeleteCommissionRule` | `financialHandler.DeleteCommissionRule` | Organização + acesso financeiro | 377 |

### Comissões — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 78 | GET | `/v1/commissions` | `ListCommissions` | `financialHandler.ListCommissions` | Organização + acesso financeiro | 378 |
| 79 | POST | `/v1/commissions/{id}/{action}` | `CommissionStatus` | `financialHandler.CommissionStatus` | Organização + acesso financeiro | 379 |
| 80 | GET | `/v1/commissions/by-broker` | `CommissionsByBroker` | `financialHandler.CommissionsByBroker` | Organização + acesso financeiro | 380 |

### DRE — 6

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 81 | GET | `/v1/dre/input` | `DREInput` | `financialHandler.DREInput` | Organização + acesso financeiro | 381 |
| 82 | GET | `/v1/dre/groups` | `DREGroups` | `financialHandler.DREGroups` | Organização + acesso financeiro | 382 |
| 83 | GET | `/v1/dre/mappings` | `DREMappings` | `financialHandler.DREMappings` | Organização + acesso financeiro | 383 |
| 84 | POST | `/v1/dre/mappings` | `CreateDREMapping` | `financialHandler.CreateDREMapping` | Organização + acesso financeiro | 384 |
| 85 | DELETE | `/v1/dre/mappings/{id}` | `DeleteDREMapping` | `financialHandler.DeleteDREMapping` | Organização + acesso financeiro | 385 |
| 86 | POST | `/v1/dre/groups/initialize` | `InitializeDREGroups` | `financialHandler.InitializeDREGroups` | Organização + acesso financeiro | 386 |

### Automações de etapa — 5

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 87 | GET | `/v1/stage-automations` | `ListAutomations` | `stageConfigHandler.ListAutomations` | Módulo automations + permissão AutomationsView | 387 |
| 88 | POST | `/v1/stage-automations` | `CreateAutomation` | `stageConfigHandler.CreateAutomation` | Módulo automations + permissão AutomationsManage | 388 |
| 89 | PATCH | `/v1/stage-automations/{id}` | `UpdateAutomation` | `stageConfigHandler.UpdateAutomation` | Módulo automations + permissão AutomationsManage | 389 |
| 90 | DELETE | `/v1/stage-automations/{id}` | `DeleteAutomation` | `stageConfigHandler.DeleteAutomation` | Módulo automations + permissão AutomationsManage | 390 |
| 91 | PATCH | `/v1/stage-automations/{id}/status` | `ToggleAutomation` | `stageConfigHandler.ToggleAutomation` | Módulo automations + permissão AutomationsManage | 391 |

### Configurações operacionais de etapa — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 92 | GET | `/v1/stage-operational-configs` | `ListOperationalConfigs` | `stageConfigHandler.ListOperationalConfigs` | Organização + permissão PipelineManage | 392 |
| 93 | PUT | `/v1/stage-operational-configs` | `UpsertOperationalConfig` | `stageConfigHandler.UpsertOperationalConfig` | Organização + permissão PipelineManage | 393 |

### SLA do pipeline — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 94 | GET | `/v1/pipeline-sla-settings` | `ListPipelineSLASettings` | `stageConfigHandler.ListPipelineSLASettings` | Organização + permissão PipelineManage | 394 |
| 95 | PUT | `/v1/pipeline-sla-settings` | `UpsertPipelineSLASettings` | `stageConfigHandler.UpsertPipelineSLASettings` | Organização + permissão PipelineManage | 395 |

### Comunicados — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 107 | GET | `/v1/announcements/active` | `ListActiveAnnouncements` | `adminHandler.ListActiveAnnouncements` | Usuário autenticado | 407 |

### Página inicial — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 108 | GET | `/v1/home/publications` | `ListHomePublications` | `adminHandler.ListHomePublications` | Usuário autenticado | 408 |
| 109 | POST | `/v1/home/assistant` | `AnswerHomeAssistant` | `adminHandler.AnswerHomeAssistant` | Usuário autenticado | 409 |

### Central de ajuda — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 110 | GET | `/v1/help/articles` | `ListArticles` | `helpHandler.ListArticles` | Usuário autenticado | 410 |
| 111 | GET | `/v1/help/articles/{slug}` | `ShowArticle` | `helpHandler.ShowArticle` | Usuário autenticado | 411 |
| 112 | POST | `/v1/help/search` | `SearchArticles` | `helpHandler.SearchArticles` | Usuário autenticado | 412 |

### APIs públicas — 25

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 113 | GET | `/v1/public/help/articles` | `ListPublicArticles` | `helpHandler.ListPublicArticles` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 413 |
| 114 | GET | `/v1/public/help/articles/{slug}` | `ShowPublicArticle` | `helpHandler.ShowPublicArticle` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 414 |
| 210 | POST | `/v1/public/webhooks/generic` | `ReceiveLead` | `webhooksHandler.ReceiveLead` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 510 |
| 211 | GET | `/v1/public/integrations/meta/webhook` | `Webhook` | `metaHandler.Webhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 511 |
| 212 | POST | `/v1/public/integrations/meta/webhook` | `Webhook` | `metaHandler.Webhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 512 |
| 213 | GET | `/v1/public/integrations/portals/grupo-olx/feed/{token}` | `GrupoOLXFeed` | `portalsHandler.GrupoOLXFeed` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 513 |
| 214 | POST | `/v1/public/integrations/portals/grupo-olx/leads/{token}` | `GrupoOLXLeadWebhook` | `portalsHandler.GrupoOLXLeadWebhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 514 |
| 215 | POST | `/v1/public/integrations/portals/grupo-olx/import-reports/{token}` | `GrupoOLXImportReportWebhook` | `portalsHandler.GrupoOLXImportReportWebhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 515 |
| 216 | GET | `/v1/public/onboarding/plans` | `PublicSubscriptionPlans` | `adminHandler.PublicSubscriptionPlans` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 516 |
| 217 | POST | `/v1/public/onboarding/signup` | `PublicOnboardingSignup` | `adminHandler.PublicOnboardingSignup` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 517 |
| 218 | POST | `/v1/public/onboarding/checkout-plan` | `PublicCheckoutPlan` | `adminHandler.PublicCheckoutPlan` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 518 |
| 219 | GET | `/v1/public/system-settings` | `PublicSystemSettings` | `settingsHandler.PublicSystemSettings` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 519 |
| 220 | GET | `/v1/public/site/resolve` | `ResolvePublicSite` | `siteHandler.ResolvePublicSite` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 520 |
| 221 | GET | `/v1/public/site/data` | `PublicSiteData` | `siteHandler.PublicSiteData` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 521 |
| 222 | GET | `/v1/public/site/menu-items` | `ListPublicMenuItems` | `siteHandler.ListPublicMenuItems` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 522 |
| 223 | GET | `/v1/public/site/search-filters` | `ListPublicSearchFilters` | `siteHandler.ListPublicSearchFilters` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 523 |
| 224 | POST | `/v1/public/site/contact` | `SubmitPublicContact` | `siteHandler.SubmitPublicContact` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 524 |
| 225 | POST | `/v1/public/tracking/events` | `TrackPublicEvent` | `siteHandler.TrackPublicEvent` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 525 |
| 226 | GET | `/v1/public/payments/checkout-info` | `PublicCheckoutInfo` | `integrationsHandler.PublicCheckoutInfo` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 526 |
| 227 | GET | `/v1/public/payments/status` | `PublicPaymentStatus` | `integrationsHandler.PublicPaymentStatus` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 527 |
| 228 | POST | `/v1/public/payments/charge` | `PublicCreateCharge` | `integrationsHandler.PublicCreateCharge` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 528 |
| 229 | POST | `/v1/public/payments/cancel` | `PublicCancelPayment` | `integrationsHandler.PublicCancelPayment` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 529 |
| 230 | GET | `/v1/public/invitations/{token}` | `ShowInvitationByToken` | `adminHandler.ShowInvitationByToken` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 530 |
| 231 | POST | `/v1/public/invitations/{token}/accept` | `AcceptInvitationPublic` | `adminHandler.AcceptInvitationPublic` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 531 |
| 260 | GET | `/v1/public/push-config` | `PublicPushConfig` | `settingsHandler.PublicPushConfig` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 560 |

### Solicitações de recursos — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 122 | GET | `/v1/feature-requests/mine` | `ListMyFeatureRequests` | `adminHandler.ListMyFeatureRequests` | Usuário autenticado | 422 |
| 123 | POST | `/v1/feature-requests` | `CreateFeatureRequest` | `adminHandler.CreateFeatureRequest` | Organização ativa | 423 |

### Convites — 5

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 126 | GET | `/v1/invitations` | `ListInvitations` | `adminHandler.ListInvitations` | Usuário autenticado | 426 |
| 127 | POST | `/v1/invitations` | `CreateInvitation` | `adminHandler.CreateInvitation` | Organização + permissão UsersManage | 427 |
| 128 | POST | `/v1/invitations/{id}/resend` | `ResendInvitation` | `adminHandler.ResendInvitation` | Organização + permissão UsersManage | 428 |
| 129 | DELETE | `/v1/invitations/{id}` | `DeleteInvitation` | `adminHandler.DeleteInvitation` | Organização + permissão UsersManage | 429 |
| 130 | POST | `/v1/invitations/{token}/accept` | `AcceptInvitationAuthenticated` | `adminHandler.AcceptInvitationAuthenticated` | Usuário autenticado | 430 |

### Solicitações de onboarding — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 131 | GET | `/v1/onboarding-requests/mine` | `ShowMyOnboardingRequest` | `adminHandler.ShowMyOnboardingRequest` | Usuário autenticado | 431 |
| 132 | POST | `/v1/onboarding-requests` | `CreateOnboardingRequest` | `adminHandler.CreateOnboardingRequest` | Usuário autenticado | 432 |

### Planos de assinatura — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 135 | GET | `/v1/subscription-plans/active` | `ListActiveSubscriptionPlans` | `adminHandler.ListActiveSubscriptionPlans` | Usuário autenticado | 435 |

### Dashboard — 9

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 153 | GET | `/v1/dashboard/stats` | `ShowDashboardStats` | `leadsHandler.ShowDashboardStats` | Organização + permissão DashboardView | 453 |
| 154 | GET | `/v1/dashboard/funnel` | `ShowDashboardFunnel` | `leadsHandler.ShowDashboardFunnel` | Organização + permissão DashboardView | 454 |
| 155 | GET | `/v1/dashboard/sources` | `ShowDashboardSources` | `leadsHandler.ShowDashboardSources` | Organização + permissão DashboardView | 455 |
| 156 | GET | `/v1/dashboard/top-brokers` | `ShowDashboardTopBrokers` | `leadsHandler.ShowDashboardTopBrokers` | Organização + permissão DashboardView | 456 |
| 157 | GET | `/v1/dashboard/upcoming-tasks` | `ListDashboardUpcomingTasks` | `leadsHandler.ListDashboardUpcomingTasks` | Organização + permissão DashboardView | 457 |
| 158 | GET | `/v1/dashboard/deals-evolution` | `ShowDashboardDealsEvolution` | `leadsHandler.ShowDashboardDealsEvolution` | Organização + permissão DashboardView | 458 |
| 159 | GET | `/v1/dashboard/extra-counts` | `ShowDashboardExtraCounts` | `leadsHandler.ShowDashboardExtraCounts` | Organização + permissão DashboardView | 459 |
| 160 | GET | `/v1/dashboard/recent-activities` | `ListDashboardRecentActivities` | `leadsHandler.ListDashboardRecentActivities` | Organização + permissão DashboardView | 460 |
| 161 | GET | `/v1/dashboard/team-lead-ids` | `ListDashboardTeamLeadIDs` | `leadsHandler.ListDashboardTeamLeadIDs` | Organização + permissão DashboardView | 461 |

### Inteligência artificial — 13

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 162 | GET | `/v1/ai/settings` | `ShowSettings` | `aiHandler.ShowSettings` | Organização + permissão SettingsAI | 462 |
| 163 | PUT | `/v1/ai/settings` | `UpdateSettings` | `aiHandler.UpdateSettings` | Organização + permissão SettingsAI | 463 |
| 164 | GET | `/v1/ai/agents` | `ListOrganizationAgents` | `aiHandler.ListOrganizationAgents` | Organização + permissão SettingsAI | 464 |
| 165 | POST | `/v1/ai/agents` | `CreateOrganizationAgent` | `aiHandler.CreateOrganizationAgent` | Organização + permissão SettingsAI | 465 |
| 166 | PATCH | `/v1/ai/agents/{id}` | `UpdateOrganizationAgent` | `aiHandler.UpdateOrganizationAgent` | Organização + permissão SettingsAI | 466 |
| 167 | DELETE | `/v1/ai/agents/{id}` | `DeleteOrganizationAgent` | `aiHandler.DeleteOrganizationAgent` | Organização + permissão SettingsAI | 467 |
| 168 | GET | `/v1/ai/routing-rules` | `ListRoutingRules` | `aiHandler.ListRoutingRules` | Organização + permissão SettingsAI | 468 |
| 169 | POST | `/v1/ai/routing-rules` | `CreateRoutingRule` | `aiHandler.CreateRoutingRule` | Organização + permissão SettingsAI | 469 |
| 170 | PATCH | `/v1/ai/routing-rules/{id}` | `UpdateRoutingRule` | `aiHandler.UpdateRoutingRule` | Organização + permissão SettingsAI | 470 |
| 171 | DELETE | `/v1/ai/routing-rules/{id}` | `DeleteRoutingRule` | `aiHandler.DeleteRoutingRule` | Organização + permissão SettingsAI | 471 |
| 172 | GET | `/v1/ai/metrics` | `Metrics` | `aiHandler.Metrics` | Organização + permissão SettingsAI | 472 |
| 173 | GET | `/v1/ai/events` | `ListEvents` | `aiHandler.ListEvents` | Organização + permissão SettingsAI | 473 |
| 174 | POST | `/v1/ai/run` | `Run` | `aiHandler.Run` | Organização + permissão SettingsAI | 474 |

### Agenda — 11

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 175 | GET | `/v1/schedule/capabilities` | `ShowCapabilities` | `scheduleHandler.ShowCapabilities` | Organização + permissão ScheduleView | 475 |
| 176 | GET | `/v1/schedule/events` | `ListEvents` | `scheduleHandler.ListEvents` | Organização + permissão ScheduleView | 476 |
| 177 | POST | `/v1/schedule/events` | `CreateEvent` | `scheduleHandler.CreateEvent` | Organização + permissão ScheduleManage | 477 |
| 178 | PATCH | `/v1/schedule/events/{id}` | `UpdateEvent` | `scheduleHandler.UpdateEvent` | Organização + permissão ScheduleManage | 478 |
| 179 | DELETE | `/v1/schedule/events/{id}` | `DeleteEvent` | `scheduleHandler.DeleteEvent` | Organização + permissão ScheduleManage | 479 |
| 180 | POST | `/v1/schedule/events/{id}/complete` | `CompleteEvent` | `scheduleHandler.CompleteEvent` | Organização + permissão ScheduleManage | 480 |
| 181 | GET | `/v1/schedule/events/{id}/comments` | `ListComments` | `scheduleHandler.ListComments` | Organização + permissão ScheduleView | 481 |
| 182 | POST | `/v1/schedule/events/{id}/comments` | `AddComment` | `scheduleHandler.AddComment` | Organização + permissão ScheduleManage | 482 |
| 183 | GET | `/v1/schedule/events/{id}/assignees` | `ListAssignees` | `scheduleHandler.ListAssignees` | Organização + permissão ScheduleView | 483 |
| 184 | POST | `/v1/schedule/events/{id}/assignees` | `AddAssignee` | `scheduleHandler.AddAssignee` | Organização + permissão ScheduleManage | 484 |
| 185 | DELETE | `/v1/schedule/events/{id}/assignees/{userId}` | `RemoveAssignee` | `scheduleHandler.RemoveAssignee` | Organização + permissão ScheduleManage | 485 |

### Automações — 9

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 186 | GET | `/v1/automations` | `List` | `automationsHandler.List` | Módulo automations + permissão AutomationsView | 486 |
| 187 | POST | `/v1/automations` | `Create` | `automationsHandler.Create` | Módulo automations + permissão AutomationsManage | 487 |
| 188 | GET | `/v1/automations/{id}` | `Show` | `automationsHandler.Show` | Módulo automations + permissão AutomationsView | 488 |
| 189 | PATCH | `/v1/automations/{id}` | `Update` | `automationsHandler.Update` | Módulo automations + permissão AutomationsManage | 489 |
| 190 | DELETE | `/v1/automations/{id}` | `Delete` | `automationsHandler.Delete` | Módulo automations + permissão AutomationsManage | 490 |
| 191 | POST | `/v1/automations/{id}/duplicate` | `Duplicate` | `automationsHandler.Duplicate` | Módulo automations + permissão AutomationsManage | 491 |
| 192 | PUT | `/v1/automations/{id}/flow` | `SaveFlow` | `automationsHandler.SaveFlow` | Módulo automations + permissão AutomationsManage | 492 |
| 193 | POST | `/v1/automations/{id}/start` | `Start` | `automationsHandler.Start` | Módulo automations + permissão AutomationsManage | 493 |
| 202 | POST | `/v1/automations/{id}/executions/cancel` | `CancelAutomationExecutions` | `automationsHandler.CancelAutomationExecutions` | Módulo automations + permissão AutomationsManage | 502 |

### Modelos de automação — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 194 | GET | `/v1/automation-templates` | `ListTemplates` | `automationsHandler.ListTemplates` | Módulo automations + permissão AutomationsView | 494 |
| 195 | POST | `/v1/automation-templates` | `CreateTemplate` | `automationsHandler.CreateTemplate` | Módulo automations + permissão AutomationsManage | 495 |
| 196 | DELETE | `/v1/automation-templates/{id}` | `DeleteTemplate` | `automationsHandler.DeleteTemplate` | Módulo automations + permissão AutomationsManage | 496 |

### Execuções de automação — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 197 | GET | `/v1/automation-executions` | `ListExecutions` | `automationsHandler.ListExecutions` | Módulo automations + permissão AutomationsView | 497 |
| 198 | GET | `/v1/automation-executions/summary` | `ListExecutionSummaries` | `automationsHandler.ListExecutionSummaries` | Módulo automations + permissão AutomationsView | 498 |
| 199 | GET | `/v1/automation-executions/{id}/steps` | `ListExecutionSteps` | `automationsHandler.ListExecutionSteps` | Módulo automations + permissão AutomationsView | 499 |
| 200 | POST | `/v1/automation-executions/{id}/cancel` | `CancelExecution` | `automationsHandler.CancelExecution` | Módulo automations + permissão AutomationsManage | 500 |

### Runtime de automação — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 203 | GET | `/v1/automation-runtime/issues` | `ListRuntimeIssues` | `automationsHandler.ListRuntimeIssues` | Módulo automations + permissão AutomationsView | 503 |
| 204 | POST | `/v1/automation-runtime/issues/{kind}/{id}/retry` | `RetryRuntimeIssue` | `automationsHandler.RetryRuntimeIssue` | Módulo automations + permissão AutomationsManage | 504 |

### Mídias de automação — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 205 | GET | `/v1/automation-media` | `ListMedia` | `automationsHandler.ListMedia` | Módulo automations + permissão AutomationsView | 505 |
| 206 | POST | `/v1/automation-media` | `UploadMedia` | `automationsHandler.UploadMedia` | Módulo automations + permissão AutomationsManage | 506 |
| 207 | DELETE | `/v1/automation-media` | `DeleteMedia` | `automationsHandler.DeleteMedia` | Módulo automations + permissão AutomationsManage | 507 |

### WhatsApp — 47

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 208 | GET | `/v1/whatsapp/webhook/evolution-go` | `EvolutionGoWebhook` | `whatsappHandler.EvolutionGoWebhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 508 |
| 209 | POST | `/v1/whatsapp/webhook/evolution-go` | `EvolutionGoWebhook` | `whatsappHandler.EvolutionGoWebhook` | Sem middleware na rota; o handler pode validar segredo, assinatura ou token | 509 |
| 308 | GET | `/v1/whatsapp/message-templates` | `ListMessageTemplates` | `whatsappHandler.ListMessageTemplates` | Organização + permissão WhatsAppView | 608 |
| 309 | POST | `/v1/whatsapp/message-templates` | `CreateMessageTemplate` | `whatsappHandler.CreateMessageTemplate` | Organização + permissão WhatsAppOperate | 609 |
| 310 | PATCH | `/v1/whatsapp/message-templates/{id}` | `UpdateMessageTemplate` | `whatsappHandler.UpdateMessageTemplate` | Organização + permissão WhatsAppOperate | 610 |
| 311 | DELETE | `/v1/whatsapp/message-templates/{id}` | `DeleteMessageTemplate` | `whatsappHandler.DeleteMessageTemplate` | Organização + permissão WhatsAppOperate | 611 |
| 312 | GET | `/v1/whatsapp/sessions` | `ListSessions` | `whatsappHandler.ListSessions` | Organização + permissão WhatsAppView | 612 |
| 313 | POST | `/v1/whatsapp/sessions` | `CreateSession` | `whatsappHandler.CreateSession` | Organização + permissão WhatsAppManage | 613 |
| 314 | GET | `/v1/whatsapp/sessions/{id}` | `ShowSession` | `whatsappHandler.ShowSession` | Organização + permissão WhatsAppView | 614 |
| 315 | DELETE | `/v1/whatsapp/sessions/{id}` | `DeleteSession` | `whatsappHandler.DeleteSession` | Organização + permissão WhatsAppManage | 615 |
| 316 | POST | `/v1/whatsapp/sessions/{id}/qr` | `GetQRCode` | `whatsappHandler.GetQRCode` | Organização + permissão WhatsAppManage | 616 |
| 317 | POST | `/v1/whatsapp/sessions/{id}/status` | `GetConnectionStatus` | `whatsappHandler.GetConnectionStatus` | Organização + permissão WhatsAppManage | 617 |
| 318 | POST | `/v1/whatsapp/sessions/{id}/recreate` | `RecreateSession` | `whatsappHandler.RecreateSession` | Organização + permissão WhatsAppManage | 618 |
| 319 | POST | `/v1/whatsapp/sessions/{id}/logout` | `LogoutSession` | `whatsappHandler.LogoutSession` | Organização + permissão WhatsAppManage | 619 |
| 320 | POST | `/v1/whatsapp/sessions/{id}/notification-session` | `ToggleNotificationSession` | `whatsappHandler.ToggleNotificationSession` | Organização + permissão WhatsAppManage | 620 |
| 321 | POST | `/v1/whatsapp/sessions/{id}/ai-auto-reply` | `ToggleAutoReplySession` | `whatsappHandler.ToggleAutoReplySession` | Organização + permissão WhatsAppManage | 621 |
| 322 | GET | `/v1/whatsapp/sessions/{id}/access` | `ListSessionAccess` | `whatsappHandler.ListSessionAccess` | Organização + permissão WhatsAppManage | 622 |
| 323 | POST | `/v1/whatsapp/sessions/{id}/access` | `GrantSessionAccess` | `whatsappHandler.GrantSessionAccess` | Organização + permissão WhatsAppManage | 623 |
| 324 | DELETE | `/v1/whatsapp/sessions/{id}/access/{userId}` | `RevokeSessionAccess` | `whatsappHandler.RevokeSessionAccess` | Organização + permissão WhatsAppManage | 624 |
| 325 | GET | `/v1/whatsapp/sessions/{id}/labels` | `ListLabels` | `whatsappHandler.ListLabels` | Organização + permissão WhatsAppView | 625 |
| 326 | POST | `/v1/whatsapp/sessions/{id}/labels/sync` | `SyncLabels` | `whatsappHandler.SyncLabels` | Organização + permissão WhatsAppOperate | 626 |
| 327 | POST | `/v1/whatsapp/sessions/{id}/labels/assign` | `AssignLabel` | `whatsappHandler.AssignLabel` | Organização + permissão WhatsAppOperate | 627 |
| 328 | GET | `/v1/whatsapp/sessions/{id}/groups` | `ListGroups` | `whatsappHandler.ListGroups` | Organização + permissão WhatsAppView | 628 |
| 329 | POST | `/v1/whatsapp/sessions/{id}/groups/sync` | `SyncGroups` | `whatsappHandler.SyncGroups` | Organização + permissão WhatsAppOperate | 629 |
| 330 | POST | `/v1/whatsapp/sessions/{id}/groups/info` | `GroupInfo` | `whatsappHandler.GroupInfo` | Organização + permissão WhatsAppOperate | 630 |
| 331 | POST | `/v1/whatsapp/sessions/{id}/groups/invite-link` | `GroupInviteLink` | `whatsappHandler.GroupInviteLink` | Organização + permissão WhatsAppOperate | 631 |
| 332 | POST | `/v1/whatsapp/sessions/{id}/groups/update` | `UpdateGroup` | `whatsappHandler.UpdateGroup` | Organização + permissão WhatsAppOperate | 632 |
| 333 | POST | `/v1/whatsapp/sessions/{id}/contacts/check` | `CheckNumbers` | `whatsappHandler.CheckNumbers` | Organização + permissão WhatsAppOperate | 633 |
| 334 | POST | `/v1/whatsapp/sessions/{id}/contacts/avatar` | `FetchAvatar` | `whatsappHandler.FetchAvatar` | Organização + permissão WhatsAppOperate | 634 |
| 335 | POST | `/v1/whatsapp/sessions/{id}/contacts/sync` | `SyncContactsAvatars` | `whatsappHandler.SyncContactsAvatars` | Organização + permissão WhatsAppOperate | 635 |
| 336 | POST | `/v1/whatsapp/sessions/{id}/history-sync` | `HistorySync` | `whatsappHandler.HistorySync` | Organização + permissão WhatsAppOperate | 636 |
| 337 | POST | `/v1/whatsapp/provider-action` | `ProviderAction` | `whatsappHandler.ProviderAction` | Organização + permissão WhatsAppManage | 637 |
| 338 | GET | `/v1/whatsapp/conversations` | `ListConversations` | `whatsappHandler.ListConversations` | Organização + permissão WhatsAppView | 638 |
| 339 | POST | `/v1/whatsapp/conversations/start` | `StartConversation` | `whatsappHandler.StartConversation` | Organização + permissão WhatsAppOperate | 639 |
| 340 | GET | `/v1/whatsapp/conversations/find` | `FindConversation` | `whatsappHandler.FindConversation` | Organização + permissão WhatsAppView | 640 |
| 341 | GET | `/v1/whatsapp/history` | `HistoryAccess` | `whatsappHandler.HistoryAccess` | Organização + permissão WhatsAppView | 641 |
| 342 | GET | `/v1/whatsapp/conversations/{id}` | `ShowConversation` | `whatsappHandler.ShowConversation` | Organização + permissão WhatsAppView | 642 |
| 343 | GET | `/v1/whatsapp/conversations/{id}/messages` | `ListMessages` | `whatsappHandler.ListMessages` | Organização + permissão WhatsAppView | 643 |
| 344 | POST | `/v1/whatsapp/conversations/{id}/send-message` | `SendMessage` | `whatsappHandler.SendMessage` | Organização + permissão WhatsAppOperate | 644 |
| 345 | POST | `/v1/whatsapp/conversations/{id}/messages/{messageId}/reaction` | `ReactToMessage` | `whatsappHandler.ReactToMessage` | Organização + permissão WhatsAppOperate | 645 |
| 346 | POST | `/v1/whatsapp/conversations/{id}/mark-read` | `MarkConversationAsRead` | `whatsappHandler.MarkConversationAsRead` | Organização + permissão WhatsAppOperate | 646 |
| 347 | POST | `/v1/whatsapp/conversations/{id}/mark-seen` | `MarkAsSeenOnWhatsApp` | `whatsappHandler.MarkAsSeenOnWhatsApp` | Organização + permissão WhatsAppOperate | 647 |
| 348 | POST | `/v1/whatsapp/conversations/{id}/archive` | `ArchiveConversation` | `whatsappHandler.ArchiveConversation` | Organização + permissão WhatsAppOperate | 648 |
| 349 | DELETE | `/v1/whatsapp/conversations/{id}` | `DeleteConversation` | `whatsappHandler.DeleteConversation` | Organização + permissão WhatsAppOperate | 649 |
| 350 | POST | `/v1/whatsapp/conversations/{id}/link-lead` | `LinkConversationToLead` | `whatsappHandler.LinkConversationToLead` | Organização + permissão WhatsAppOperate | 650 |
| 351 | GET | `/v1/whatsapp/conversations/{id}/labels` | `ListChatLabels` | `whatsappHandler.ListChatLabels` | Organização + permissão WhatsAppView | 651 |
| 352 | POST | `/v1/whatsapp/messages/{id}/retry-media` | `RetryMediaDownload` | `whatsappHandler.RetryMediaDownload` | Organização + permissão WhatsAppOperate | 652 |

### Webhooks — 5

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 232 | GET | `/v1/webhooks` | `List` | `webhooksHandler.List` | Organização + permissão SettingsIntegrations | 532 |
| 233 | POST | `/v1/webhooks` | `Create` | `webhooksHandler.Create` | Organização + permissão SettingsIntegrations | 533 |
| 234 | PATCH | `/v1/webhooks/{id}` | `Update` | `webhooksHandler.Update` | Organização + permissão SettingsIntegrations | 534 |
| 235 | DELETE | `/v1/webhooks/{id}` | `Delete` | `webhooksHandler.Delete` | Organização + permissão SettingsIntegrations | 535 |
| 236 | POST | `/v1/webhooks/{id}/regenerate-token` | `RegenerateToken` | `webhooksHandler.RegenerateToken` | Organização + permissão SettingsIntegrations | 536 |

### Integrações — 23

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 237 | POST | `/v1/integrations/functions/{name}` | `InvokeFunction` | `integrationsHandler.InvokeFunction` | Organização + permissão SettingsIntegrations | 537 |
| 238 | GET | `/v1/integrations/vista` | `GetVista` | `integrationsHandler.GetVista` | Organização + permissão SettingsIntegrations | 538 |
| 239 | PUT | `/v1/integrations/vista` | `SaveVista` | `integrationsHandler.SaveVista` | Organização + permissão SettingsIntegrations | 539 |
| 240 | DELETE | `/v1/integrations/vista` | `DeleteVista` | `integrationsHandler.DeleteVista` | Organização + permissão SettingsIntegrations | 540 |
| 241 | GET | `/v1/integrations/imoview` | `GetImoview` | `integrationsHandler.GetImoview` | Organização + permissão SettingsIntegrations | 541 |
| 242 | PUT | `/v1/integrations/imoview` | `SaveImoview` | `integrationsHandler.SaveImoview` | Organização + permissão SettingsIntegrations | 542 |
| 243 | DELETE | `/v1/integrations/imoview` | `DeleteImoview` | `integrationsHandler.DeleteImoview` | Organização + permissão SettingsIntegrations | 543 |
| 244 | GET | `/v1/integrations/meta` | `ListMetaIntegrations` | `integrationsHandler.ListMetaIntegrations` | Organização + permissão SettingsIntegrations | 544 |
| 245 | GET | `/v1/integrations/meta/oauth-flows/{id}` | `ShowMetaOAuthFlow` | `integrationsHandler.ShowMetaOAuthFlow` | Organização + permissão SettingsIntegrations | 545 |
| 246 | GET | `/v1/integrations/meta/form-configs` | `ListMetaFormConfigs` | `integrationsHandler.ListMetaFormConfigs` | Organização + permissão SettingsIntegrations | 546 |
| 247 | POST | `/v1/integrations/meta/form-configs` | `SaveMetaFormConfig` | `integrationsHandler.SaveMetaFormConfig` | Organização + permissão SettingsIntegrations | 547 |
| 248 | PATCH | `/v1/integrations/meta/form-configs` | `ToggleMetaFormConfig` | `integrationsHandler.ToggleMetaFormConfig` | Organização + permissão SettingsIntegrations | 548 |
| 249 | DELETE | `/v1/integrations/meta/form-configs` | `DeleteMetaFormConfig` | `integrationsHandler.DeleteMetaFormConfig` | Organização + permissão SettingsIntegrations | 549 |
| 250 | GET | `/v1/integrations/meta/webhook-health` | `MetaWebhookHealth` | `integrationsHandler.MetaWebhookHealth` | Organização + permissão SettingsIntegrations | 550 |
| 251 | GET | `/v1/integrations/meta/conversations` | `ListMetaConversations` | `integrationsHandler.ListMetaConversations` | Organização + permissão SettingsIntegrations | 551 |
| 252 | GET | `/v1/integrations/meta/conversations/{id}/messages` | `ListMetaMessages` | `integrationsHandler.ListMetaMessages` | Organização + permissão SettingsIntegrations | 552 |
| 253 | GET | `/v1/integrations/portals/grupo-olx` | `GetGrupoOLX` | `portalsHandler.GetGrupoOLX` | Módulo portals + permissão SettingsIntegrations | 553 |
| 254 | PUT | `/v1/integrations/portals/grupo-olx` | `SaveGrupoOLX` | `portalsHandler.SaveGrupoOLX` | Módulo portals + permissão SettingsIntegrations | 554 |
| 255 | POST | `/v1/integrations/portals/grupo-olx/activate` | `ActivateGrupoOLX` | `portalsHandler.ActivateGrupoOLX` | Módulo portals + permissão SettingsIntegrations | 555 |
| 256 | POST | `/v1/integrations/portals/grupo-olx/regenerate-feed-token` | `RegenerateGrupoOLXFeedToken` | `portalsHandler.RegenerateGrupoOLXFeedToken` | Módulo portals + permissão SettingsIntegrations | 556 |
| 257 | POST | `/v1/integrations/portals/grupo-olx/regenerate-webhook-token` | `RegenerateGrupoOLXWebhookToken` | `portalsHandler.RegenerateGrupoOLXWebhookToken` | Módulo portals + permissão SettingsIntegrations | 557 |
| 258 | GET | `/v1/integrations/portals/grupo-olx/publications` | `ListGrupoOLXPublications` | `portalsHandler.ListGrupoOLXPublications` | Módulo portals + permissão SettingsIntegrations | 558 |
| 259 | PUT | `/v1/integrations/portals/grupo-olx/publications` | `UpsertGrupoOLXPublications` | `portalsHandler.UpsertGrupoOLXPublications` | Módulo portals + permissão SettingsIntegrations | 559 |

### Configurações — 32

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 261 | PATCH | `/v1/settings/profile` | `UpdateProfile` | `settingsHandler.UpdateProfile` | Usuário autenticado | 561 |
| 262 | POST | `/v1/settings/profile/avatar` | `UploadProfileAvatar` | `settingsHandler.UploadProfileAvatar` | Usuário autenticado | 562 |
| 263 | PATCH | `/v1/settings/organization` | `UpdateOrganization` | `settingsHandler.UpdateOrganization` | Organização + permissão SettingsOrganization | 563 |
| 264 | POST | `/v1/settings/organization/logo` | `UploadOrganizationLogo` | `settingsHandler.UploadOrganizationLogo` | Organização + permissão SettingsOrganization | 564 |
| 265 | POST | `/v1/settings/password` | `ChangePassword` | `settingsHandler.ChangePassword` | Usuário autenticado | 565 |
| 266 | GET | `/v1/settings/password/status` | `PasswordStatus` | `settingsHandler.PasswordStatus` | Usuário autenticado | 566 |
| 267 | GET | `/v1/settings/modules` | `ListOrganizationModules` | `settingsHandler.ListOrganizationModules` | Organização ativa | 567 |
| 268 | GET | `/v1/settings/setup-guide-progress` | `ShowSetupGuideProgress` | `settingsHandler.ShowSetupGuideProgress` | Usuário autenticado | 568 |
| 269 | PUT | `/v1/settings/setup-guide-progress` | `UpdateSetupGuideProgress` | `settingsHandler.UpdateSetupGuideProgress` | Usuário autenticado | 569 |
| 270 | POST | `/v1/settings/push-tokens` | `SavePushToken` | `settingsHandler.SavePushToken` | Organização ativa | 570 |
| 271 | GET | `/v1/settings/push-tokens` | `ListPushDevices` | `settingsHandler.ListPushDevices` | Organização ativa | 571 |
| 272 | POST | `/v1/settings/push-tokens/deactivate` | `DeactivatePushToken` | `settingsHandler.DeactivatePushToken` | Usuário autenticado | 572 |
| 273 | GET | `/v1/settings/api-keys` | `ListAPIKeys` | `settingsHandler.ListAPIKeys` | Organização + permissão SettingsIntegrations | 573 |
| 274 | POST | `/v1/settings/api-keys` | `CreateAPIKey` | `settingsHandler.CreateAPIKey` | Organização + permissão SettingsIntegrations | 574 |
| 275 | DELETE | `/v1/settings/api-keys/{id}` | `DeleteAPIKey` | `settingsHandler.DeleteAPIKey` | Organização + permissão SettingsIntegrations | 575 |
| 276 | GET | `/v1/settings/subscription` | `ShowSubscription` | `settingsHandler.ShowSubscription` | Organização + permissão SettingsBilling | 576 |
| 277 | PATCH | `/v1/settings/subscription/billing` | `UpdateSubscriptionBilling` | `settingsHandler.UpdateSubscriptionBilling` | Organização + permissão SettingsBilling | 577 |
| 278 | PATCH | `/v1/settings/subscription/plan` | `SelectSubscriptionPlan` | `settingsHandler.SelectSubscriptionPlan` | Organização + permissão SettingsBilling | 578 |
| 279 | POST | `/v1/settings/subscription/charge` | `CreateSubscriptionCharge` | `integrationsHandler.CreateSubscriptionCharge` | Organização + permissão SettingsBilling | 579 |
| 280 | GET | `/v1/settings/roles` | `ListOrganizationRoles` | `settingsHandler.ListOrganizationRoles` | Organização + permissão PermissionsManage | 580 |
| 281 | POST | `/v1/settings/roles` | `CreateRole` | `settingsHandler.CreateRole` | Organização + permissão PermissionsManage | 581 |
| 282 | PATCH | `/v1/settings/roles/{id}` | `UpdateRole` | `settingsHandler.UpdateRole` | Organização + permissão PermissionsManage | 582 |
| 283 | DELETE | `/v1/settings/roles/{id}` | `DeleteRole` | `settingsHandler.DeleteRole` | Organização + permissão PermissionsManage | 583 |
| 284 | GET | `/v1/settings/roles/{id}/permissions` | `ListRolePermissions` | `settingsHandler.ListRolePermissions` | Organização + permissão PermissionsManage | 584 |
| 285 | PUT | `/v1/settings/roles/{id}/permissions` | `ReplaceRolePermissions` | `settingsHandler.ReplaceRolePermissions` | Organização + permissão PermissionsManage | 585 |
| 286 | GET | `/v1/settings/permissions` | `ListAvailablePermissions` | `settingsHandler.ListAvailablePermissions` | Usuário autenticado | 586 |
| 287 | GET | `/v1/settings/users/{id}/permissions` | `ShowUserPermissions` | `settingsHandler.ShowUserPermissions` | Organização + permissão PermissionsManage | 587 |
| 288 | PUT | `/v1/settings/users/{id}/permissions` | `ReplaceUserPermissions` | `settingsHandler.ReplaceUserPermissions` | Organização + permissão PermissionsManage | 588 |
| 289 | DELETE | `/v1/settings/users/{id}/permissions` | `ResetUserPermissions` | `settingsHandler.ResetUserPermissions` | Organização + permissão PermissionsManage | 589 |
| 290 | GET | `/v1/settings/user-roles` | `ListUserOrganizationRoles` | `settingsHandler.ListUserOrganizationRoles` | Organização + permissão PermissionsManage | 590 |
| 291 | PUT | `/v1/settings/user-roles` | `AssignUserRole` | `settingsHandler.AssignUserRole` | Organização + permissão PermissionsManage | 591 |
| 292 | GET | `/v1/settings/has-permission` | `HasPermission` | `settingsHandler.HasPermission` | Usuário autenticado | 592 |

### Site — 15

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 293 | GET | `/v1/site` | `ShowSite` | `siteHandler.ShowSite` | Módulo site + permissão SettingsSite | 593 |
| 294 | POST | `/v1/site` | `CreateSite` | `siteHandler.CreateSite` | Módulo site + permissão SettingsSite | 594 |
| 295 | PATCH | `/v1/site` | `UpdateSite` | `siteHandler.UpdateSite` | Módulo site + permissão SettingsSite | 595 |
| 296 | POST | `/v1/site/domain/verify` | `VerifyDomain` | `siteHandler.VerifyDomain` | Módulo site + permissão SettingsSite | 596 |
| 297 | POST | `/v1/site/assets` | `UploadAsset` | `siteHandler.UploadAsset` | Módulo site + permissão SettingsSite | 597 |
| 298 | GET | `/v1/site/menu-items` | `ListMenuItems` | `siteHandler.ListMenuItems` | Módulo site + permissão SettingsSite | 598 |
| 299 | POST | `/v1/site/menu-items` | `CreateMenuItem` | `siteHandler.CreateMenuItem` | Módulo site + permissão SettingsSite | 599 |
| 300 | PATCH | `/v1/site/menu-items/{id}` | `UpdateMenuItem` | `siteHandler.UpdateMenuItem` | Módulo site + permissão SettingsSite | 600 |
| 301 | DELETE | `/v1/site/menu-items/{id}` | `DeleteMenuItem` | `siteHandler.DeleteMenuItem` | Módulo site + permissão SettingsSite | 601 |
| 302 | POST | `/v1/site/menu-items/reorder` | `ReorderMenuItems` | `siteHandler.ReorderMenuItems` | Módulo site + permissão SettingsSite | 602 |
| 303 | GET | `/v1/site/search-filters` | `ListSearchFilters` | `siteHandler.ListSearchFilters` | Módulo site + permissão SettingsSite | 603 |
| 304 | POST | `/v1/site/search-filters` | `CreateSearchFilter` | `siteHandler.CreateSearchFilter` | Módulo site + permissão SettingsSite | 604 |
| 305 | PATCH | `/v1/site/search-filters/{id}` | `UpdateSearchFilter` | `siteHandler.UpdateSearchFilter` | Módulo site + permissão SettingsSite | 605 |
| 306 | DELETE | `/v1/site/search-filters/{id}` | `DeleteSearchFilter` | `siteHandler.DeleteSearchFilter` | Módulo site + permissão SettingsSite | 606 |
| 307 | POST | `/v1/site/search-filters/reorder` | `ReorderSearchFilters` | `siteHandler.ReorderSearchFilters` | Módulo site + permissão SettingsSite | 607 |

### Enriquecimento de leads — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 353 | GET | `/v1/lead-enrichments` | `ListEnrichments` | `leadsHandler.ListEnrichments` | Organização ativa | 653 |

### Quadro do pipeline — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 354 | GET | `/v1/pipeline-board` | `ShowPipelineBoard` | `leadsHandler.ShowPipelineBoard` | Organização ativa | 654 |

### Leads por etapa — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 355 | GET | `/v1/pipeline-stage-leads` | `ListPipelineStageLeads` | `leadsHandler.ListPipelineStageLeads` | Organização ativa | 655 |

### Contagem por etapa — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 356 | GET | `/v1/pipeline-stage-counts` | `ListPipelineStageCounts` | `leadsHandler.ListPipelineStageCounts` | Organização ativa | 656 |

### Filtros de metadados de leads — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 357 | GET | `/v1/lead-meta-filters` | `ListLeadMetaFilters` | `leadsHandler.ListLeadMetaFilters` | Organização ativa | 657 |

### Visibilidade de leads — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 358 | GET | `/v1/lead-visibility` | `ShowLeadVisibility` | `leadsHandler.ShowLeadVisibility` | Organização ativa | 658 |

### Contatos — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 359 | GET | `/v1/contacts` | `ListContacts` | `leadsHandler.ListContacts` | Organização ativa | 659 |

### Tags — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 360 | GET | `/v1/tags` | `ListTags` | `leadsHandler.ListTags` | Organização ativa | 660 |
| 361 | POST | `/v1/tags` | `CreateTag` | `leadsHandler.CreateTag` | Organização + permissão TagManage | 661 |
| 362 | PATCH | `/v1/tags/{id}` | `UpdateTag` | `leadsHandler.UpdateTag` | Organização + permissão TagManage | 662 |
| 363 | DELETE | `/v1/tags/{id}` | `DeleteTag` | `leadsHandler.DeleteTag` | Organização + permissão TagManage | 663 |

### Atividades — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 364 | GET | `/v1/activities` | `ListActivities` | `leadsHandler.ListActivities` | Organização ativa | 664 |
| 365 | POST | `/v1/activities` | `CreateActivity` | `leadsHandler.CreateActivity` | Organização + permissão LeadOperate | 665 |

### Metadados de leads — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 366 | GET | `/v1/lead-meta` | `ShowLeadMeta` | `leadsHandler.ShowLeadMeta` | Organização ativa | 666 |

### Anexos de leads — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 367 | GET | `/v1/lead-attachments` | `ListLeadAttachments` | `leadsHandler.ListLeadAttachments` | Organização ativa | 667 |
| 368 | POST | `/v1/lead-attachments` | `CreateLeadAttachment` | `leadsHandler.CreateLeadAttachment` | Organização + permissão LeadOperate | 668 |

### Analytics de leads — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 369 | GET | `/v1/lead-analytics/first-response-metrics` | `ShowFirstResponseMetrics` | `leadsHandler.ShowFirstResponseMetrics` | Organização ativa | 669 |
| 370 | GET | `/v1/lead-analytics/first-response-ranking` | `ListFirstResponseRanking` | `leadsHandler.ListFirstResponseRanking` | Organização ativa | 670 |

### Tarefas de leads — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 371 | GET | `/v1/lead-tasks` | `ListLeadTasks` | `leadsHandler.ListLeadTasks` | Organização ativa | 671 |
| 372 | POST | `/v1/lead-tasks` | `CreateLeadTask` | `leadsHandler.CreateLeadTask` | Organização + permissão LeadOperate | 672 |
| 373 | PATCH | `/v1/lead-tasks/{id}` | `PatchLeadTask` | `leadsHandler.PatchLeadTask` | Organização + permissão LeadOperate | 673 |
| 374 | POST | `/v1/lead-tasks/complete-cadence` | `CompleteCadenceTask` | `leadsHandler.CompleteCadenceTask` | Organização + permissão LeadOperate | 674 |

### Notificações — 6

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 375 | GET | `/v1/notifications` | `ListNotifications` | `leadsHandler.ListNotifications` | Organização ativa | 675 |
| 376 | POST | `/v1/notifications` | `CreateNotification` | `leadsHandler.CreateNotification` | Organização ativa | 676 |
| 377 | POST | `/v1/notifications/dispatch` | `DispatchNotification` | `leadsHandler.DispatchNotification` | Organização ativa | 677 |
| 378 | GET | `/v1/notifications/unread-count` | `CountUnreadNotifications` | `leadsHandler.CountUnreadNotifications` | Organização ativa | 678 |
| 379 | POST | `/v1/notifications/{id}/read` | `MarkNotificationRead` | `leadsHandler.MarkNotificationRead` | Organização ativa | 679 |
| 380 | POST | `/v1/notifications/read-all` | `MarkAllNotificationsRead` | `leadsHandler.MarkAllNotificationsRead` | Organização ativa | 680 |

### Imóveis — 7

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 398 | GET | `/v1/properties` | `List` | `propertiesHandler.List` | Módulo properties + permissão PropertyView | 698 |
| 399 | GET | `/v1/properties/stats` | `Stats` | `propertiesHandler.Stats` | Módulo properties + permissão PropertyView | 699 |
| 400 | POST | `/v1/properties` | `Create` | `propertiesHandler.Create` | Módulo properties + permissão PropertyManage | 700 |
| 401 | GET | `/v1/properties/{id}` | `Show` | `propertiesHandler.Show` | Módulo properties + permissão PropertyView | 701 |
| 402 | GET | `/v1/properties/{id}/history` | `History` | `propertiesHandler.History` | Módulo properties + permissão PropertyView | 702 |
| 403 | PATCH | `/v1/properties/{id}` | `Update` | `propertiesHandler.Update` | Módulo properties + permissão PropertyManage | 703 |
| 404 | DELETE | `/v1/properties/{id}` | `Delete` | `propertiesHandler.Delete` | Módulo properties + permissão PropertyManage | 704 |

### Imagens dos imóveis — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 405 | POST | `/v1/property-images` | `UploadImage` | `propertiesHandler.UploadImage` | Módulo properties + permissão PropertyManage | 705 |

### Captadores de imóveis — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 406 | GET | `/v1/property-captors/{id}` | `ShowPropertyCaptor` | `propertiesHandler.ShowPropertyCaptor` | Módulo properties + permissão PropertyView | 706 |

### Informações públicas do imóvel — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 407 | GET | `/v1/property-site-info` | `ShowPropertySiteInfo` | `propertiesHandler.ShowPropertySiteInfo` | Módulo properties + permissão PropertyView | 707 |

### Resumos dos imóveis — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 408 | GET | `/v1/property-summaries` | `ListPropertySummaries` | `propertiesHandler.ListPropertySummaries` | Módulo properties + permissão PropertyView | 708 |

### Organizações dos usuários — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 409 | GET | `/v1/user-organizations` | `ListUserOrganizations` | `usersHandler.ListUserOrganizations` | Usuário autenticado | 709 |

### Usuários — 5

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 410 | GET | `/v1/users` | `ListOrganizationUsers` | `usersHandler.ListOrganizationUsers` | Organização ativa | 710 |
| 411 | POST | `/v1/users` | `CreateOrganizationUser` | `usersHandler.CreateOrganizationUser` | Organização + permissão UsersManage | 711 |
| 412 | PATCH | `/v1/users/{id}` | `UpdateOrganizationUser` | `usersHandler.UpdateOrganizationUser` | Organização + permissão UsersManage | 712 |
| 413 | GET | `/v1/users/{id}/delete-impact` | `GetDeleteUserImpact` | `usersHandler.GetDeleteUserImpact` | Organização + permissão UsersManage | 713 |
| 414 | DELETE | `/v1/users/{id}` | `DeleteOrganizationUser` | `usersHandler.DeleteOrganizationUser` | Organização + permissão UsersManage | 714 |

### Resumos dos usuários — 1

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 415 | GET | `/v1/user-summaries` | `ListSummaries` | `usersHandler.ListSummaries` | Organização ativa | 715 |

### Equipes — 6

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 416 | GET | `/v1/teams` | `List` | `teamsHandler.List` | Organização + permissão TeamView | 716 |
| 417 | POST | `/v1/teams` | `Create` | `teamsHandler.Create` | Organização + permissão TeamManage | 717 |
| 418 | PATCH | `/v1/teams/{id}` | `Update` | `teamsHandler.Update` | Organização + permissão TeamManage | 718 |
| 419 | DELETE | `/v1/teams/{id}` | `Delete` | `teamsHandler.Delete` | Organização + permissão TeamManage | 719 |
| 420 | PATCH | `/v1/teams/{id}/status` | `UpdateStatus` | `teamsHandler.UpdateStatus` | Organização + permissão TeamManage | 720 |
| 421 | POST | `/v1/teams/logo` | `UploadLogo` | `teamsHandler.UploadLogo` | Organização + permissão TeamManage | 721 |

### Pipelines das equipes — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 422 | GET | `/v1/team-pipelines` | `ListTeamPipelines` | `teamsHandler.ListTeamPipelines` | Organização + permissão TeamView | 722 |
| 423 | POST | `/v1/team-pipelines` | `AssignPipelineToTeam` | `teamsHandler.AssignPipelineToTeam` | Organização + permissão TeamManage | 723 |
| 424 | DELETE | `/v1/team-pipelines` | `RemovePipelineFromTeam` | `teamsHandler.RemovePipelineFromTeam` | Organização + permissão TeamManage | 724 |

### Membros de equipe — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 425 | PATCH | `/v1/team-members/leader` | `SetTeamLeader` | `teamsHandler.SetTeamLeader` | Organização + permissão TeamManage | 725 |
| 428 | GET | `/v1/team-members/{id}/availability` | `ListTeamMemberAvailability` | `teamsHandler.ListTeamMemberAvailability` | Organização ativa | 728 |
| 429 | PUT | `/v1/team-members/{id}/availability` | `ReplaceAvailability` | `teamsHandler.ReplaceAvailability` | Organização ativa | 729 |

### Disponibilidade dos membros — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 426 | GET | `/v1/member-availability` | `ListMemberAvailability` | `teamsHandler.ListMemberAvailability` | Organização ativa | 726 |
| 427 | PATCH | `/v1/member-availability` | `UpsertAvailability` | `teamsHandler.UpsertAvailability` | Organização ativa | 727 |

### Tipos de imóveis — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 430 | GET | `/v1/property-types` | `ListPropertyTypes` | `propertiesHandler.ListPropertyTypes` | Módulo properties + permissão PropertyView | 730 |
| 431 | POST | `/v1/property-types` | `CreatePropertyType` | `propertiesHandler.CreatePropertyType` | Módulo properties + permissão PropertyManage | 731 |

### Características dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 432 | GET | `/v1/property-features` | `ListPropertyFeatures` | `propertiesHandler.ListPropertyFeatures` | Módulo properties + permissão PropertyView | 732 |
| 433 | POST | `/v1/property-features` | `CreatePropertyFeature` | `propertiesHandler.CreatePropertyFeature` | Módulo properties + permissão PropertyManage | 733 |
| 434 | POST | `/v1/property-features/seed-defaults` | `SeedPropertyFeatures` | `propertiesHandler.SeedPropertyFeatures` | Módulo properties + permissão PropertyManage | 734 |

### Proximidades dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 435 | GET | `/v1/property-proximities` | `ListPropertyProximities` | `propertiesHandler.ListPropertyProximities` | Módulo properties + permissão PropertyView | 735 |
| 436 | POST | `/v1/property-proximities` | `CreatePropertyProximity` | `propertiesHandler.CreatePropertyProximity` | Módulo properties + permissão PropertyManage | 736 |
| 437 | POST | `/v1/property-proximities/seed-defaults` | `SeedPropertyProximities` | `propertiesHandler.SeedPropertyProximities` | Módulo properties + permissão PropertyManage | 737 |

### Cidades dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 438 | GET | `/v1/property-cities` | `ListCities` | `propertiesHandler.ListCities` | Módulo properties + permissão PropertyView | 738 |
| 439 | POST | `/v1/property-cities` | `CreateCity` | `propertiesHandler.CreateCity` | Módulo properties + permissão PropertyManage | 739 |
| 440 | DELETE | `/v1/property-cities/{id}` | `DeleteCity` | `propertiesHandler.DeleteCity` | Módulo properties + permissão PropertyManage | 740 |

### Bairros dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 441 | GET | `/v1/property-neighborhoods` | `ListNeighborhoods` | `propertiesHandler.ListNeighborhoods` | Módulo properties + permissão PropertyView | 741 |
| 442 | POST | `/v1/property-neighborhoods` | `CreateNeighborhood` | `propertiesHandler.CreateNeighborhood` | Módulo properties + permissão PropertyManage | 742 |
| 443 | DELETE | `/v1/property-neighborhoods/{id}` | `DeleteNeighborhood` | `propertiesHandler.DeleteNeighborhood` | Módulo properties + permissão PropertyManage | 743 |

### Condomínios dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 444 | GET | `/v1/property-condominiums` | `ListCondominiums` | `propertiesHandler.ListCondominiums` | Módulo properties + permissão PropertyView | 744 |
| 445 | POST | `/v1/property-condominiums` | `CreateCondominium` | `propertiesHandler.CreateCondominium` | Módulo properties + permissão PropertyManage | 745 |
| 446 | DELETE | `/v1/property-condominiums/{id}` | `DeleteCondominium` | `propertiesHandler.DeleteCondominium` | Módulo properties + permissão PropertyManage | 746 |

### Proprietários dos imóveis — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 447 | GET | `/v1/property-owners` | `ListOwners` | `propertiesHandler.ListOwners` | Módulo properties + permissão PropertyView | 747 |
| 448 | POST | `/v1/property-owners` | `CreateOwner` | `propertiesHandler.CreateOwner` | Módulo properties + permissão PropertyManage | 748 |
| 449 | PATCH | `/v1/property-owners/{id}` | `UpdateOwner` | `propertiesHandler.UpdateOwner` | Módulo properties + permissão PropertyManage | 749 |

### Pipelines — 7

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 450 | GET | `/v1/pipelines` | `List` | `pipelinesHandler.List` | Organização ativa | 750 |
| 451 | POST | `/v1/pipelines` | `Create` | `pipelinesHandler.Create` | Organização + permissão PipelineManage | 751 |
| 452 | PATCH | `/v1/pipelines/{id}` | `Update` | `pipelinesHandler.Update` | Organização + permissão PipelineManage | 752 |
| 453 | DELETE | `/v1/pipelines/{id}` | `Delete` | `pipelinesHandler.Delete` | Organização + permissão PipelineManage | 753 |
| 455 | POST | `/v1/pipelines/{id}/stages` | `CreateStage` | `pipelinesHandler.CreateStage` | Organização + permissão PipelineManage | 755 |
| 456 | POST | `/v1/pipelines/{id}/stages/reorder` | `ReorderStages` | `pipelinesHandler.ReorderStages` | Organização + permissão PipelineManage | 756 |
| 457 | POST | `/v1/pipelines/{id}/round-robin` | `SetDefaultRoundRobin` | `pipelinesHandler.SetDefaultRoundRobin` | Organização + permissão PipelineManage | 757 |

### Etapas — 3

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 454 | GET | `/v1/stages` | `ListStages` | `pipelinesHandler.ListStages` | Organização ativa | 754 |
| 458 | PATCH | `/v1/stages/{id}` | `UpdateStage` | `pipelinesHandler.UpdateStage` | Organização + permissão PipelineManage | 758 |
| 459 | DELETE | `/v1/stages/{id}` | `DeleteStage` | `pipelinesHandler.DeleteStage` | Organização + permissão PipelineManage | 759 |

### Filas de distribuição — 7

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 460 | GET | `/v1/round-robins` | `List` | `roundRobinHandler.List` | Organização + permissão DistributionManage | 760 |
| 461 | POST | `/v1/round-robins` | `Create` | `roundRobinHandler.Create` | Organização + permissão DistributionManage | 761 |
| 462 | PATCH | `/v1/round-robins/{id}` | `Update` | `roundRobinHandler.Update` | Organização + permissão DistributionManage | 762 |
| 463 | DELETE | `/v1/round-robins/{id}` | `Delete` | `roundRobinHandler.Delete` | Organização + permissão DistributionManage | 763 |
| 464 | GET | `/v1/round-robins/{id}/rules` | `ListRules` | `roundRobinHandler.ListRules` | Organização + permissão DistributionManage | 764 |
| 465 | POST | `/v1/round-robins/{id}/rules` | `CreateRule` | `roundRobinHandler.CreateRule` | Organização + permissão DistributionManage | 765 |
| 470 | POST | `/v1/round-robins/{id}/members` | `AddMember` | `roundRobinHandler.AddMember` | Organização + permissão DistributionManage | 770 |

### Regras de distribuição — 4

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 466 | GET | `/v1/round-robin-rules` | `ListRules` | `roundRobinHandler.ListRules` | Organização + permissão DistributionManage | 766 |
| 467 | POST | `/v1/round-robin-rules` | `CreateRule` | `roundRobinHandler.CreateRule` | Organização + permissão DistributionManage | 767 |
| 468 | PATCH | `/v1/round-robin-rules/{id}` | `UpdateRule` | `roundRobinHandler.UpdateRule` | Organização + permissão DistributionManage | 768 |
| 469 | DELETE | `/v1/round-robin-rules/{id}` | `DeleteRule` | `roundRobinHandler.DeleteRule` | Organização + permissão DistributionManage | 769 |

### Membros da distribuição — 2

| # | Método | Rota | Operação | Handler | Proteção registrada | Linha |
| ---: | --- | --- | --- | --- | --- | ---: |
| 471 | PATCH | `/v1/round-robin-members/{id}` | `UpdateMember` | `roundRobinHandler.UpdateMember` | Organização + permissão DistributionManage | 771 |
| 472 | DELETE | `/v1/round-robin-members/{id}` | `DeleteMember` | `roundRobinHandler.DeleteMember` | Organização + permissão DistributionManage | 772 |
