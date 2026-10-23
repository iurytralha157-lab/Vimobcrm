# Imóveis — correções locais da auditoria de 12/10/2026

Estado: ajustes no checkout principal `D:/Vimob/workspaces/vimob-crm`, sem deploy,
commit, push, execução de migrations, cutover ou alteração de dados/configuração
remota. As verificações locais abaixo não comprovam funcionamento em produção.

## Escopo e preservação

A auditoria abrangeu carteira, formulário novo e edição, proprietários, endereço,
fotos, publicação Site/portais, lançamentos, permissões, filas e saúde dos workers.
As mudanças seguem UI de domínio → hooks → transporte/validação → API Go → banco.
O formulário em etapas e outros ajustes que já estavam em andamento foram
preservados. As primitivas de `components/ui/` e a geometria do wizard
compartilhado não foram alteradas nesta tarefa.

Antes das edições foi guardada uma cópia de 533 arquivos relacionados, hashes,
status e diff preexistente em
`D:/Vimob/tmp/properties-fixes-20261012-fb58fe98`. Isso permite comparar nossa
intervenção com o estado inicial; o diff contra HEAD também inclui trabalho
anterior e de outras frentes. Não usar reset/revert de arquivos inteiros para
desfazer esta tarefa. Branch inicial e final conferida: `main`; HEAD de referência:
`1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.

## Evidência de produção da auditoria, anterior às correções

Leituras do Supabase em 12/10, sem escrita:

- 2.352 imóveis; 2.112 com `published_on_site=true`, dos quais 2.107 sem publicação
  canônica. Essa flag antiga, isoladamente, não comprova entrega pelo worker.
- Cinco publicações Site canônicas prontas/publicadas, seis jobs concluídos e
  nenhum job pendente/com erro no recorte consultado.
- Vetter: 542 imóveis, 527 com flag antiga, nenhuma publicação canônica;
  configuração Site ativa, mas módulo Site desabilitado. 537 imóveis sem
  `descricao_site`, 22 com CEP incompatível e 12 com localização incompleta.
- Entre os 2.112 marcados: 1.245 sem descrição pública, 37 com CEP incompatível,
  31 com localização incompleta e 17 com autorização comercial explicitamente
  negada.
- 68.972 assets públicos; 67.809 fotos ativas em 2.296 imóveis. 1.489 imóveis
  tinham mais de 20 fotos, com máximo de 89; grande parte era importada.
- Logs disponíveis: 30 respostas 500 de upload-intents em 24/09; três respostas
  400 em assets em 07/10; dois conflitos, três 400 de condomínio, um 400 de
  publicação e sete 404 de detalhe. Sem correlação suficiente para atribuir cada
  ocorrência ao problema específico relatado pelo usuário.
- RLS ativo nas tabelas principais e sem direitos de browser nelas. Tabelas
  auxiliares legadas tinham permissões mais amplas. A constatação de grants/RLS
  não foi tratada como prova de exploração pela API REST.

Não habilitamos o módulo Site, preenchemos descrições, corrigimos CEPs em massa,
publicamos imóveis nem migramos automaticamente as flags antigas. Esses dados e
configurações continuam precisando de tratamento explícito no ambiente real.

## Correções por ponto da auditoria

| Ponto | Comportamento corrigido localmente | Verificação e limite |
| --- | --- | --- |
| 1. Site/módulo/worker | Publicação apresenta o motivo do bloqueio. Worker desabilitado recusa nova publicação/revalidação; retirada permanece possível. | Testes de comandos, estado e API. Configuração remota preservada. |
| 2. Flag antiga versus estado canônico | DTO da carteira/detalhe/workspace carrega estado canônico; o legado visível é identificado como publicação pelo fluxo anterior. | Go e schemas/helpers TS. Sem backfill de publicações. |
| 3. Fila/erro mostrados como privado | Cards e central distinguem pendente, atualizando, erro, retirando, pausado e visibilidade atual. | Testes de estado/ações. |
| 4. Edição durante publicação | Snapshot alterado é atualizado no mesmo job durável, com tentativas limitadas, lease, versão e intenção conferidos. | Go; integração PostgreSQL preparada e não executada. |
| 5. Versão antiga encobrindo erro | Uma versão ainda visível não produz mensagem falsa de sucesso para uma atualização que falhou. | Regressões de publicação e respostas do formulário. |
| 6. Dados alterados durante save | Trava síncrona contra duplo clique; seções, fechamento e ações ficam ocupados durante a cadeia de gravação. | Testes de interação e DOM real das seções. |
| 7. CEP sobrescrevendo edição manual | Mudança de CEP/endereço/cidade/bairro/UF invalida a consulta antiga; resposta atrasada não escreve no formulário atual. | Testes de coordenação e aplicação do endereço. |
| 8. CEP lento | Limite total de quatro segundos no servidor, fallback antecipado e cancelamento; cliente tem limite e mensagem utilizável. | Testes do transporte com respostas simuladas. Sem medir latência dos provedores reais. |
| 9. Validação de edição | Zod valida create/update antes da mutation; negativos, frações indevidas e status desconhecido apontam campo/etapa. | Schemas, modelo e navegação do formulário. |
| 10. Proprietário trocado | Seleção substitui todos os contatos, incluindo vazios; proprietário existente não exige recriar contato inline. | Regressões de seleção e privacidade. |
| 11. Fotos/metadados e conflito | Atualização de mídia rebaseia apenas fotos/visibilidade; conserva rascunho dos demais campos e mantém conflito quando há mudança externa real. | Testes de hidratação/concurrency. |
| 12. Resposta perdida no cadastro | Intenção UUID e corpo imutável são salvos antes do POST; chave é isolada por ator/organização. Replay retorna o mesmo ID e corpo diferente conflita. | Node e Go; concorrência real em banco não executada. |
| 13. Galerias importadas grandes | Inicialização limitada e carregamento progressivo; acervo acima de 20 não é truncado, novas inclusões respeitam capacidade. | Testes de mídia/capacidade/preview. |
| 14. Fotos pelo celular | Preparo local com dimensão máxima 2.048px e alvo de 2MB; transparência/animações têm tratamento próprio; HEIC depende de decodificação disponível. | Foto JPEG real 3.000px → 2.048px em Chromium. Safari/iPhone físicos não verificados. |
| 15. Formulário compacto | Grades usam largura do container; no celular navegação horizontal compacta, ações em duas colunas, campos 16px e preview/histórico acessíveis. | 30 combinações de seção/viewport, sem overflow em 320/390/1280px. |
| 16. Valores/status/consentimento | Centavos preservados, campos inválidos não viram null silenciosamente; aliases privados continuam privados. Negação comercial explícita bloqueia leitores públicos e feed OLX. | Modelo/schema, Go e consumidores Edge. |
| 17. Lançamentos | Edição de cadastro de empreendimento/fase/bloco/planta com whitelist e CAS; estrutura fechada bloqueia geração/reserva/publicação. Responsável precisa de vínculo ativo no tenant. | Go e schemas/scope. Integrações com banco preparadas, não executadas. |
| 18. OLX | Disponibilidade e autorização comercial atuais vetam exposição, inclusive quando há snapshot publicado anterior. Status desconhecido não é promovido a disponível. | Testes do feed e leitores públicos. Sem envio a portal. |
| 19. Auxiliares Supabase | Migration/cutover preparados para retirar mutações diretas do browser e restringir leitura aos acessos de imóveis. | Revisão SQL/ACL/RLS; nenhum SQL aplicado. |
| 20. Workers/saúde/transações | Claim unitário, deadline por job, recuperação de panic e progresso verificável em readiness. Histórico opcional usa savepoint sem corromper a transação principal. Expiração de reservas tem limite e recovery. | Pacotes Go/health/app. Readiness não prova entrega nem ausência de backlog. |

Casos adicionais identificados na revisão das correções:

| Caso | Ajuste |
| --- | --- |
| Busca limitada aos primeiros mil imóveis | Picker consulta o servidor com filtros e paginação, sem segunda filtragem contraditória; somente selecionados são carregados por ID. Consumidores de leads foram adaptados. |
| Erro de busca confundido com vazio | Picker mostra erro/repetição, exige acesso resolvido e descarta cache ao perder permissão ou mudar tenant. |
| Troca de ator/tenant durante autenticação ou upload | Intenção de transporte confere ator e escopo imediatamente antes do fetch; mídia/publicação param follow-ups após mudança. Os cinco comandos de assets capturam a ação no clique, incluindo alteração, exclusão, ordenação e foto principal. Compensação não acontece sob outro ator; paths pendentes ficam preservados. O preparo local de fotos também usa o escopo original. |
| Exclusão após cadastro com resposta perdida | Recibo independente mantém tombstone após DELETE, sem TTL. A mesma chave retorna 410 e não recria o imóvel. |
| ID confirmado apontando para imóvel excluído | GET de recuperação exige capacidade de criação atual, ator/tenant/módulo/billing frescos. Somente `410 property_creation_resource_removed` libera confirmação local; 403/404/timeout conservam a proteção. Rascunho é preservado e novo cadastro exige outro salvar explícito. |
| Storage local corrompido ou de outro escopo | Intenção/recibo não vazio inválido falha fechado. Recibo valida ID, organização e ator; memória/loading antigos são invalidados sem apagar chaves de outros escopos. |
| Manutenção de lançamento com refetch/409 | Rascunho do diálogo permanece congelado; reload exige descarte explícito. Ator/organização/permissão alterados invalidam a sessão de edição, inclusive A→B→A. |

## Principais arquivos

- Formulário: `components/features/properties/PropertyFormScreen.tsx`,
  `property-form/sections/`, `property-form/property-form-*.ts`,
  `property-form/PropertyFormAside.tsx`, `property-form/property-form-fields.module.css`.
- Coordenação e cadastro: `lib/properties/property-creation-intent.ts`,
  `property-creation-recovery.ts`, `property-form-submission.ts`,
  `hooks/properties/use-property-form-scope.ts`, `lib/api/properties.ts`.
- CEP: `hooks/properties/use-property-cep-lookup.ts`,
  `lib/api/property-cep-client.ts`, `lib/api/property-cep.ts` e BFF existente.
- Fotos: `ImageUploader.tsx`, asset manager/dialog do domínio,
  `lib/property-photo-preparation.ts`, `lib/property-media-execution.ts`,
  `lib/api/property-media.ts`, `lib/api/property-workspace.ts`,
  `hooks/properties/use-property-asset-mutation.ts`, `use-property-workspace.ts`.
- Publicação: `apps/api/internal/publications/`, projeções de propriedades,
  leitores Site/portais/Edge e `components/features/properties/publication/`.
- Lançamentos: `apps/api/internal/developments/maintenance*.go`,
  `inventory_availability.go`, UI de manutenção e hook/API/schema correspondentes.
- Criação/transação: `apps/api/internal/properties/creation_idempotency.go`,
  `creation_recovery.go`, `optional_transaction.go` e testes relacionados.
- Dependências necessárias: consumers de picker em leads; readiness em
  `apps/api/internal/app/` e `health/`; projeções públicas Site/Edge/OLX.

O `PropertyFormScreen` legado já excedia 800 linhas e recebeu coordenação necessária
para proteger o fluxo completo existente. Helpers novos foram separados; a divisão
posterior adequada é por hidratação/recuperação, envio e catálogos. Não fizemos
refatoração completa junto às outras mudanças em andamento.

## Banco preparado, pendente de execução

Arquivos novos criados pela CLI, sem reescrever migrations históricas:

1. `supabase/migrations/20261012212534_harden_property_creation_and_auxiliary_access.sql`:
   índice/imutabilidade da reserva de criação e direitos das tabelas auxiliares.
2. `supabase/migrations/20261012223804_persist_property_creation_receipts.sql`:
   recibos privilegiados por tenant/ator/hash, FK que conserva tombstone ao excluir
   imóvel, captura de inserts de réplicas antigas e backfill defensivo.

O backfill aborta ledger legado inválido/duplicado. Reservas já apagadas antes da
introdução dos recibos não podem ser reconstruídas sem histórico externo. O recibo
não tem expiração automática; remover essa proteção reabre risco de criação tardia.
Novas tabelas têm RLS e grants mínimos, sem acesso do browser. Os dois hashes foram
adicionados individualmente ao source-lock, preservando entradas de outras frentes.

Cutover separado: `supabase/cutovers/20261012_property_auxiliary_gateway.sql`.
Contratos: `supabase/tests/property_creation_and_auxiliary_gateway.sql` e
`supabase/tests/property_creation_receipts.sql`.

A fixture descartável planejada era
`vimob_properties_fixes_20261012_fb58fe98`, somente loopback e dados sintéticos.
A consulta de preparo falhou com timeouts de Docker/Postgres **antes de criar o
banco**. Não reiniciamos serviços/containers de outros trabalhos. Portanto não
houve execução dos novos SQLs, cutover, backfill nem testes de integração reais.

## Verificações

Resultados finais e comandos estão registrados na seção abaixo; logs de apoio
ficam na pasta temporária citada no início. Erros de outras frentes são apontados
com seu escopo, sem alterar aqueles arquivos para tornar o gate verde.

| Comando/gate | Resultado observado |
| --- | --- |
| `npm run test:property-ui` | 164/164 aprovados; zero pulos. Modelo, validação, CEP, recuperação, publicação, manutenção e hidratação. |
| `npm run test:property-media` | 22/22 aprovados; zero pulos. |
| `npm run test:property-edge` | 22/22 aprovados; zero pulos. |
| `npm run test:property-ui:runtime` | 8/8 aprovados; zero pulos. Seções reais/Radix/wizard/preview em Chromium, com dados/auth/shell simulados e rede bloqueada. Não é E2E da aplicação/backend. |
| `npm run test:property-picker:runtime` | 11/11 aprovados; zero pulos. Hook e diálogo reais com transporte/permissões simulados. |
| `npm run test:property-media:scope` | 26/26 aprovados; zero pulos. APIs e cinco hooks reais em harness com auth/transporte simulados, incluindo comandos na fila, ABA, retorno tardio e compensação sob o ator original. |
| Go: `properties`, `developments`, `publications`, `portals`, `site`, `health` | Seis pacotes aprovados. 21 integrações com banco foram puladas no conjunto; não contam como aprovadas. |
| Go: pacote `app` completo | Uma falha: `TestNotificationDispatchWorkerIncludesBoundedWhatsAppWaitingSubqueue`, no contrato de protocolo da subfila WhatsApp (`notification_worker_contract_test.go:87`). Consulta migrations/outbox fora destes ajustes. Compile e testes focados de readiness de imóveis passaram. |
| TypeScript com `tsconfig.typecheck.json` | Última rodada global aprovada, código de saída 0 (log `typecheck-recheck.log`). Complemento da última extensão de mídia também aprovado, 701 arquivos, código 0 (`typecheck-media-final.log`). Rodadas anteriores capturaram erros transitórios de Contatos/WhatsApp/distribuição na árvore em edição. |
| ESLint do domínio | Rodada abrangente aprovada, código 0; warning de dependência de tenant em manutenção corrigido. Complemento final de mídia/formulário aprovado, código 0, zero erros e warnings (`lint-last-media.log`). |
| `npm run lint` global | Rodada anterior encontrou `prefer-const` em `_shared/google-calendar-delivery.test.ts` e warnings de outras frentes. Não fizemos alteração nesses arquivos para passar o gate. |
| Source-lock de migrations | Hashes das duas migrations de imóveis conferidos individualmente. Gate global encontrou hashes divergentes das migrations de push-device e recibos de importação de contatos; preservados para seus responsáveis. |
| Inventário Edge Functions | Manifestos dos três consumidores de imóveis atualizados sem mudar status/`verify_jwt`. Gate global aponta divergência de source em `evolution-go-webhook`, fora do ajuste. |
| `npm run audit:check` | Inventários gerais `crm-surface-inventory.json/.md` desatualizados perante a árvore em edição. Não regenerados para consolidar incidentalmente mudanças de outras frentes. |
| `git diff --check` nos caminhos revisados | Aprovado; aviso de normalização CRLF/LF sem erro de whitespace. |

Testes PostgreSQL/SQL, concorrência real de recibos e refresh de worker, permissões
via Data API real, portal externo e produção: **não executados nesta implementação**.
A revisão independente encontrou e corrigiu casos negativos de recibo corrompido,
exclusão tardia, troca de tenant/ator e preparo de fotos ao trocar de etapa.

## Condições antes de qualquer implantação futura

Esta tarefa não autoriza implantação. Quando houver pedido específico:

1. Reconciliar ledger/alvo seguindo `supabase/README.md`; **db push permanece
   bloqueado**. Verificar schema real, inclusive pendências antigas de upload.
2. Executar migrations em ordem e contratos/integrações numa fixture descartável
   funcional; revisar lock, planos de índices, ACL/RLS e compatibilidade com a
   versão anterior da API. Manter recibos/tombstones durante rollback de código.
3. Preparar e revisar cutover de auxiliares separadamente. Registrar grants e
   policies anteriores; restaurar somente o delta necessário se houver rollback.
4. Ativar backend com recibos já presentes antes de usar criação com chave no
   frontend. Reversão de frontend exige impedir reenvio sem chave de intenções
   pendentes. Não remover recibos para contornar conflito.
5. Verificar no ambiente escolhido publicação nova, atualização concorrente,
   retirada/privacidade, consentimento negado, foto/CEP, dois tenants e perda de
   permissão. Confirmar URL pública e resultado durável do worker, além de `/readyz`.
6. Validar Safari/iOS, aparelhos reais, rede lenta e capacidade. Os testes atuais
   não mediram carga de 5–6 mil usuários nem validaram integração externa real.

As correções de código não resolvem sozinhas módulo desabilitado, cadastro legado
incompleto ou schema remoto faltante. Esses pontos ficaram identificados sem
publicação automática ou alterações de configuração/dados nesta entrega.
