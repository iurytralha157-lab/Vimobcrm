# Mensagem do valor obrigatório no lançamento financeiro

Achado `R2-FIN-VALIDATION` (alias técnico
`R2-FINANCIAL-ENTRY-VALUE-MESSAGE`), rodada de 15/11/2026, base `f6f8d136`.
Os dois identificadores representam o mesmo achado. Não conclui a auditoria
financeira nem altera a regra F09.

## Causa e reprodução

Na interface de testes, enviar um lançamento vazio exibiu categoria, descrição
e data em português, mas o campo Valor mostrou a mensagem padrão em inglês de
tipo numérico inválido. A validação bloqueou o envio; não houve criação de conta.

`FinancialEntryForm` transforma o input vazio em `undefined`. Seu schema local
usava `z.number()` sem mensagem de erro de tipo; o texto em português estava
somente no limite mínimo. Portanto, ausência e tipos inválidos não alcançavam a
mensagem do mínimo. `FinancialEntriesScreen` é o consumidor do formulário para
criação e edição.

## Alteração

Somente a mensagem de erro do número foi configurada no schema proprietário:
ausência informa `Valor é obrigatório`; outros tipos inválidos, NaN e infinitos
informam `Informe um valor numérico válido`. Continuam obrigatórios número finito
e mínimo de R$ 0,01, com a mensagem de limite existente. Não há coerção de string,
valor padrão, arredondamento ou mudança de valores aceitos.

API, persistência, status, pagamentos, recorrência, parcelamento e cálculo de
vencidos/inadimplência permanecem inalterados. Não foi extraído um schema ou criada
uma camada para essa edição pequena no proprietário existente.

## Verificação

O teste carrega o initializer completo do schema real por AST e executa Zod 4 e
o resolver React Hook Form reais, sem montar a UI ou chamar mutações. Cobre
ausente/undefined, NaN, null, strings, boolean, array, objeto, infinitos, zero,
negativo, limite inferior, valores válidos e saída do resolver. Inválidos não
geram valores para submissão; os controles numéricos válidos mantêm o número.

Reprodução: 22 casos, 15 falhas de mensagem e sete controles aprovados. Após a
correção: 22/22, zero skip. Esses 22 casos integram o runner existente
`test:form-wizards`; não devem ser somados novamente ao total desse runner.
O job `whatsapp-contracts` já o executa antes do build. Não há novo job ou
dependência. A revisão independente do código e dos 22 casos foi aprovada.

Comandos desta verificação:

```text
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test components/features/financial/financial-entry-value.runtime.test.mjs
npm run test:form-wizards
npm run typecheck
npm run lint
npm run audit:check
```

Os gates locais do conjunto foram conferidos:

| Verificação | Resultado |
| --- | --- |
| Ensaio focado | 22/22, zero skip |
| `test:form-wizards` | 82/82, zero skip; inclui os 22 casos novos |
| Typecheck | exit 0 |
| Lint | exit 0, zero erros e oito avisos preexistentes |
| `audit:check` após inventários canônicos | 4/4, zero skip |
| `git diff --check` | exit 0 |

Os inventários foram regenerados em ordem pelo escritor de superfícies CRM e
depois pelo escritor de dívida da Home. Não há alegação de CI ou publicação.

## Limites e reversão

A evidência visual registra o erro anterior. O teste novo comprova schema e
resolver; não comprova o reteste visual de produção, carga ou PostgreSQL.
A mensagem pode ser retestada após release com envio vazio e sem gravação.

Reverter o commit específico restaura as mensagens anteriores, incluindo teste
e entrada no runner; regenerar os inventários após a reversão. Não é necessária
migration, correção de dados, transação financeira ou alteração de configuração.
