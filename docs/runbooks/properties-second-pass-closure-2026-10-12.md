# Imóveis — fechamento local dos 14 achados da segunda auditoria

Correções dos 14 pontos implementadas no checkout principal `D:/Vimob/workspaces/vimob-crm`, sem deploy, commit, push, migrations ou alterações remotas. Testes focados e revisão independente concluídos. Os gates gerais e as integrações PostgreSQL ainda têm pendências descritas abaixo; não é uma declaração de validação em produção nem de prontidão para release.

Origem: [segunda auditoria](D:/Vimob/workspaces/vimob-crm/docs/audits/properties-second-pass-2026-10-12.md). O relatório original preserva a descoberta; a tabela abaixo acompanha a correção. Os ajustes da primeira rodada e das outras frentes foram preservados.

## Correções por achado

| Ponto | Comportamento implementado | Evidência local |
| --- | --- | --- |
| 01 — Ator/intenção | Comandos capturam usuário, sessão, organização e acesso no gesto; token resolution não troca o ator do comando. Ofertas, chaves, vínculos, CRUD, localidades, proprietários e catálogos usam guardas no transporte e callbacks. Assets também verificam nova sessão do mesmo usuário. | 36 testes do transporte real com autenticação/fetch simulados; 30 testes runtime dos hooks, incluindo troca de ator e nova sessão A→A. |
| 02 — Reservas | Criar/repetir/prorrogar/cancelar/converter exige a regra de uso do lead em mutação, coerente com `can_operate`. Leitura ampla não concede operação. | Negativos de duas organizações e lead de outra equipe; pacote Go. |
| 03 — Mídia pública | Resolver aplica estado comercial e organização atuais; exige Site ativo somente no canal Site. Mantém vínculo de versão/asset/hash, visibilidade e retirada canônica. | Contratos Go; teste SQL preparado com relações temporárias e banco loopback estritamente identificado, ainda não executado. |
| 04 — Privacidade da IA | Consultas carregam os controles de endereço; projeção legada usa privacidade mínima/parcial/completa antes de alimentar a IA. | Testes de IA com bairro/endereço sintéticos e comparação de projeções. |
| 05 — Retirada posterior | Formulário captura a revisão comercial antes de salvar. Follow-up e recuperação conservam a intenção original; retirada/pausa posterior bloqueia publicação automática, inclusive após conflito. | Testes do helper real com save→retirada→follow-up e conflito/replay. |
| 06 — Precisão numérica | Leitura canônica distingue ponto decimal de entrada brasileira. Hidratar/salvar conserva `82.125`; sinal/exponente/entrada inválida não viram outro valor positivo silenciosamente. | Round-trip, moeda, áreas, negativos e inválidos no modelo/Zod. |
| 07 — Rascunho de outra aba | Save/cancel de edição não remove a chave do rascunho de criação. Rascunho de edição tem identidade de ator/organização/imóvel. | Storage simulado e integração de limpeza do formulário revisada. |
| 08 — Remount/acesso | Edição é persistida em sessionStorage e só recuperada após GET fresco do imóvel e capacidades frescas do workspace. Revogação de contatos/gestão no servidor impede restaurar conteúdo, mesmo com AuthContext antigo. Preserva CAS e aponta conflito de versão. | Negativos de escopo, política, contatos, storage e CAS; broker permitido. QueryProvider global preservado. |
| 09 — Hierarquia | Vínculo, promoção, publicação, worker e leitores públicos usam a hierarquia completa do tenant; estados desconhecidos/pais ausentes falham fechados. Archive considera publicação legada. Locks seguem empreendimento→unidade→imóvel e o caso de vínculo criado durante a descoberta é rechecado. | Go e Edge, estados fechados/tenant, locks e leitores; teste PostgreSQL de dez estados preparado, não executado. |
| 10 — Pool | `tableHasColumn` usa a transação/queryer já adquirido em mutações; pool fica reservado para consultas fora de transação. | pgx real com protocolo em memória, pools de 1/8 conexões e controles pela mesma transação. |
| 11 — Upload com resposta perdida | Tentativa mantém fingerprint, path e corpo originais antes do POST. Retry reconcilia o ativo ou reutiliza o path; timeout não dispara upload novo nem discard inseguro. Mudança de visibilidade/tipo/texto/metadados bloqueia replay silencioso. | 11 regressões de commit/resposta perdida, timeout antes do commit, storage, escopo, privacidade alterada e tentativa concorrente. |
| 12 — Retry da mídia | Erro de transporte permite repetir a edição, conservando campos e revisão; validação de arquivo e bloqueio durante save continuam ativos. | 3 testes runtime do componente real com estado/JSX simulados. |
| 13 — Falso publicado | Prontidão e vetos atuais precedem os atalhos de versão atual/publicação em processamento. Negação comercial deixa de produzir falso sucesso. | Testes de prontidão, consentimento, erro e processamento. |
| 14 — Aliases públicos | API e IA usam a mesma allowlist normalizada de estados conhecidos. Candidatos permanecem no tenant e passam pelo gate antes de projeção/contagem; aliases não são excluídos por pré-filtro contraditório. | Aliases, acentos, espaços, desconhecidos, consulta/projeção e hierarquia. |

