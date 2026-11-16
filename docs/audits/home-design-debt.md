# Dívida visual em relação ao padrão Home

Este relatório é gerado por `scripts/audits/inventory-home-design-debt.mjs`.

Ele prioriza candidatos a revisão; não substitui inspeção renderizada. Cores que codificam dados, status e gráficos não devem ser removidas mecanicamente.

## Resumo

- Arquivos analisados: 675
- Arquivos com achados: 71
- Achados: 159
- Arquivos protegidos/mistos com achados: 67
- Achados alcançáveis pelo CRM protegido: 155
- Distribuição por superfície: protected-only 114, protected-and-public 41, public-only 2, infraestrutura 2
- P1: 115
- P2: 26
- P3: 18

## Regras

| Prioridade | Regra | Quantidade | Direção |
| --- | --- | ---: | --- |
| P1 | Sombra forte | 11 | Usar shadow-none ou a sombra sutil dos pop-ups globais. |
| P2 | Sombra fora do padrão | 8 | Blocos Home não usam sombra; validar se a elevação é realmente necessária. |
| P1 | Raio acima de 8px | 51 | Blocos usam 8px; controles 6px; microelementos 4px. |
| P1 | Tipografia pesada | 8 | Texto normal usa 300; títulos usam 400. |
| P1 | Cor hardcoded | 45 | Usar tokens --app-* ou cores semânticas do domínio. |
| P2 | Superfície branca/preta fixa | 17 | Usar --app-surface-solid, --app-surface-soft ou --app-surface-hover. |
| P2 | Movimento agressivo | 0 | Remover scale/translate decorativo de cards e ações operacionais. |
| P3 | Caixa alta/tracking | 18 | Preferir texto natural em 10–12px e peso 300. |
| P2 | Blur no painel | 1 | O overlay pode escurecer; o painel deve usar superfície sólida. |

## Arquivos prioritários

### CRM protegido e componentes compartilhados

| Arquivo | Score | Achados | Distribuição |
| --- | ---: | ---: | --- |
| `components/features/settings/RolesTab.tsx` | 56 | 18 | hardcoded-color: 10, heavy-font: 4, uppercase-tracking: 4 |
| `components/shared/SearchableTagPicker.tsx` | 40 | 11 | hardcoded-color: 9, hardcoded-surface: 2 |
| `components/features/auth/screens/NoOrganizationEmptyState.tsx` | 36 | 11 | hardcoded-color: 7, hardcoded-surface: 3, panel-blur: 1 |
| `components/features/marketing/MarketingScopeFilters.tsx` | 30 | 8 | oversized-radius: 2, hardcoded-color: 6 |
| `components/features/properties/PropertySettingsScreen.tsx` | 21 | 7 | oversized-radius: 7 |
| `components/features/marketing/MarketingSocialTab.tsx` | 16 | 6 | oversized-radius: 1, uppercase-tracking: 1, heavy-shadow: 1, hardcoded-color: 1, hardcoded-surface: 2 |
| `components/features/marketing/marketing-ui.tsx` | 14 | 4 | oversized-radius: 2, hardcoded-color: 2 |
| `components/features/site/SiteAnalyticsTab.tsx` | 12 | 4 | oversized-radius: 4 |
| `components/features/marketing/MarketingCreativeSpotlight.tsx` | 9 | 3 | oversized-radius: 1, hardcoded-color: 1, hardcoded-surface: 1 |
| `components/features/properties/developments/DevelopmentCatalogCard.tsx` | 9 | 3 | oversized-radius: 3 |
| `components/features/properties/property-locations/LocationPanels.tsx` | 9 | 3 | oversized-radius: 3 |
| `components/features/dashboard/LeadDistributionSection.tsx` | 8 | 4 | uppercase-tracking: 2, oversized-radius: 2 |
| `components/features/site/VisitorMap.tsx` | 8 | 4 | medium-shadow: 4 |
| `components/features/chat/FloatingChatButton.tsx` | 8 | 2 | heavy-shadow: 2 |
| `components/features/dashboard/DashboardKpis.tsx` | 6 | 2 | oversized-radius: 2 |
| `components/features/dashboard/DashboardScreen.tsx` | 6 | 2 | oversized-radius: 2 |
| `components/features/integrations/marketing-connections/MarketingConnectionsScreen.tsx` | 6 | 2 | oversized-radius: 2 |
| `components/features/marketing/MarketingMediaTab.tsx` | 6 | 2 | hardcoded-color: 1, hardcoded-surface: 1 |
| `components/features/properties/detail/PropertyAssetManager.tsx` | 6 | 2 | oversized-radius: 2 |
| `components/features/whatsapp/ScrollToLatestButton.tsx` | 6 | 2 | heavy-shadow: 1, hardcoded-surface: 1 |
| `components/features/dashboard/LeadSourcesChart.tsx` | 5 | 2 | medium-shadow: 1, oversized-radius: 1 |
| `components/features/integrations/MetaIntegrationSettings.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/schedule/CalendarView.tsx` | 4 | 2 | hardcoded-surface: 2 |
| `components/features/whatsapp/MediaViewer.tsx` | 4 | 2 | hardcoded-surface: 2 |
| `components/features/chat/FloatingChat.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/contacts/ContactCard.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/contacts/contacts-screen/ContactsList.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/leads/lead-detail/LeadTagPickerContent.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/leads/LeadCard.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/schedule/dashboard/AgendaDailyChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaWeeklyChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/settings/UserPermissionsScreen.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/whatsapp/ConfirmConversationLeadLinkDialog.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/whatsapp/conversations/ConversationFilters.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/whatsapp/conversations/ConversationLeadBadges.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/whatsapp/conversations/ConversationLeadTagBar.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/whatsapp/EnterAttendanceDialog.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/shared/layout/AccessValidationNotice.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/automations/ExecutionHistory.tsx` | 3 | 1 | heavy-font: 1 |
| `components/features/dashboard/CampaignLeadsChart.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/dashboard/DealsEvolutionChart.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/dashboard/SalesFunnelWithPipeline.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/dashboard/TopCreativesCard.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/presence/OnlineUsersPanel.tsx` | 3 | 1 | heavy-font: 1 |
| `components/features/properties/detail/PropertyWorkspaceOverview.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/properties/detail/PropertyWorkspaceSummary.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/properties/detail/tabs/KeysTab.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/properties/detail/tabs/TechnicalTab.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/properties/developments/PropertyDevelopmentsScreen.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/properties/property-locations/LocationsNavigation.tsx` | 3 | 1 | oversized-radius: 1 |

