# Inventario canonico de superficies do CRM

Gerado por `node scripts/audits/inventory-crm-surfaces.mjs --write`.
O conteudo e deterministico para o digest `1953a1cc8f0496d73067993af1b8461ef9493ec804442eb5656c7f41372267ca`.

## Denominadores

| Superficie | Total |
| --- | ---: |
| Rotas de arquivo | 84 |
| Telas renderizaveis (sem redirects) | 78 |
| Aliases/redirects | 6 |
| Rotas protegidas | 63 |
| Rotas protegidas admin | 19 |
| Rotas nao protegidas (publicas, site e auth) | 21 |
| Rotas dinamicas | 16 |
| Overlays unicos | 221 |
| Formularios HTML unicos | 49 |
| CTAs internos unicos | 1284 |
| Controles complementares de overlay/tab | 293 |

Overlays: `alertDialog` 58, `dialog` 86, `dropdownMenu` 34, `popover` 26, `sheet` 17.

CTAs declarados, inclusive externos/desconhecidos: `actionButton` 1183, `external` 8, `internal` 30, `internalDynamic` 71, `unknownDynamic` 38.

## Identificadores estaveis

O indice JSON usa IDs no formato `tipo:00000000000000000000`, derivados por SHA-256 de tipo + caminho relativo + localizacao/assinatura estrutural. Nenhum caminho absoluto entra na chave. O digest do indice e `ffaed169fc1dd7dcf91760eea8140cc1f47ca518fd0d68aa3ae377eeb65151a5`.

| Categoria enderecavel | IDs |
| --- | ---: |
| Rotas renderizaveis e aliases | 84 |
| Overlays alcancaveis | 193 |
| Formularios alcancaveis | 46 |
| CTAs internos alcancaveis | 1175 |
| Controles complementares alcancaveis | 260 |

Cada entrada de superficie preserva arquivo, linha, coluna, dono e rotas associadas, permitindo que um caso E2E declare exatamente o ID coberto sem criar uma segunda contagem.

## Matriz minima mensuravel

| Verificacao | Denominador |
| --- | ---: |
| Acesso das rotas protegidas x ADM/Lider/Usuario | 189 |
| Tela renderizavel x desktop/mobile | 156 |
| Contrato dos aliases | 6 |
| Overlays alcancaveis por implementacao | 193 |
| Formularios alcancaveis por implementacao | 46 |
| CTAs internos alcancaveis por implementacao | 1175 |
| CTAs das telas de erro/infraestrutura | 2 |

Nao se somam esses denominadores como se fossem equivalentes. A cobertura deve ser informada por categoria e, para o corte de 90%, tambem como `aprovados / planejados` com todo P0/P1 obrigatoriamente aprovado.

## Regras contra dupla contagem

- Uma rota e um `app/**/page.tsx`; aliases continuam sendo endpoints, mas nao contam como tela renderizavel.
- Uma implementacao JSX tem identidade `arquivo:linha:coluna`. Reuso em varias rotas fica como associacao, sem multiplicar o denominador unico.
- `Button asChild` nao conta junto com o link filho. Primitivas com `asChild` tambem nao contam novamente.
- `<Form>` de contexto nao conta como segundo formulario quando envolve um `<form>` HTML.
- Componentes-base em `components/ui` sao infraestrutura; contam apenas as instancias de produto que os importam.
- Um `map` conta o ponto de interacao implementado uma vez; volume de dados em runtime nao altera este inventario.

## Lacunas do inventario estatico

- 35 arquivo(s) com superficie declarada nao aparecem no grafo conservador iniciado nas rotas.
- 16 rota(s) dinamica(s) exigem fixture valida e caso invalido; o inventario nao cria dados.
- As 19 rotas /admin sao de superadministracao: ADM/Lider/Usuario da organizacao devem ter negacao esperada, e uma persona superadmin separada e necessaria para validar a tela.
- Imports por barrel sao seguidos em nivel de arquivo e podem superestimar associacoes rota-componente; os denominadores unicos nao duplicam a implementacao.
- Elementos gerados por map/lista contam uma implementacao de codigo, nao a quantidade dependente dos dados em runtime.
- Handlers, feature flags, permissoes e destinos dinamicos precisam de verificacao em runtime; este auditor e deliberadamente estatico.

