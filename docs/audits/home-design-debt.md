# Dívida visual em relação ao padrão Home

Este relatório é gerado por `scripts/audits/inventory-home-design-debt.mjs`.

Ele prioriza candidatos a revisão; não substitui inspeção renderizada. Cores que codificam dados, status e gráficos não devem ser removidas mecanicamente.

## Resumo

- Arquivos analisados: 540
- Arquivos com achados: 43
- Achados: 114
- Arquivos protegidos/mistos com achados: 42
- Achados alcançáveis pelo CRM protegido: 113
- Distribuição por superfície: protected-only 103, protected-and-public 10, public-only 1, infraestrutura 0
- P1: 56
- P2: 13
- P3: 45

## Regras

| Prioridade | Regra | Quantidade | Direção |
| --- | --- | ---: | --- |
| P1 | Sombra forte | 16 | Usar shadow-none ou a sombra sutil dos pop-ups globais. |
| P2 | Sombra fora do padrão | 6 | Blocos Home não usam sombra; validar se a elevação é realmente necessária. |
| P1 | Raio acima de 8px | 5 | Blocos usam 8px; controles 6px; microelementos 4px. |
| P1 | Tipografia pesada | 2 | Texto normal usa 300; títulos usam 400. |
| P1 | Cor hardcoded | 33 | Usar tokens --app-* ou cores semânticas do domínio. |
| P2 | Superfície branca/preta fixa | 4 | Usar --app-surface-solid, --app-surface-soft ou --app-surface-hover. |
| P2 | Movimento agressivo | 3 | Remover scale/translate decorativo de cards e ações operacionais. |
| P3 | Caixa alta/tracking | 45 | Preferir texto natural em 10–12px e peso 300. |
| P2 | Blur no painel | 0 | O overlay pode escurecer; o painel deve usar superfície sólida. |

## Arquivos prioritários

### CRM protegido e componentes compartilhados

| Arquivo | Score | Achados | Distribuição |
| --- | ---: | ---: | --- |
| `components/features/marketing/MarketingScopeFilters.tsx` | 77 | 20 | oversized-radius: 3, hardcoded-color: 16, heavy-shadow: 1 |
| `components/shared/SearchableTagPicker.tsx` | 40 | 11 | hardcoded-color: 9, hardcoded-surface: 2 |
| `components/features/schedule/dashboard/AgendaDashboardPanels.tsx` | 20 | 5 | hardcoded-color: 5 |
| `components/features/round-robin/distribution-queue-editor/DistributionQueueMembersSection.tsx` | 10 | 4 | heavy-shadow: 2, uppercase-tracking: 2 |
| `components/features/properties/detail/PropertyWorkspaceSections.tsx` | 8 | 8 | uppercase-tracking: 8 |
| `components/features/marketing/MarketingOverviewDashboard.tsx` | 8 | 5 | uppercase-tracking: 4, heavy-shadow: 1 |
| `components/features/site/VisitorMap.tsx` | 8 | 4 | medium-shadow: 4 |
| `components/features/chat/FloatingChat.tsx` | 8 | 2 | heavy-shadow: 2 |
| `components/features/chat/FloatingChatButton.tsx` | 8 | 2 | heavy-shadow: 2 |
| `components/features/properties/PropertyWorkspaceScreen.tsx` | 6 | 5 | uppercase-tracking: 4, aggressive-motion: 1 |
| `components/features/contacts/ImportContactsDialog.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/integrations/MetaIntegrationSettings.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/properties/detail/PropertyWorkspaceOverview.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/schedule/CalendarView.tsx` | 4 | 2 | hardcoded-surface: 2 |
| `components/features/contacts/ContactCard.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/contacts/contacts-screen/ContactsList.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/leads/LeadCard.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/marketing/MarketingTrendChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaAdaptiveChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaDailyChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaWeeklyChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/settings/UserPermissionsScreen.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/teams/TeamEditorScreen.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/whatsapp/conversations/ConversationMessages.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/whatsapp/EnterAttendanceDialog.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaEventsPanel.tsx` | 3 | 2 | uppercase-tracking: 1, aggressive-motion: 1 |
| `components/features/schedule/dashboard/AgendaUpcomingEventsPanel.tsx` | 3 | 2 | uppercase-tracking: 1, aggressive-motion: 1 |
| `components/features/marketing/MarketingTabViews.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/presence/OnlineUsersPanel.tsx` | 3 | 1 | heavy-font: 1 |
| `components/features/settings/IntegrationsTab.tsx` | 3 | 1 | heavy-font: 1 |
| `components/features/round-robin/DistributionQueueEditor.tsx` | 2 | 2 | uppercase-tracking: 2 |
| `components/features/schedule/dashboard/AgendaDashboardFilters.tsx` | 2 | 2 | uppercase-tracking: 2 |
| `components/features/whatsapp/conversations/ConversationListItem.tsx` | 2 | 2 | uppercase-tracking: 2 |
| `components/features/contacts/contacts-screen/ContactsOverlays.tsx` | 2 | 1 | medium-shadow: 1 |
| `components/features/whatsapp/message-bubble/MessageReactions.tsx` | 2 | 1 | medium-shadow: 1 |
| `components/features/admin/AdminNotificationSettingsContent.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/dashboard/LeadDistributionSection.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/marketing/MarketingMediaGallery.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/marketing/MarketingPaidTable.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/round-robin/DistributionQueueEditorScreen.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/schedule/dashboard/AgendaResponsibleResultsPanel.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/teams/TeamOperationalOverview.tsx` | 1 | 1 | uppercase-tracking: 1 |