### Todas as superfícies

| Arquivo | Score | Achados | Distribuição |
| --- | ---: | ---: | --- |
| `components/features/settings/RolesTab.tsx` | 56 | 18 | hardcoded-color: 10, heavy-font: 4, uppercase-tracking: 4 |
| `components/shared/SearchableTagPicker.tsx` | 40 | 11 | hardcoded-color: 9, hardcoded-surface: 2 |
| `components/features/auth/screens/NoOrganizationEmptyState.tsx` | 36 | 11 | hardcoded-color: 7, hardcoded-surface: 3, panel-blur: 1 |
| `components/features/marketing/MarketingScopeFilters.tsx` | 30 | 8 | oversized-radius: 2, hardcoded-color: 6 |
| `components/features/properties/PropertySettingsScreen.tsx` | 21 | 7 | oversized-radius: 7 |
| `components/features/marketing/MarketingSocialTab.tsx` | 16 | 6 | oversized-radius: 1, uppercase-tracking: 1, heavy-shadow: 1, hardcoded-color: 1, hardcoded-surface: 2 |
| `components/features/marketing/marketing-ui.tsx` | 14 | 4 | oversized-radius: 2, hardcoded-color: 2 |
| `components/features/site/SiteAnalyticsTab.tsx` | 12 | 4 | oversized-radius: 4 |
| `components/features/marketing/MarketingCreativeSpotlight.tsx` | 9 | 3 | oversized-radius: 1, hardcoded-color: 1, hardcoded-surface: 1 |
| `components/features/properties/developments/DevelopmentCatalogCard.tsx` | 9 | 3 | oversized-radius: 3 |
| `components/features/properties/property-locations/LocationPanels.tsx` | 9 | 3 | oversized-radius: 3 |
| `components/features/dashboard/LeadDistributionSection.tsx` | 8 | 4 | uppercase-tracking: 2, oversized-radius: 2 |
| `components/features/site/VisitorMap.tsx` | 8 | 4 | medium-shadow: 4 |
| `components/features/chat/FloatingChatButton.tsx` | 8 | 2 | heavy-shadow: 2 |
| `components/features/dashboard/DashboardKpis.tsx` | 6 | 2 | oversized-radius: 2 |
| `components/features/dashboard/DashboardScreen.tsx` | 6 | 2 | oversized-radius: 2 |
| `components/features/integrations/marketing-connections/MarketingConnectionsScreen.tsx` | 6 | 2 | oversized-radius: 2 |
| `components/features/marketing/MarketingMediaTab.tsx` | 6 | 2 | hardcoded-color: 1, hardcoded-surface: 1 |
| `components/features/properties/detail/PropertyAssetManager.tsx` | 6 | 2 | oversized-radius: 2 |
| `components/features/whatsapp/ScrollToLatestButton.tsx` | 6 | 2 | heavy-shadow: 1, hardcoded-surface: 1 |
| `components/features/dashboard/LeadSourcesChart.tsx` | 5 | 2 | medium-shadow: 1, oversized-radius: 1 |
| `components/features/integrations/MetaIntegrationSettings.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/schedule/CalendarView.tsx` | 4 | 2 | hardcoded-surface: 2 |
| `components/features/whatsapp/MediaViewer.tsx` | 4 | 2 | hardcoded-surface: 2 |
| `components/features/chat/FloatingChat.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/contacts/ContactCard.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/contacts/contacts-screen/ContactsList.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/leads/lead-detail/LeadTagPickerContent.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/leads/LeadCard.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/marketing/MarketingTrendChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaDailyChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaWeeklyChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/settings/UserPermissionsScreen.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/whatsapp/ConfirmConversationLeadLinkDialog.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/whatsapp/conversations/ConversationFilters.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/whatsapp/conversations/ConversationLeadBadges.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/whatsapp/conversations/ConversationLeadTagBar.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/whatsapp/EnterAttendanceDialog.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/shared/layout/AccessValidationNotice.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/auth/AuthSplitLayout.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/automations/ExecutionHistory.tsx` | 3 | 1 | heavy-font: 1 |
| `components/features/dashboard/CampaignLeadsChart.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/dashboard/DealsEvolutionChart.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/dashboard/SalesFunnelWithPipeline.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/dashboard/TopCreativesCard.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/presence/OnlineUsersPanel.tsx` | 3 | 1 | heavy-font: 1 |
| `components/features/properties/detail/PropertyWorkspaceOverview.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/properties/detail/PropertyWorkspaceSummary.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/properties/detail/tabs/KeysTab.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/properties/detail/tabs/TechnicalTab.tsx` | 3 | 1 | oversized-radius: 1 |
