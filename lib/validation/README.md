# Validação do frontend

Esta pasta contém os contratos Zod de entrada e resposta usados pelos clientes
em `lib/api/`, hooks e formulários. Os schemas validam dados; transporte HTTP,
cache, efeitos e regras de negócio têm seus próprios donos.

## Localizar o contrato

Use o módulo do domínio ou fluxo que possui o dado. Exemplos:

| Módulo | Contratos |
| --- | --- |
| `leads.ts` | Cadastro, edição e listagem de leads |
| `lead-details.ts` | Detalhe de conversa, anexos, enriquecimento, metadados, tarefas e visibilidade |
| `pipelines.ts` | Funis, etapas, automação de etapa, operação e SLA |
| `property-catalogs.ts` | Tipos, características, localidades, proprietários e resumos de imóveis |
| `properties.ts`, `property-workspace.ts` | Imóvel e workspace de edição |
| `public-site.ts` | Contato, tracking, consultas e respostas do site público |
| `organization-sites.ts` | Configuração, domínio, menu, filtros e imagens do site |
| `site-performance.ts` | Consultas e respostas de PageSpeed |
| `billing-checkout.ts` | Checkout, sessão local de cobrança e consultas/mutações de pagamento |
| `message-templates.ts` | Modelos de mensagem |
| `audit.ts`, `error-events.ts` | Auditoria e telemetria de erros |
| `realtime.ts` | Envelope genérico de eventos |
| `webhooks.ts` | Webhooks e entrada de leads pela API pública |
| `integrations.ts` | Integrações e catálogo de campanhas Meta |
| `users.ts` | Usuários e seus resumos |
| `search-filters.ts` | Colunas permitidas e limites de filtros |

`common.ts` mantém os primitivos e adaptadores gerais já públicos.
`shared-schema-values.ts` é um detalhe interno dos contratos extraídos de
`auxiliary.ts`: preserva as mesmas instâncias de valores compartilhados e não é
reexportado pelo índice público.

## Compatibilidade de imports

`auxiliary.ts` é uma fachada de compatibilidade: reexporta explicitamente os
mesmos 113 nomes anteriores a esta organização. `index.ts` mantém a entrada
pública existente, inclusive os imports legados de `@/lib/validation`.

Para um contrato novo, escolha seu módulo dono:

```ts
import { leadTaskCreateInputSchema } from '@/lib/validation/lead-details'
```

Não acrescente contratos de negócio à fachada `auxiliary.ts`. Não mova nem
renomeie consumidores antigos incidentalmente. Os módulos de domínio não
devem importar a fachada ou o índice que os reexporta, pois isso cria ciclos.

## Preservar o comportamento

Um nome parecido não garante o mesmo contrato. Preserve `strict`,
`passthrough`, transformações, refinamentos, limites, tratamento de Unicode e
diferenças entre campo omitido, `null` e texto vazio. Por exemplo, os
`optionalUUID` de integrações e dos contratos extraídos aceitam valores
diferentes e permanecem separados.

A divisão de arquivos não altera endpoints, campos, permissões ou regras do
backend. Novos contratos ou mudanças de comportamento exigem testes com dados
sintéticos e validação dos consumidores pertinentes.

## Verificação

- `npm run validation:test`: contratos de entrada e resposta existentes.
- `node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/validation/lead-feedback.runtime.test.mjs`: executa os refinamentos de feedback e conclusão de tarefa do código de produção.
- `npm run typecheck` e `npm run lint`: imports, tipos e verificações estáticas.

Testes runtime que leem declarações devem buscar o módulo dono e manter suas
asserções de comportamento; a fachada não contém cópias dos schemas.