Arquivos com superficie fora do grafo conservador: `components/features/announcements/AnnouncementBanner.tsx`, `components/features/crm-management/CadencesTab.tsx`, `components/features/crm-management/DistributionQueueTab.tsx`, `components/features/crm-management/OperationalTab.tsx`, `components/features/crm-management/TabIntroCard.tsx`, `components/features/dashboard/CampaignPerformanceWidget.tsx`, `components/features/dashboard/DashboardAlertBar.tsx`, `components/features/dashboard/RecentActivities.tsx`, `components/features/dashboard/UpcomingTasksWidget.tsx`, `components/features/financial/SmartEntryForm.tsx`, `components/features/help/FeatureRequestDialog.tsx`, `components/features/help/QuickActions.tsx`, `components/features/integrations/MetaFormManager.tsx`, `components/features/leads/LeadHistory.tsx`, `components/features/leads/LeadMessagesTab.tsx`, `components/features/leads/LeadTrackingSection.tsx`, `components/features/leads/SdrDistributionButton.tsx`, `components/features/pipelines/PipelineSlaSettings.tsx`, `components/features/properties/ImoviewImportDialog.tsx`, `components/features/properties/PropertyFormDialog.tsx`, `components/features/properties/VistaImportDialog.tsx`, `components/features/properties/detail/PropertyAssetDeleteDialog.tsx`, `components/features/properties/detail/PropertyAssetDialog.tsx`, `components/features/round-robin/EditQueueDialog.tsx`, `components/features/round-robin/RuleEditor.tsx`, `components/features/round-robin/RulesManager.tsx`, `components/features/schedule/EventForm.tsx`, `components/features/settings/RolesTab.tsx`, `components/features/teams/TeamCard.tsx`, `components/features/whatsapp/GroupsManagerSheet.tsx`, `components/features/whatsapp/LabelsManagerSheet.tsx`, `components/features/whatsapp/LabelsPopover.tsx`, `components/features/whatsapp/LeadSidePanel.tsx`, `components/features/whatsapp/QuickActions.tsx`, `components/features/whatsapp/QuickMessageTemplates.tsx`.

Superficies de erro/infraestrutura verificadas separadamente: `app/(protected)/error.tsx`, `app/error.tsx`.

Delegacoes `Button asChild` a revisar: nenhuma.

## Rotas