## Revisão independente

Os revisores cruzaram as frentes depois das implementações. A revisão produziu correções adicionais dentro dos mesmos achados:

- Capacidades de contatos e gestão devem vir de uma resposta atual do servidor antes da restauração do rascunho (08).
- Troca de sessão A→A também precisa cancelar uma ação de mídia já iniciada (01).
- Uma tentativa antiga pública não pode ser reenviada silenciosamente depois de o usuário escolher confidencial (11). A comparação ignora apenas a ordem automática da lista, que pode mudar em um retry legítimo.
- Um vínculo criado entre a descoberta inicial e o lock do imóvel exige rechecagem/409 (09), conservando a ordem dos locks.

## Verificação e limites

Resultados já observados:

| Check | Resultado |
| --- | --- |
| `npm run test:property-ui` | 194/194 PASS, sem skips. |
| Runtime real do formulário | 8/8 PASS; seções em 320/390/1280 px, save, preview/histórico e preparo JPEG. Navegador local, sem dispositivo Mac/iPhone físico. |
| Runtime do picker | 11/11 PASS, incluindo permissão, HTTP403/500 e erro versus vazio. |
| Transporte/hook de mutações | 66/66 PASS: 36 API + 30 hooks. |
| `npm run test:property-media:scope` | 79/79 PASS, sem skips; inclui contratos de execução de mídia e AssetDialog. |
| AssetDialog | 3/3 PASS. |
| Publicação/IA/hierarquia Node | 30/30 PASS. |
| Edge selecionado | 6/6 PASS. |
| Go developments/publications/properties/site/portals, após revisão da corrida | Cinco pacotes PASS; 449 testes PASS; 23 integrações PostgreSQL SKIP. |
| TypeScript global | Primeira execução exit2: cinco imports próprios corrigidos e erros fora de imóveis. Repetição final inconclusiva por demora extrema no host; processo próprio encerrado. Não aprovado. |
| Lint global | CLI, CLI com debug e API com a mesma configuração não concluíram o carregamento; processos próprios encerrados. Causa exata indeterminada; nenhum gate aprovado. |
| Gate de migrations | Falhou em quatro migrations de outras frentes ainda sem lock. Nenhuma migration criada/alterada para estes 14 pontos. |
| Gate de Edge | PASS depois de atualizar somente três hashes de fontes revisadas. Status, JWT, hashes de deployment capturado e demais entradas preservados. |

A execução inicial do UI encontrou um contrato textual que esperava callback com apenas `error`. O contrato foi atualizado para verificar o novo callback com escopo e exigir propagação de intenção/versão; a obrigação de invalidar o catálogo foi mantida. A repetição do pacote passou. Nenhum teste foi removido para obter verde.

O TypeScript global concluiu a primeira execução com erros em Leads/gestão e cinco imports `.ts` nos dois testes novos desta rodada. Os cinco imports foram corrigidos para aliases `@/` sem extensão, conservando o tsconfig; os 41 testes focados passaram novamente. Os erros nos arquivos alheios foram preservados. A repetição final não concluiu: CPU do TSC passou de 5,75 s para 6,17 s em cerca de dois minutos, enquanto o host já apresentara espera por paginação. A primeira execução e a repetição estão preservadas em [typecheck.log](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/typecheck.log) e [typecheck-final.log](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/typecheck-final.log); isso não valida os tipos da versão final inteira.

Os erros externos observados na primeira execução estão em `components/features/leads/LeadDetailDialog.tsx` (839/1083), `lib/lead-attachment-preview.test.ts` (3), `lib/merge-lead-server-response.test.mts` (16/26/34), `lib/round-robin/management-hardening.test.ts` (46) e `lib/validation/management-availability-precision.test.ts` (3). A lista é daquele snapshot e pode mudar com as outras frentes; não os tratamos como defeitos novos de imóveis nem alteramos esses arquivos.

