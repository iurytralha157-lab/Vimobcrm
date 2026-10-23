# Correções da segunda auditoria da Agenda — 12/10/2026

O candidato foi corrigido no checkout principal `D:\Vimob\workspaces\vimob-crm`,
branch `main`, a partir de `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
O checkout tinha 1.383 caminhos alterados antes desta rodada. Há outras auditorias
trabalhando nele; o delta desta rodada deve ser lido contra o backup, e não
confundido com todo o `git diff` da branch.

Backup: `D:\Vimob\_safety\agenda-second-fixes-20261012-210005`.
Auditoria de origem: `D:\Vimob\outputs\auditoria-agenda-segunda-rodada-2026-10-12`.
Evidências desta implementação: `D:\Vimob\outputs\agenda-correcoes-segunda-rodada-2026-10-12`.
O fechamento da primeira rodada permanece em `agenda-audit-closure-2026-10-12.md`.

Não houve commit, push, deploy, migration no CRM, ativação de OAuth/Cron,
reconexão real do Google, envio externo ou replay de lembretes. SQL foi executado
somente em memórias descartáveis com dados sintéticos. O socket SQL próprio de
teste foi encerrado; o registro está em `backend/socket-closure-final.json`.

## Backend e privacidade

| Achado | Comportamento corrigido | Evidência |
|---|---|---|
| BE2-01: evento autorizava contato vinculado sem permissão de lead | GET, lista, prévia de lead e respostas de mutações aplicam organização e `leadscope.VisibilitySQL` ao lead. O evento autorizado continua visível; ID, nome, telefone e origem do vínculo ficam redigidos quando o lead não pode ser lido. | Go e fixture SQL com Own/Team/All, transferência e duas organizações. |
| Residual BE2-01 na dashboard | Contagens e filtros de origem usam a mesma projeção autorizada. Snapshot histórico e fallback da origem atual não atravessam a permissão. Eventos com origem indisponível permanecem no grupo `__none__`. A qualidade de dados também não permite inferir a origem pela contagem de desfechos sem data. | Negativos de filtro/agrupamento/qualidade, controle positivo Own e legado com FK estrangeira sintética. |
| BE2-02: PATCH apenas de participantes era rejeitado | Alteração só de `assignee_ids` entra na transação; repetir a lista não notifica novamente e uma lista vazia remove participantes. | Fixture SQL com gravação, retry, limpeza e contagem de notificações sintéticas. |
| BE2-03: mudar tipo contornava remarcação | Visita/reunião não vira tarefa/outro tipo; transformar tarefa em atendimento exige preservar o horário nessa edição. Visita↔reunião só é permitida quando aberta e sem cadeia de remarcação. Qualquer lineage mantém o tipo imutável. | Testes de transições, tentativas em dois/três passos e controles permitidos. |
| BE2-04: máscara revelava estado e metadados | Busy conserva somente identidade técnica, organização, disponibilidade e campos neutros de compatibilidade. Status/tipo/desfecho/lembrete/recorrência/referências/autoria ficam null ou vazios; não é fabricado um estado “scheduled”. | Teste do JSON real e fixture com atividade finalizada e recorrente; dono mantém os detalhes. |
| BE2-05: corpo aceitava um segundo JSON | Os seis handlers de escrita exigem EOF após um único valor JSON, antes de acessar o repositório. Whitespace dentro do limite continua válido. | Negativos por handler, JSON extra, texto inválido e limite de corpo. |
| Janela entre autorização e leitura | Comentários e participantes são autorizados, lidos e confirmados na mesma transação com lock do evento. | Negativos de transferência de atividade privada e revisão dos caminhos que compartilham esse lock. |

A proteção de origem muda a projeção do relatório: “Sem origem” significa origem
disponível ausente, inclusive vínculo redigido/removido; não comprova que a coluna
original do banco está vazia. Nenhum compromisso autorizado é removido do total
apenas por essa redaction. A referência estrangeira foi construída na fixture;
não é evidência de corrupção existente no CRM nem de uma criação normal entre tenants.

## Frontend, calendário e cache

| Achado | Comportamento corrigido |
|---|---|
| FE2-01: remarcação com fuso presumido | Criar, editar horários, geometria civil e remarcar exigem capabilities com fuso explícito e válido. O schema deixa de confirmar São Paulo silenciosamente quando a réplica não retorna `timeZone`. Erro tem retry e preserva rascunhos. Concluir uma atividade continua usando timestamp do servidor e não depende desse fuso. |
| FE2-02: mudança recebida durante a consulta se perdia | O coordenador do domínio marca stale, aguarda a consulta e força uma leitura posterior. Mudanças durante essa atualização geram nova leitura ao final; bursts são acumulados, sem cancelar a cada evento. Cache removido não atualiza uma instância substituta ou outro tenant. Comentários, participantes, calendário e agregados usam essa via. |
| Retorno à página com cache inativo | Hooks da Agenda voltam a consultar dados stale ao montar. Os padrões globais do QueryProvider não foram alterados. A lista infinita da dashboard continua reiniciando páginas por offset após alterações. |
| FE2-03: duração truncada | Trocar início/remarcar preserva o delta armazenado em milissegundos, incluindo 1 ms, 20 s e 90 min 22 s; não arredonda para minutos inteiros nem inventa 30 min. |
| FE2-04: vários dias viravam um dia | Edição e remarcação preservam a quantidade de dias civis e a convenção de fim exclusivo/inclusivo. Drag de dia inteiro usa a mesma regra e não depende de um horário inexistente no DST; timed continua rejeitando o horário inexistente. |
| FE2-05: exclusão concorria com gravação | A ação, confirmação e callback de exclusão respeitam escrita em andamento. |
| Estados ocupados | Calendário e listas usam título e lifecycle neutros. O filtro de tipo conserva disponibilidade ocupada sem revelar o tipo privado. |
| Regressões adicionais da revisão | Rascunhos de título/descrição/comentário/resultado sobrevivem a retry de capabilities; fechar/trocar a atividade limpa o contexto privado. Editar aguarda a hidratação. A UI espelha lineage e a restrição tarefa→atendimento com mudança de horário, preservando o draft e orientando Remarcar. |
| Muitos horários simultâneos | Gap é limitado à largura da coluna: 51 sobreposições não produzem cards com largura negativa. Foram mantidas provas de visibilidade, bounds positivos e abertura por teclado, além do controle com uma atividade. Muitas sobreposições continuam estreitas; a lista existente foi validada como outra superfície. |
| Títulos vazios | O fallback normal continua sendo o tipo real da atividade; busy sempre tem título genérico. |

O coordenador foi verificado com QueryClient/QueryObserver reais: primeira carga
sem cache, burst, mudança durante refresh, cache.clear/substituição, query inativa
e falha. A revisão independente acrescentou erro inicial, cancelamento explícito,
offline→online, filtro entre duas organizações e refresh pausado. Isso é prova
local de cache; não é prova de recebimento SSE em produção.

## Google Calendar

| Achado | Correção local |
|---|---|
| G2-01: limpeza sem argumento ETag | Todos os caminhos de compensação passam o ETag para a escrita condicional. A limpeza não assume que o ID remoto pertence ao Vimob. |
| G2-02: erro antigo repintava conexão recuperada | Agregado e desfecho são derivados em SQL sob locks e lease/binding atuais. Claim captura a revisão da credencial; resultado de credencial anterior volta à fila sem consumir tentativa ou marcar a nova conexão como erro. |
| G2-03: apagar descrição/localização não apagava no Google | PATCH expressa a remoção com null, em vez de omitir o campo. Payload e modelo de PATCH foram testados; a aceitação e o resultado do provedor precisam do canário real. |
| G2-04: Vault e ativação separados | Vault e ativação OAuth confirmam juntos, por CAS da revisão/lifecycle. Refresh antigo não sobrescreve uma reconexão. Desconexão de canal legado pode renovar token somente pelo caminho explícito autorizado, sem permitir isso ao worker comum. |
| Contexto de refresh | Marcadores de job/worker e do fluxo de desconexão são preservados na credencial retornada. |
| Exportação do lead | Resolver considera defaults, papéis ativos, grants legados, wildcard, overrides, equipes e membership_generation atuais. Participação no compromisso não cria permissão de lead. Metadata de imóvel sem resolver próprio foi omitida. |
| Ordem de locks | Finish usa evento→links de delete→conexão→job. Disconnect usa conexão→jobs e não escreve/trava eventos/links. Claim lê eventos/conexões por MVCC. Chamadas HTTP ficam fora dessas transações. |

Migration nova: `supabase/migrations/20261013000127_harden_google_calendar_activation_status_and_export.sql`.
As migrations `20261012212128` e `20261012214157` da primeira rodada não foram
reescritas. A atualização dos hashes foi seletiva; entradas de outras funções
e migrations foram preservadas. Não houve `--write` global para mascarar drift.

O checker persistente faz verificação semântica estrita dos quatro entrypoints
Edge completos e seus imports, com TypeScript 5.9.3 e tipos reais do supabase-js
instalado. Apenas `Deno.env`/`Deno.serve` recebem declaração em memória. Não é
`deno check` nativo nem comprovação de runtime/configuração do ambiente publicado.

## Verificação final e limites

A matriz final de comandos, contagens, exit codes e logs fica em
`D:\Vimob\outputs\agenda-correcoes-segunda-rodada-2026-10-12\verification-final.json`.
A revisão independente está em `independent-review/review.md`; seu probe isolado
de DST foi inconclusivo e não foi contado como PASS. A prova funcional de drag
e geometria pertence ao runtime oficial da UI. Resultados SQL que incluem DDL
e setup não devem ser somados como “testes”.

| Verificação | Resultado final registrado |
|---|---|
| Domínio Agenda | 200 PASS, 0 FAIL, 0 SKIP. |
| Runtime da interface | 29 PASS, 0 FAIL, 0 SKIP; 51 sobreposições em 360/390/768/1024/1440 px. |
| TypeScript focado da interface e compilador de testes de validação | Exit 0 em ambos. |
| Go Schedule | 93 PASS, 0 FAIL, 5 SKIP de casos que exigem outra execução de banco. |
| SQL sintético do backend | 25 subcasos PASS, 0 FAIL, 1 SKIP; suíte PASS. |
| Google: semântica Edge completa | Quatro entrypoints com imports, exit 0; não é `deno check` nativo. |
| Google: SQL sintético | 54 verificações lógicas PASS; 103 resultados incluindo setup, além da compatibilidade do protocolo legado. |
| Revisão independente | Cinco negativos de cache PASS, três testes Go repetidos PASS e fixture Google repetida PASS. |
| Typecheck global | Exit 2; 13 diagnósticos em sete arquivos de Leads/Imóveis/Gestão, fora da Agenda na medição. |
| Lint global | Inconclusivo após mais de 40 minutos sem resultado; execução própria encerrada por cadeia de processos verificada. Não contado como PASS. |
| Lint focado da rodada | 36 arquivos JS/TS, `--max-warnings 0`, também inconclusivo após limite de seis minutos sem diagnóstico. O launcher encerrou somente seu próprio filho; comando/log/status estão em `independent-review/lint-focused-final*`. |
| Inventários globais Edge/migrations | Exit 1 nas medições: drift de fontes de outras auditorias e migration Management vazia naquele momento. |

Os 73 testes unitários Google e os 43 testes puros focados da interface já
integram os 200 do domínio; repetições e subconjuntos não foram somados. O log
global de TypeScript contém os caminhos/linhas; “fora da Agenda” não significa
que esses erros foram demonstrados como preexistentes. Não foram alterados
arquivos de outros domínios para obter aprovação dos gates.

`owner-hashes-final.json` reconferiu 16 arquivos do frontend, 15 do backend e
quatro fontes críticas Google sem divergência frente às fontes testadas.
`source-final.json` registra 149 caminhos do escopo, comparados ao backup;
`source-frozen.json`/`source-drift-final.json` registram a estabilidade posterior.
O arquivo `package-lock.json` e as duas migrations anteriores da Agenda têm o
mesmo hash do backup. `git diff --check` passou nos 61 caminhos alterados desse
snapshot; arquivos novos também pertencem aos testes e à revisão por autoria,
pois `git diff` não inspeciona conteúdo untracked.

Comandos persistentes:

```powershell
npm run test:agenda
npm run test:agenda:ui
npm run test:agenda:google:types
npm run test:agenda:google:sql -- <caminho-absoluto-do-PGlite-dist/index.js>
npm run typecheck
npm run lint
node node_modules/typescript/bin/tsc -p tsconfig.validation-tests.json --noEmit
node scripts/supabase/verify-edge-functions.mjs
node scripts/supabase/verify-migrations.mjs
```

O runner SQL Google aceita somente um módulo local explicitamente informado e
sempre cria `memory://`; não recebe URL de banco. A fixture Go tem opt-in próprio,
rejeita host remoto/DATABASE_URL e limita o harness WASM a uma conexão. Não iniciar
o socket de teste se a porta dedicada já tiver dono.