| ID | URL | Acesso | Tipo | Destino do redirect |
| --- | --- | --- | --- | --- |
| `route:c63b5d542d081dae1a83` | `/` | public | estatica | `-` |
| `route:45408a250a26dccacf3a` | `/admin` | protected/admin | estatica | `-` |
| `route:1e54a6ad2ff66aba191d` | `/admin/ai` | protected/admin | estatica | `-` |
| `route:df5e76619ba0825baaa0` | `/admin/announcements` | protected/admin | estatica | `-` |
| `route:64a7e9d6aaadfb3742a0` | `/admin/audit` | protected/admin | estatica | `-` |
| `route:057ca4af26039a96be76` | `/admin/database` | protected/admin | estatica | `-` |
| `route:44e1244534e23ca7cb61` | `/admin/email-logs` | protected/admin | estatica | `-` |
| `route:aed09781c7a37084e4e1` | `/admin/email-templates` | protected/admin | estatica | `-` |
| `route:fcbc8015a7abae83c243` | `/admin/error-logs` | protected/admin | estatica | `-` |
| `route:9c3073f6963a9fe47ed2` | `/admin/help` | protected/admin | estatica | `-` |
| `route:3f53ab6f96a095e672a6` | `/admin/home-content` | protected/admin | estatica | `-` |
| `route:ce76633c90db4ffe575f` | `/admin/notifications` | protected/admin | estatica | `-` |
| `route:33da7930688fd80d72f3` | `/admin/onboarding` | protected/admin | estatica | `-` |
| `route:1fced174a695f29a0bde` | `/admin/organizations` | protected/admin | estatica | `-` |
| `route:95978ce120a3c09e5248` | `/admin/organizations/[id]` | protected/admin | dinamica | `-` |
| `route:0ecaaefd40842fe22289` | `/admin/plans` | protected/admin | estatica | `-` |
| `route:55a336e75e7f2a9be708` | `/admin/requests` | protected/admin | estatica | `-` |
| `route:4a7a456aaf40677d0a01` | `/admin/settings` | protected/admin | estatica | `-` |
| `route:707d9d0390a19e917af9` | `/admin/system-settings` | protected/admin | estatica | `-` |
| `route:a666aa15bbb75e119186` | `/admin/users` | protected/admin | estatica | `-` |
| `route:82e198588d04b57c9fd0` | `/agenda` | protected | estatica | `-` |
| `route:4a23f6eb303a65e43b82` | `/attention` | protected | alias | `/inicio` |
| `route:9cd088e45100d87b467d` | `/automations` | protected | estatica | `-` |
| `route:b9b7c81e53d271e49ea9` | `/cadastro` | auth | estatica | `-` |
| `route:d506f31301c9ad084200` | `/checkout/[token]` | public | dinamica | `-` |
| `route:36763742d0d67c64be9a` | `/checkout/organizacao/[organizationId]` | public | dinamica | `-` |
| `route:e2b7f0942195be1ff653` | `/comprovantes/[token]` | public | dinamica | `-` |
| `route:3f82c429bbe72257ff3c` | `/confirmar-email` | auth | estatica | `-` |
| `route:396d040d0f53d6ae1eb2` | `/contato` | publicSite | estatica | `-` |
| `route:016a3f28727f60e119f9` | `/convite/[token]` | auth | dinamica | `-` |
| `route:9ad85d302163f62dd2a6` | `/crm/contacts` | protected | estatica | `-` |
| `route:0fd7fbfe398bb0ac358c` | `/crm/conversas` | protected | estatica | `-` |
| `route:dc86e96838c7ef79928e` | `/crm/management` | protected | estatica | `-` |
| `route:15818b6ea1843d71467a` | `/crm/management/teams/[id]/edit` | protected | dinamica | `-` |
| `route:38eebfc719842d04c399` | `/crm/management/teams/new` | protected | estatica | `-` |
| `route:7891c3d6187bc64bec1b` | `/crm/pipelines` | protected | estatica | `-` |
| `route:51094c97dd50d4c1c61a` | `/dashboard` | protected | estatica | `-` |
| `route:5dd60420e7bf41830016` | `/dashboard/campaigns` | protected | alias | `/marketing` |
| `route:5ecccbfb33f0888a2a92` | `/dashboard/site` | protected | estatica | `-` |
| `route:0b137290e9869a0d87b7` | `/exclusao-de-dados` | public | estatica | `-` |
| `route:3be113657f53c969c73b` | `/favoritos` | publicSite | estatica | `-` |
| `route:a68a9fc485a413da104b` | `/financeiro` | protected | estatica | `-` |
| `route:f8ae353c97b2143971a0` | `/financeiro/comissoes` | protected | estatica | `-` |
| `route:2086c8ff44294a225544` | `/financeiro/contas` | protected | estatica | `-` |
| `route:2cb1c6c570973c06930d` | `/financeiro/contratos` | protected | estatica | `-` |
| `route:c13491e904c32c018959` | `/financeiro/contratos/[id]` | protected | dinamica | `-` |
| `route:624e58ad78782769307a` | `/financeiro/corretor` | protected | estatica | `-` |
| `route:65572a26ae938380a47f` | `/financeiro/dre` | protected | estatica | `-` |
| `route:cd145b7753921fffd366` | `/financeiro/relatorios` | protected | estatica | `-` |
| `route:d8544863aef11dbff0f9` | `/gamificacao` | protected | estatica | `-` |
| `route:626f9dcbfc5d3fad6ff6` | `/help` | public | estatica | `-` |
| `route:2a85725e51d76dd79782` | `/help/[slug]` | public | dinamica | `-` |
| `route:33bab2b3da3d19185127` | `/imoveis/[[...path]]` | publicSite | dinamica | `-` |
| `route:afbeb66782a7f8384f1d` | `/imovel/[code]` | publicSite | dinamica | `-` |
| `route:6ec8fb11f3d09809eefa` | `/inicio` | protected | estatica | `-` |
| `route:301cff6e74c7200d7307` | `/login` | auth | estatica | `-` |
| `route:13ef8ad4accbd53af4f8` | `/marketing` | protected | estatica | `-` |
| `route:f662b18b27bf14df3dea` | `/notifications` | protected | estatica | `-` |
| `route:5f90c9110e44580c1481` | `/onboarding` | auth | alias | `/cadastro` |
| `route:0233b370a86d721d0c7a` | `/pipeline` | protected | alias | `/crm/pipelines` |
| `route:163894ba0666cc181b43` | `/politica-de-privacidade` | public | estatica | `-` |
| `route:e874539a5895b870985d` | `/properties` | protected | estatica | `-` |
| `route:35522dc528c9d332e37e` | `/properties/[id]` | protected | dinamica | `-` |
| `route:91094461966c868a9eb2` | `/properties/[id]/edit` | protected | dinamica | `-` |
| `route:45dda8f8a9e3d63b9136` | `/properties/condominiums` | protected | estatica | `-` |
| `route:79391f2b4051eb9a4d83` | `/properties/developments` | protected | estatica | `-` |
| `route:4f43a8077b166d28f2aa` | `/properties/developments/[id]` | protected | dinamica | `-` |
| `route:995ec62d517d53288b07` | `/properties/locations` | protected | estatica | `-` |
| `route:7abdaa26c0e2e8963d47` | `/properties/new` | protected | estatica | `-` |
| `route:928bd2664ebdaac64f9b` | `/properties/owners` | protected | estatica | `-` |
| `route:fe24531c9731f083e908` | `/properties/rentals` | protected | estatica | `-` |
| `route:6bcb6e971c4cdde6ebf4` | `/reset-password` | auth | estatica | `-` |
| `route:001a7b3436b762432045` | `/select-organization` | protected | estatica | `-` |
| `route:478db995ffa698fda68a` | `/settings` | protected | estatica | ``/settings/integrations/meta${nextSearch ? `?${nextSearch}` : ""}`` |
| `route:5311f43f9580e51f6201` | `/settings/ai` | protected | alias | `/settings?tab=ai` |
| `route:80723a77ceb91316f5c3` | `/settings/integrations/grupo-olx` | protected | alias | `/settings?tab=grupo-olx` |
| `route:4d668f443cdf67316f08` | `/settings/integrations/meta` | protected | estatica | `-` |
| `route:ee3e2704620b2afdbc3a` | `/settings/site` | protected | estatica | `-` |
| `route:64006dd15b8f9e96ad29` | `/settings/users/[id]` | protected | dinamica | `-` |
| `route:336c91c8701a2a4f939f` | `/sites/[slug]/[[...path]]` | public | dinamica | `-` |
| `route:c12d5b1a5e04f92ac4b3` | `/sobre` | publicSite | estatica | `-` |
| `route:1c6ea1e93bbfb182910b` | `/suporte` | protected | estatica | `-` |
| `route:9c2b3dfe26a56b987bb5` | `/suporte/[slug]` | protected | dinamica | `-` |
| `route:e4d4e347f82b7a11b41f` | `/termos-de-uso` | public | estatica | `-` |