O lint paralelo desta auditoria foi interrompido para reduzir paginação e repetido sozinho. O debug parou antes do carregamento da configuração, sem provar qual dependência demorava. A configuração contém imports locais, sem carregamento remoto identificado. Tentamos também a API do ESLint, fornecendo o mesmo array importado de `eslint.config.mjs`, com cache desabilitado e o mesmo escopo `.`; a execução igualmente não retornou do carregamento. Regras e ignores foram preservados. Evidências: [debug CLI](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/lint-debug-final.log), [runner equivalente](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/lint-same-config.cjs) e [log API](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/lint-api-final.log). Nenhum resultado de lint é declarado aprovado.

Encerramos apenas os verificadores iniciados por esta auditoria, após conferir PID, processo pai e comando. Nenhum processo de outra frente foi encerrado. Antes de release, repetir TypeScript/lint quando o host permitir, executar os negativos SQL no banco sintético e reconciliar os gates das outras frentes.

O gate de migrations apontou `20261013003723_add_lead_attachment_upload_receipts.sql`, `20261013003930_management_tag_semantic_references.sql`, `20261013004040_harden_management_team_data_api_reads.sql` e `20261013004750_management_literal_campaign_matching.sql`, criadas por outras frentes e ainda ausentes do lock. Não executamos `--write` para aprovar migrations fora deste escopo.

O hash de `_shared` sem o novo helper de hierarquia foi recomputado e correspondia exatamente ao manifesto anterior. Isso isolou a mudança desta rodada, sem revisar/blessar incidentalmente as fontes de outras frentes. Atualizamos apenas os hashes de `_shared`, `ai-agent-responder` e `public-api`; o gate permaneceu estrito. [Resultado](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/edge-gate-final.log).

Os testes com PostgreSQL real ficaram condicionados a um banco sintético loopback com nome explícito. Não usamos `DATABASE_URL` de produção. A tentativa de consultar o Docker local retornou HTTP500; não iniciamos/reconfiguramos serviços. Os testes pulados continuam pulados, sem alegação de aprovação.

No upload ambíguo, o registro pendente permanece protegido. Se o usuário mudou dados ou visibilidade, o formulário informa que essas alterações não foram aplicadas e pede conferência da mídia anterior; não publica o corpo antigo como se fosse a nova escolha. Uma resposta de timeout não garante que o servidor deixou de concluir a operação. URLs anteriormente assinadas, cache e cópias baixadas não são cancelados retroativamente pelo veto de novos GETs.

## Preservação e reversão

Baseline de 388 arquivos/hash/status/diff: `D:/Vimob/tmp/properties-close14-20261012-86cf10b7`. Cópia adicional mais ampla: `D:/Vimob/tmp/properties-close14-fast-20261012` (495 arquivos). Os consumidores Go extras têm snapshot em `domain-extra-baseline/` dentro da primeira pasta. O registro principal dos arquivos precede as edições; use as cópias/hashes para distinguir mudanças desta rodada de trabalho preexistente. Não use reset/revert de arquivos inteiros contra HEAD.

Alguns arquivos sofreram bloqueios de escrita do Windows. Quando necessário, a substituição atômica conferiu o conteúdo atual antes de trocar o arquivo; alterações preexistentes foram preservadas. Não houve encerramento de processos de outras frentes.

Novas regras de parsing, storage, autorização e recuperação ficaram em helpers de domínio. O `PropertyFormScreen` legado recebeu aproximadamente 105 linhas de integração, com lógica separada em helpers pequenos; uma divisão posterior por hidratação/recuperação/envio pode ser feita separadamente. Primitivas de `components/ui/`, QueryProvider global, cores e geometria compartilhada do wizard foram preservadas. Não houve dependência nova.

Uma reversão deve retirar somente os trechos desta rodada, guiada pelo baseline e testes, mantendo as correções anteriores e as outras frentes. Não há rollback de schema ou dados remotos nesta rodada. Produção continua no estado anterior até uma implantação autorizada e validada separadamente.

Evidências locais: [publicação](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/publication-fixes-evidence.md), [backend](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/domain-close-notes.md), [Go final](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/domain-go-after-race.log), [UI](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/property-ui-final.log), [formulário runtime](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/property-ui-runtime.log), [picker](D:/Vimob/tmp/properties-close14-20261012-86cf10b7/property-picker-runtime.log).
