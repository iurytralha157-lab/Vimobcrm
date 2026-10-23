# WhatsApp — fechamento local de CI e lint

Checkout principal: `D:/Vimob/workspaces/vimob-crm`, branch `main`,
HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
O checkout já continha trabalho de outras tarefas. Evidências e snapshots:
`D:/Vimob/tmp/whatsapp-ci-lint-close-20261015/`.

Sem commit, push, publicação de imagens, deploy, migração remota ou envio real.
Os testes usam somente PostgreSQL descartável com dados sintéticos e transporte
simulado. Não houve leitura de `.env` real nem uso de banco/provedor de produção.

## Alterações

1. `scripts/supabase/queue-editor-contract.mjs`: renomeação local de `module`
   para `schemaModule`, em quatro linhas, para cumprir
   `@next/next/no-assign-module-variable`. O parâmetro literal `module` do
   executor CommonJS, a compilação e as validações foram preservados.
2. `scripts/tests/whatsapp-ci-sql-source.mjs`: atualização de somente dois pins,
   depois de revisão integral e conferência contra source-lock, manifesto e
   cópias da homologação do produtor de filas. Nenhum SQL foi reescrito.
3. `scripts/tests/whatsapp-ci-sql-source.test.mjs`: dois casos adicionais
   verificam recusa de SQL duplicado e mudanças em organização, validação da
   semana, geração de vínculo, `auth.uid()`, RLS e grants. Os testes anteriores,
   a comparação exata dos bytes e a rejeição de drift permanecem.
4. Inventários derivados de superfícies e estilos: regeneração em staging,
   validação e promoção com conferência dos fontes e dos relatórios de destino.
   Nenhuma regra dos geradores, teste de contrato ou tela é alterada por isso.
   Três arquivos foram atualizados; `home-design-debt.md` permaneceu idêntico.
   A revisão independente confirmou que os IDs/linhas deslocados correspondiam
   às duas interfaces do WhatsApp ajustadas anteriormente, sem mudança nas
   contagens, CTAs ou políticas de acesso.

| Dependência canônica | Pin revisado SHA-256, normalizado LF |
|---|---|
| `20261015022236_queue_operating_schedule_contract.sql` | `8d65e69ae4b910de960bd663cbc582aebf43774ec26eb6fac5226f3ffc97174b` |
| `20261015022536_queue_runtime_state_and_audience.sql` | `facf3823241e589d70f0ee36136cba44e62c4e58f0824e0a2f552f71bb5661ad` |

Esses hashes já constavam nas evidências anteriores às correções forward da
fila. O runbook do produtor declara preservadas as seis migrações iniciais.
Os dois arquivos são materializados integralmente, sem omissões ou stubs.
O bootstrap confere a lista antes da primeira escrita e o hash antes de aplicar
cada fonte. Mudanças posteriores voltam a ser rejeitadas.

As onze migrações do motor de filas e o source-lock foram preservados.
O gate do WhatsApp usa somente as duas dependências de leitura citadas; não
comprova as nove migrações posteriores, o motor completo ou a cadeia histórica.
Ver [contrato de filas](queue-runtime-local.md).

## Verificação

Gate requerido `all`: aprovado integralmente, sem skips, cancelamentos ou
alteração dos 130 arquivos monitorados durante a execução. `npm run audit:check`
aprovado com quatro testes de contrato, sem pulos; fontes/parser e destinos
permaneceram estáveis durante staging e promoção. Lint global aprovado com zero
erros e sete avisos preexistentes em testes/scripts de filas e propriedades.
Esses avisos não bloqueiam o comando existente e não foram suprimidos ou
alterados como parte desta correção. As migrações e o manifesto de Edge
Functions também passaram nas verificações de integridade.

| Fase do gate novo | Resultado |
|---|---|
| Node | 152/152 |
| SQL | 153 asserções pgTAP, mais asserções por exceção de respostas rápidas |
| Manutenção Node com banco | 15/15 |
| Go | 52 principais / 121 contando subcasos |
| Interfaces e hooks | 338/338 em 14 arquivos |
| Limpeza | Cluster próprio encerrado pelo helper; dados/artefatos preservados |

