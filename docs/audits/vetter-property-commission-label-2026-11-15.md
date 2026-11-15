# Unidade da comissão na ficha do imóvel

Registro técnico do achado `R2-PROPERTY-COMMISSION`, de 15/11/2026.
Este registro não conclui a auditoria visual do CRM.

## Evidência e causa

Na organização de testes, um imóvel sintético foi cadastrado com comissão de
venda `6`, mantendo o tipo de comissão vazio. O formulário mostrava `%`, mas a
aba Comercial da ficha mostrava `R$ 6`. Uma leitura autorizada da própria
fixture confirmou `tipo_comissao = NULL`, `comissao_venda = 6` e
`commission_percentage = NULL`. Nenhum valor foi corrigido diretamente no banco.

`CommissionsSection` usa percentual quando o tipo não é `valor_fixo`, inclusive
para o padrão vazio. O formulário e seu transporte preservam o número informado.
`CommercialConditions`, porém, passava as comissões de venda e locação para um
formatador monetário incondicional, que também ocultava zero.

## Alteração e alcance

As duas linhas da ficha agora seguem a mesma unidade do formulário: percentual
no padrão existente e moeda quando `tipo_comissao = valor_fixo`. O ramo monetário
reutiliza `formatPropertyMoney`; zero permanece explícito e valores ausentes
continuam omitidos. O consumidor é `PropertyWorkspaceScreen`.

Não há mudança de cálculo, persistência, DTO, autorização, schema, oferta ou
publicação. `commission_percentage`, divisão de comissão e demais custos mantêm
seus contratos. A projeção do servidor continua responsável por remover campos
internos de quem não pode vê-los; a renderização não recria campos ausentes.

## Reprodução e regressão

O teste SSR carrega o componente, `PropertyFieldGrid`, `filledFields` e o
formatador reais, seguindo o harness existente do histórico. Somente shells
visuais não envolvidos na regra são substituídos. Os seis casos cobrem
percentual de venda/locação, valor fixo, tipo omitido/nulo/vazio, zero nos dois
modos, valores ausentes e projeção sem campos internos.

Antes da correção, três casos falharam e três passaram; depois, os seis passaram.
O ensaio focado com os dois casos existentes de histórico passou 8/8, sem skip.
Esses números pertencem à base isolada `7f80251f` e não substituem a verificação
do conjunto integrado.

O novo arquivo foi acrescentado a `test:form-wizards`, já executado no job
`whatsapp-contracts` antes do build das imagens. Não foi criado job, instalada
dependência ou reduzida verificação existente.

## Verificação integrada

Base de integração: `00d1a1ed`, contendo também a alteração de rótulo de resultado
da Agenda. Os inventários canônicos são regenerados após a integração dos fontes.
Os resultados locais deste conjunto integrado foram conferidos:

| Verificação | Resultado |
| --- | --- |
| Typecheck | exit 0 |
| Lint | exit 0, zero erros e oito avisos preexistentes |
| `test:form-wizards` | 60/60, zero skip; inclui os seis casos novos |
| Dialogs/contratos SCHED | 34/34, zero skip |
| `audit:check` | 4/4, zero skip |
| `git diff --check` | exit 0 |

Os seis testes novos são subconjunto dos 60, não uma soma adicional. Houve
revisão independente do componente e do teste SSR. Não há alegação de CI ou
deploy deste delta, nem de teste PostgreSQL nesta verificação de apresentação.

Comandos de referência:

```text
npm run typecheck
npm run lint
npm run test:form-wizards
npm run audit:check
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test components/features/dashboard/dashboard-dialogs.runtime.test.mjs lib/validation/dashboard-visits.test.mts lib/schedule-outcome.test.ts
```

## Limites e reversão

A prova de produção registra o comportamento anterior; a correção ainda exige
publicação aprovada e reteste visual. SSR não representa E2E, teste de carga ou
validação PostgreSQL. Nenhum teste financeiro ou regra de cálculo foi alterado.

A reversão consiste em reverter o commit específico quando integrado, incluindo
o teste e sua entrada no script, e regenerar os inventários. Não requer migration,
mudança de dados, flags ou configuração remota.