**LIM-01 permanece:** paginação por offset não oferece snapshot atômico entre
requisições. Uma remoção/movimentação concorrente pode deslocar uma página. O
refresh posterior corrige uma mudança recebida, mas não transforma offset em
garantia de exportação consistente nem prova que todo SSE será recebido.

Também não foram comprovados PostgreSQL 17 com duas sessões concorrentes,
duas réplicas, carga de 5–6 mil usuários, Mac/Safari/touch nativos, autenticação
end-to-end, Google real, Vault real no candidato e recibos de lembretes reais.
Os testes de interface usam Chromium, componentes/CSS reais e transporte/auth
sintéticos; rede externa é bloqueada. Não são E2E autenticados do CRM.

No caso extremo de 51 horários simultâneos, os cards permanecem presentes e
acessíveis por teclado, mas estreitos demais para leitura completa ou toque
confortável. A Agenda móvel força Day e esta rodada não adicionou seletor de
lista nesse fluxo. A melhoria não comprova usabilidade de toque desse extremo.

Durante os gates, outras auditorias alteraram `_shared`, `ai-agent-responder`,
`public-api` e a cadeia de migrations. Na medição registrada, o verificador global
encontrou uma migration Management vazia. O typecheck global também encontrou
diagnósticos em Leads, Imóveis e Gestão, fora da Agenda. Esses bloqueios são registrados na matriz;
não houve mudança de arquivos alheios para produzir um PASS global.