### Todas as superfícies

| Arquivo | Score | Achados | Distribuição |
| --- | ---: | ---: | --- |
| `components/features/marketing/MarketingScopeFilters.tsx` | 77 | 20 | oversized-radius: 3, hardcoded-color: 16, heavy-shadow: 1 |
| `components/shared/SearchableTagPicker.tsx` | 40 | 11 | hardcoded-color: 9, hardcoded-surface: 2 |
| `components/features/schedule/dashboard/AgendaDashboardPanels.tsx` | 20 | 5 | hardcoded-color: 5 |
| `components/features/round-robin/distribution-queue-editor/DistributionQueueMembersSection.tsx` | 10 | 4 | heavy-shadow: 2, uppercase-tracking: 2 |
| `components/features/properties/detail/PropertyWorkspaceSections.tsx` | 8 | 8 | uppercase-tracking: 8 |
| `components/features/marketing/MarketingOverviewDashboard.tsx` | 8 | 5 | uppercase-tracking: 4, heavy-shadow: 1 |
| `components/features/site/VisitorMap.tsx` | 8 | 4 | medium-shadow: 4 |
| `components/features/chat/FloatingChat.tsx` | 8 | 2 | heavy-shadow: 2 |
| `components/features/chat/FloatingChatButton.tsx` | 8 | 2 | heavy-shadow: 2 |
| `components/features/properties/PropertyWorkspaceScreen.tsx` | 6 | 5 | uppercase-tracking: 4, aggressive-motion: 1 |
| `components/features/contacts/ImportContactsDialog.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/integrations/MetaIntegrationSettings.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/properties/detail/PropertyWorkspaceOverview.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/schedule/CalendarView.tsx` | 4 | 2 | hardcoded-surface: 2 |
| `components/features/contacts/ContactCard.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/contacts/contacts-screen/ContactsList.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/leads/LeadCard.tsx` | 4 | 1 | hardcoded-color: 1 |
| `components/features/marketing/MarketingTrendChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaAdaptiveChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaDailyChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaWeeklyChart.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/settings/UserPermissionsScreen.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/teams/TeamEditorScreen.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/whatsapp/conversations/ConversationMessages.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/whatsapp/EnterAttendanceDialog.tsx` | 4 | 1 | heavy-shadow: 1 |
| `components/features/schedule/dashboard/AgendaEventsPanel.tsx` | 3 | 2 | uppercase-tracking: 1, aggressive-motion: 1 |
| `components/features/schedule/dashboard/AgendaUpcomingEventsPanel.tsx` | 3 | 2 | uppercase-tracking: 1, aggressive-motion: 1 |
| `components/features/auth/AuthSplitLayout.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/marketing/MarketingTabViews.tsx` | 3 | 1 | oversized-radius: 1 |
| `components/features/presence/OnlineUsersPanel.tsx` | 3 | 1 | heavy-font: 1 |
| `components/features/settings/IntegrationsTab.tsx` | 3 | 1 | heavy-font: 1 |
| `components/features/round-robin/DistributionQueueEditor.tsx` | 2 | 2 | uppercase-tracking: 2 |
| `components/features/schedule/dashboard/AgendaDashboardFilters.tsx` | 2 | 2 | uppercase-tracking: 2 |
| `components/features/whatsapp/conversations/ConversationListItem.tsx` | 2 | 2 | uppercase-tracking: 2 |
| `components/features/contacts/contacts-screen/ContactsOverlays.tsx` | 2 | 1 | medium-shadow: 1 |
| `components/features/whatsapp/message-bubble/MessageReactions.tsx` | 2 | 1 | medium-shadow: 1 |
| `components/features/admin/AdminNotificationSettingsContent.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/dashboard/LeadDistributionSection.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/marketing/MarketingMediaGallery.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/marketing/MarketingPaidTable.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/round-robin/DistributionQueueEditorScreen.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/schedule/dashboard/AgendaResponsibleResultsPanel.tsx` | 1 | 1 | uppercase-tracking: 1 |
| `components/features/teams/TeamOperationalOverview.tsx` | 1 | 1 | uppercase-tracking: 1 |
