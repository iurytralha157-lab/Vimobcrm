# Dívida visual em relação ao padrão Home

Este relatório é gerado por `scripts/audits/inventory-home-design-debt.mjs`.

Ele prioriza candidatos a revisão; não substitui inspeção renderizada. Cores que codificam dados, status e gráficos não devem ser removidas mecanicamente.

## Resumo

- Arquivos analisados: 362
- Arquivos com achados: 4
- Achados: 16
- Arquivos protegidos/mistos com achados: 3
- Achados alcançáveis pelo CRM protegido: 15
- Distribuição por superfície: protected-only 15, protected-and-public 0, public-only 1, infraestrutura 0
- P1: 1
- P2: 0
- P3: 15

## Regras

| Prioridade | Regra | Quantidade | Direção |
| --- | --- | ---: | --- |
| P1 | Sombra forte | 0 | Usar shadow-none ou a sombra sutil dos pop-ups globais. |
| P2 | Sombra fora do padrão | 0 | Blocos Home não usam sombra; validar se a elevação é realmente necessária. |
| P1 | Raio acima de 8px | 1 | Blocos usam 8px; controles 6px; microelementos 4px. |
| P1 | Tipografia pesada | 0 | Texto normal usa 300; títulos usam 400. |
| P1 | Cor hardcoded | 0 | Usar tokens --app-* ou cores semânticas do domínio. |
| P2 | Superfície branca/preta fixa | 0 | Usar --app-surface-solid, --app-surface-soft ou --app-surface-hover. |
| P2 | Movimento agressivo | 0 | Remover scale/translate decorativo de cards e ações operacionais. |
| P3 | Caixa alta/tracking | 15 | Preferir texto natural em 10–12px e peso 300. |
| P2 | Blur no painel | 0 | O overlay pode escurecer; o painel deve usar superfície sólida. |

## Arquivos prioritários

### CRM protegido e componentes compartilhados

| Arquivo | Score | Achados | Distribuição |
| --- | ---: | ---: | --- |
| `components/features/properties/detail/PropertyWorkspaceSections.tsx` | 8 | 8 | uppercase-tracking: 8 |
| `components/features/properties/detail/PropertyWorkspaceOverview.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/properties/PropertyWorkspaceScreen.tsx` | 3 | 3 | uppercase-tracking: 3 |

### Todas as superfícies

| Arquivo | Score | Achados | Distribuição |
| --- | ---: | ---: | --- |
| `components/features/properties/detail/PropertyWorkspaceSections.tsx` | 8 | 8 | uppercase-tracking: 8 |
| `components/features/properties/detail/PropertyWorkspaceOverview.tsx` | 4 | 4 | uppercase-tracking: 4 |
| `components/features/properties/PropertyWorkspaceScreen.tsx` | 3 | 3 | uppercase-tracking: 3 |
| `components/features/auth/AuthSplitLayout.tsx` | 3 | 1 | oversized-radius: 1 |