## Publicação e reversão

Esta entrega é um candidato local, não uma autorização ou conclusão de release.
Antes de ativar o piloto: reconciliar os gates globais com os responsáveis,
congelar um checkout reproduzível, executar negativos/permissões e concorrência
nativos, e seguir `deploy/supabase-self-hosted/google-calendar-release-readiness.md`.
O escopo continua Web/PWA, uma conta, Vimob→Google; não foram adicionados pull/watch.

Aplicar as definições SQL novas exige drenar callbacks OAuth, refreshes e workers
antigos: o código anterior separava Vault/ativação e não carrega a revisão do
claim. Publicar API/capabilities antes do cliente que exige `timeZone`; coordenar
o JSON busy nullable com o consumidor. Depois atualizar Edge/backend/cliente,
validar configuração/Google API/consentimento/offline token e executar um canário
autorizado de criar, editar, limpar campos e excluir. Não reativar jobs legados
ou reencaminhar lembretes como parte implícita desse canário.

Reversão local é seletiva pelo delta e hashes da rodada, depois de comparar a
fonte atual. Não restaurar a pasta inteira do backup, não usar reset/clean, e não
apagar alterações posteriores. Em release, preferir fix forward ou pausar o
piloto; não restaurar grants públicos nem desfazer cercas de desconexão/lease.
Arquivos legados grandes receberam apenas alterações necessárias às regras;
uma divisão por responsabilidade deve ser planejada separadamente, sem
refatoração incidental nesta auditoria.