- Reprodução inicial: duas falhas de pins; lint focal com um erro.
- Após correções: 13/13 testes focados de fonte; teste do editor 1/1;
  lint focal sem erros ou avisos.
- Integridade das migrações e manifesto de Edge Functions aprovados.
- A primeira conferência dos inventários detectou relatórios desatualizados:
  nenhuma colisão de rota, ID duplicado ou falha de invariante. O contrato de
  repetibilidade comparava o índice novo ao relatório antigo. Os achados
  estáticos de estilo não foram tratados como autorização para alterar o visual.

Comando do gate requerido, executado por wrapper com ambiente fechado:

```powershell
node scripts/tests/whatsapp-ci-run.mjs all D:/Vimob/tmp/whatsapp-ci-lint-close-20261015/full-ci/vimob-whatsapp-ci D:/Vimob/tmp/whatsapp-db-validation-20261013/runtime/pgsql/bin
```

É uma execução nova de `all`, sem reutilizar o cluster ampliado da rodada
anterior. O helper recusa diretório existente ou porta ocupada e verifica
loopback, `system_identifier`, diretório, nonce, `fsync` e `synchronous_commit`.
Instala 77 migrações focais / 84 fontes e encerra somente seu próprio cluster.
Não há recortes adicionais de papéis ou funções de distribuição nesse ensaio.

As provas finais devem combinar `root/all-proof.json`,
`full-ci/vimob-whatsapp-ci/results/summary-all.json`, logs de cada fase,
`cleanup.json`, lint e o manifesto final. Um fragmento verde ou teste pulado
não substitui a aprovação integral.

Fechamento conferido em `root/final/proof.json`, com os deltas e os hashes de
destino. O estágio dos relatórios está em `inventory-staging/candidate-1/`.
As duas falhas de pins, o lint anterior e a primeira conferência dos inventários
continuam registrados; os resultados aprovados não apagam essas reproduções.
Os arquivos das seis correções de envio/sincronização da rodada anterior,
as onze migrações de filas, o source-lock e o workflow foram preservados.

## O que ainda falta para publicar

1. Concluir e congelar o corte conjunto com as filas, revisar os deltas e obter
   um SHA reproduzível. A árvore compartilhada com alterações locais ainda não
   é um artefato de publicação. Preservar os pré-requisitos das onze migrações
   do produtor, sem iniciar API nova sobre banco incompatível.
2. Executar nesse SHA os quatro jobs Linux do workflow: `release-gates`,
   `invitation-integration`, `membership-access-integration`,
   `whatsapp-contracts`; depois produzir imagens Web/API compatíveis.
   Aprovação local Windows não substitui o resultado GitHub nem o build.
3. Em alvo ou cópia fiel autorizada, conferir ledger/schema, sequência de
   migrações, versões e configuração efetiva dos workers, índices, épocas,
   allowlists, Evolution e alertas. O ensaio focal não comprova backfill sobre
   mensagens existentes nem resolve divergência do ledger remoto. Não executar
   `db push` enquanto o bloqueio documentado não for conferido e resolvido.
4. Fazer canário autorizado com Evolution e Realtime reais: envio e recebimento
   pela Pipeline, detalhe, balão e Conversas; conta própria/compartilhada,
   reconexão, ordem, mídia, callbacks, permissões e dois tenants. Conferir mobile
   físico/Safari/PWA/teclado e acompanhar idade da fila, erros e duplicações.
   Só então iniciar rollout gradual com imagens/configuração anteriores e
   rollback compatível. Não retroceder época ou schema automaticamente.

## Reversão local

Usar somente o inverso dos deltas desta rodada, conferindo os hashes contra os
snapshots. Relatórios derivados podem ser regenerados a partir do corte escolhido.
Não restaurar arquivos inteiros pelo HEAD nem mexer nas fontes do produtor.
Os resultados RED e os relatórios anteriores foram preservados como evidência.
