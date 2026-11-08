# Fechamento local da auditoria da Agenda — 12/10/2026

As correções foram feitas no checkout principal `D:\Vimob\workspaces\vimob-crm`,
branch `main`, a partir de `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
O checkout já continha alterações de outras auditorias. Elas foram preservadas;
este documento descreve apenas a Agenda e suas dependências necessárias.
Não houve commit, push, publicação, aplicação de migration no CRM, ativação de
OAuth/Cron, reconexão Google, reenvio ou descarte de notificações.

Relatórios originais e evidências: `D:\Vimob\outputs\auditoria-agenda-2026-10-12`.
Backup anterior às alterações: `D:\Vimob\_safety\agenda-fixes-20261012-182104`.
As contagens de produção do relatório original continuam sendo um retrato da
auditoria, não uma medição posterior às correções locais.

## O que foi corrigido

| Achado original | Fechamento no candidato local |
|---|---|
| F01 — edição encurta a atividade | Defaults de duração somente no novo rascunho/troca explícita de tipo. Editar título preserva início/fim reais. |
| F02/F03 — semana/mês cortados | Rolagem nativa nos dois eixos; semana compacta, mês com seis semanas e últimos dias acessíveis. |
| F04 — lista ignora período/histórico | Mesma consulta e filtros do calendário; inclui estados finais, paginação visual de 20 e carregar mais. |
| F05/F06 — navegação/data antiga | Navegação por mês/ano civil e alinhamento da data selecionada ao período exibido. |
| F07 — imóvel além da primeira página | Busca por ID para prévia vinculada, preservando a implementação já existente no checkout. |
| F08/F09 — falhas silenciosas | Loading, erro e retry explícitos para comentários/capabilities. Rascunho preservado em falha de gravação; escrita e geometria civil dependem de configuração de fuso confirmada. |
| F10 — visita/reunião não move | Regra de remarcação explicada; drag não sobrescreve histórico de atendimento. |
| F11 — origens limitadas a oito | Todas as origens em área com rolagem. |
| F12/F13 — local/fuso | Campo de local e histórico/comentários no fuso da organização. |
| F14 — ações/a11y inconsistentes | Detalhes para visualizador; confirmação de exclusão; checkbox nomeado, ações visíveis ao receber foco e criação em slot por Enter/Espaço. Drag preserva segundos. Editor continua alternativa ao drag por teclado/touch. |
| Densidade da dashboard | KPIs e painéis respondem à largura útil do container, inclusive quando a sidebar ocupa parte da viewport. Alturas menores em áreas estreitas. |
| BE01/BE14 — SSE/burst | Evento `schedule.changed` sem IDs de atividade/lead/ator ou conteúdo privado; cliente acumula IDs de servidores antigos e faz invalidação ampla para o evento novo. |
| BE02 — listagem ilimitada | API com limit/offset/has_more, máximo de 500 por página e período geral de até 366 dias; consultas por evento/lead dispensam período. Cliente busca páginas sem truncar silenciosamente e cancela consultas antigas. |
| BE03/BE04 — recorrência | Calendário civil da organização, fim de mês ancorado, DST explícito; edição de regra de série recusada em PATCH. |
| BE05/BE07 — efeitos repetidos | Assignee só notifica na inserção efetiva; criação/comentário recebem UUID estável de comando e validam replay por organização, autor e conteúdo. Replay de criação também recusa notas/desfecho posteriores e usa escopo atual de lead/imóvel; não devolve dados privados acrescentados depois. |
| BE06 — erro depois de commit | Confirmação da escrita carregada dentro da transação; criar evento privado delegado não depende de ganhar leitura sobre ele. |
| BE08/BE12 — contratos divergentes | Limite de 100 participantes no servidor e intervalo estritamente positivo para novas escritas. Legado não é reescrito. |
| BE09 — produção lenta de lembretes | Produtores da Agenda drenam lotes sucessivos com limite de 5 segundos por ciclo; locks/dedupe e orçamento por consulta são preservados. Não comprova capacidade real para 6 mil usuários. |
| BE10 — qualidade histórica | `data_quality` opcional informa lacunas no cohort e resultados sem data no escopo autorizado. Ausência do objeto significa cobertura desconhecida. Ranking por responsabilidade não declara execução real. |
| BE11 — resultado final imutável | Regra preservada e explicada. Criar fluxo de retificação auditada é trabalho separado; nenhum resultado final é reaberto/apagado por esta correção. |
| BE13 — sobrescrita concorrente | `expected_updated_at` preserva a versão original e API responde 409 quando mudou; cliente não troca silenciosamente a versão antes de reenviar. |
| G01 — RPC privilegiada exposta | Migration nova revoga PUBLIC/anon/auth nos helpers/tabelas Google e inclui guarda de serviço. Ainda precisa aplicação no alvo autorizado. |
| G03/G06 — corrida/lease | Claim v2 por compromisso, dono de lease, heartbeat, HTTP limitado, If-Match remoto e novo envio da revisão atual após conflito. Finalização e erros de evento/vínculo/conta são uma transação protegida pela mesma lease; worker antigo não repinta sucesso como erro. |
| G04/G07 — jobs/desconexão | Jobs comprovadamente obsoletos são terminalizados; legado sem identidade permanece para revisão. Disconnect e enqueue compartilham lock curto; falha de revogação mantém segredo e sinaliza erro. Escrita que depende dessa integração durante a desconexão retorna 409 e reverte CRM+outbox; não descarta intenção de edição/exclusão. |
| G05/G08/G09 — OAuth/retry/docs | Exige escopo efetivamente concedido e refresh token; retry com classificação, jitter e Retry-After; docs/examples refletem gate desativado por padrão. |
| Recibo de lembrete no Edge alternativo | Gateway de serviço reutiliza conciliação monotônica existente. Exige organização, sessão Evolution Go e sessão do envio persistida na notificação. Recibo desconhecido/sem prova do remetente permanece pendente; não há reenvio. |

## Contratos e compatibilidade

O GET de eventos mantém `data` como array e adiciona `pagination`. O cliente
aceita a resposta antiga sem esse objeto. Em servidores novos, percorre páginas
de 200, deduplica IDs, propaga erro de uma página posterior e usa AbortSignal.
Há teto de 100 páginas: ultrapassá-lo pede um período menor, sem retornar uma
agenda parcial como sucesso. Offset não é snapshot atômico; alterações durante
a leitura são reconciliadas pelo refetch/realtime. Não é exportação consistente.

`client_request_id` e `expected_updated_at` são aditivos no backend novo.
O servidor antigo usa decoder estrito e rejeita esses novos campos: publicar
API antes do Web/PWA, verificar todas as réplicas e só então trocar os clientes.
Guarda de versão opcional mantém compatibilidade com callers antigos; a proteção
contra sobrescrita exige que o caller envie a versão que editou.

Conflito `google_calendar_disconnecting` pede aguardar e tentar salvar novamente,
preservando rascunho/UUID/versão. `schedule_conflict` pede atualizar e conferir a
atividade antes de tentar novamente. Um 409 não é interpretado automaticamente
como conflito de versão. Crash após preparar disconnect exige revisão do marker;
não há desbloqueio automático que presuma se o Google revogou o token.

A criação de eventos e comentários usa IDs gerados pelo banco. Cada chave de
idempotência é vinculada à organização e ao autor dentro da operação. Tentativas
com a mesma chave em outro escopo são independentes. Uma nova tentativa no mesmo
escopo com conteúdo diferente ou objeto alterado retorna conflito. Eventos e
comentários legados continuam a aceitar a chave antiga no escopo original.
Depois da exclusão, a chave pode ser usada novamente. Remarcação valida também
as notas da tentativa original.

Para publicar a separação dos IDs, aplique primeiro a migration
`20261107092518_scope_schedule_command_idempotency.sql`. Suspenda a criação de
eventos e comentários e drene as requisições em curso nas réplicas antigas.
Retome essas escritas quando só houver réplicas com o novo código. Uma réplica
antiga que receber uma nova tentativa pode criar outro registro para um comando
já aceito pelo novo código. Se precisar voltar à API anterior após a troca,
preserve as colunas e os índices e mantenha as duas escritas suspensas até
restabelecer a versão que reconhece as novas chaves.

PATCH de formulário omite relações e participantes que não mudaram. Isso evita
exigir permissão sobre imóvel/lead apenas para editar o título; alterações reais
continuam passando pela validação de referência e atribuição do servidor.

`data_quality.unknown_result_time_in_scope` não pertence ao período escolhido:
é o total sem data de resultado no mesmo escopo e filtros não temporais. Não
atribuir esses registros ao dia atual nem somar esse número aos KPIs do período.
As lacunas do cohort podem se sobrepor; não somá-las como eventos distintos.

## Verificação reproduzível

No checkout principal:

```powershell
npm run test:agenda
npm run test:agenda:ui
go test -p 1 ./apps/api/internal/schedule ./apps/api/internal/realtime
go test -p 1 ./apps/api/internal/leads -run 'ScheduleReminder|ScheduleOutcome|ScheduleNotificationBurst'
npm run typecheck
node scripts/supabase/verify-edge-functions.mjs
node scripts/supabase/verify-migrations.mjs
```

A suíte UI monta componentes React/Radix e CSS reais em Chromium headless,
com autenticação/dados/transporte sintéticos e bloqueio de rede. Não inicia
CRM/API nem se conecta a contas reais. Abrange duração, retry, permissões de
visualizador, links, scroll, drag/resize, períodos, origens, comandos repetidos
e largura de 360/390/480/768/1024/1280/1440. Imagens sintéticas:
`D:\Vimob\outputs\auditoria-agenda-2026-10-12\frontend-previews`.
Não equivale a homologação em Safari/Mac, dispositivo touch ou shell publicado.

Testes SQL usam apenas fixtures descartáveis, com duas organizações/roles.
Arquivos `supabase/tests/google_calendar_outbound_protocol.*.sql` e
`supabase/tests/agenda_notification_edge_receipt.*.sql` nunca devem ser
executados em um CRM existente. A fixture do gateway de recibos substitui
explicitamente o reconciliador anterior para testar ACL, escopo e delegação;
não testa novamente toda a máquina de estados de entrega.

Gates medidos nesta rodada (checkout em edição concorrente):

| Verificação | Resultado e limite |
|---|---|
| `npm run test:agenda` | 175 aprovados, 0 falhas/skip, 25 arquivos; log `agenda-focused-final.log`. Inclui a regressão do erro tardio Google e a diferenciação dos 409. |
| Browser offline | 19 cenários aprovados, 0 falhas/skip, incluindo UI real, Popover por clique/Enter, sete viewports e seis larguras úteis com sidebar. Configuração indisponível bloqueia consultas/escritas; retry confirma Asia/Tokyo, criação por Enter às 23h resulta em 14h UTC. Preservação de segundos e os quatro casos de acessibilidade/duração também passaram. |
| Go | Suítes Agenda, Realtime e Leads aprovadas: 516 execuções (88/14/414), 34 skips por gates de integração. Inclui o mapper Google e o guard de replay privado. Isso não representa 516 cenários novos nem homologação dos testes pulados. |
| Erros 409 na UI | 3 aprovados: busy Google distinto de revisão alterada, sem expor erro técnico. |
| Compilação de `tsconfig.validation-tests.json --noEmit` | Aprovada; testes novos registrados no script de validação existente. |
| Typecheck da interface | A rodada final focada em toda a interface de Agenda e comentários passou sem erros; os dois erros externos anteriores em hooks de Imóveis foram corrigidos por outra auditoria. |
| Typecheck global | A execução global anterior encontrou 10 erros fora da Agenda: Imóveis, manutenção de empreendimentos, Round-robin, disponibilidade de equipes e imports `.ts` em testes de Imóveis. `typecheck-final.log` contém esse snapshot; nenhuma falha era da Agenda. Outras auditorias continuam alterando esses arquivos; a compilação focada posterior não equivale a um novo build global verde. |
| `audit:check` | Inventário global gerado desatualizado; o checker não encontrou falhas de invariantes. Não foi regenerado enquanto outras auditorias alteram superfícies. |
| Manifesto Edge / migrations | O snapshot revisado passou no manifesto Edge (41 live, 26 tombstones, 15 retired). As duas migrations novas de Agenda estão incluídas seletivamente no lock. Na última rechecagem, Evolution Go e a migration `20261012224034_add_contact_import_request_receipts.sql` divergiam dos hashes globais por alterações concorrentes de outras auditorias. Essas mudanças foram preservadas e não receberam aprovação por esta tarefa. Hash comprova integridade do snapshot, não aprovação de código de todos os domínios. |
| Lint | Escopo inicial de Agenda e contratos/API passou. Schemas da dashboard e runner passaram na checagem posterior. CLI final de alguns arquivos ficou inconclusiva carregando configuração; não é prova de erro de código nem aprovação final global. |

SQL Google e gateway de recibos passaram em **PostgreSQL 18.6 WASM**, PGlite
0.5.9 instalado com versão exata somente em `outputs/.../sql-runtime`, fora das
dependências do CRM. O runner `run-google-sql.mjs` usa dois bancos em memória,
roles reais e SQL real. Google cobre privilégios/guard, claim, recuperação de
lease, tenant, jobs obsoletos, desconexão e rollback. Gateway cobre ACL,
organização, provedor, sessão do envio e delegação. O funcionamento do runtime
está descrito na [documentação oficial do PGlite](https://pglite.dev/docs/api).

A fixture Go executou SQL por PGwire nesse engine, com uma conexão. **16 casos
passaram**, incluindo autorização, replay privado com notas/referências
alteradas, remarcação e rollback de sete mutações durante disconnect. O caso
de dois comandos realmente concorrentes foi explicitamente pulado: engine em
processo único não comprova disputa de locks entre duas sessões/réplicas.
Log final: `go-pglite-replay-privacy-final.log`; o anterior
`go-pglite-hardening-final.log` detalha o rollback de desconexão. O socket
sintético foi encerrado.
Esses resultados não homologam
PostgreSQL 17/Supabase completo nem permitem afirmar entrega externa real.

O container Docker exclusivo de teste `vimob-agenda-fixes-20261012` não respondeu
ao handshake/exec durante a rodada. Sua remoção foi tentada, mas não confirmada.
Nenhum container de outra auditoria ou serviço CRM foi parado/reiniciado.

## Etapas que continuam fora do fechamento local

1. Aplicar apenas as migrations novas revisadas no ambiente autorizado. Corrigir
   o P0 Google no banco publicado continua sendo uma etapa pendente de produção.
2. Pausar/drenar o worker Google antigo antes da migration v2; publicar worker
   compatível e verificar hashes/roteador. Não usar `db push` em lote nem alterar
   migrations históricas para contornar o ledger.
3. A API Google, o gate de conexão, a audiência OAuth e o Cron continuam nos
   estados observados na auditoria. Preparar piloto Web/PWA de uma conta,
   somente Vimob→Google; Testing não é prontidão para liberação geral.
4. Homologar create/edit/delete, recorrência, all-day, remarcação, transferência
   de responsável, conflito de versão, lease perdido e revogação com conta
   controlada. Provar ID/revisão/horário no Google, não apenas status “Conectado”.
5. Medir atraso e vazão dos lembretes e confirmar recibos reais. Os 347 lembretes
   WhatsApp auditados tiveram aceitação do provedor, mas não recibo de entrega
   persistido; isso não prova que não chegaram ao telefone. Nenhum replay foi feito.
6. Revisar legado e jobs dead com evidência antes de qualquer correção de dados.
   Sem sessão do envio persistida, o gateway novo não infere uma para conciliar
   recibo; instância global sem sessão vinculada exige configuração/revisão própria.
7. Reconciliar os gates globais e mudanças concorrentes das outras auditorias
   antes de uma release única. Este checkout continua compartilhado e sujo.

O ramo da dashboard usa agora o título curto “Agenda”, corrigindo a pressão do
texto longo no header móvel sem alterar o componente compartilhado. O prompt
PWA sobre conteúdo observado na auditoria é dispensável pelo usuário e continua
exigindo validação própria do shell; a fixture da Agenda não homologa esse banner.

Roteiro Google detalhado: `docs/google-agenda.md` e
`deploy/supabase-self-hosted/google-calendar-release-readiness.md`.
