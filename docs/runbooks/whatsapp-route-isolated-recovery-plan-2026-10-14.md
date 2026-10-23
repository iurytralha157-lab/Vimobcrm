# WhatsApp: plano de filas por rota, recuperação e latência de mídia

Data: 14/10/2026. **Isolamento implementado no checkout principal, em validação local; nenhuma operação em produção.** A análise inicial foi somente leitura. A implementação posterior fecha o claim por rota, os efeitos duráveis de receipts por alvo, a retenção atômica de seus irmãos e a contenção de falhas do worker. Reutiliza o inbox e os contratos SQL existentes; não introduz migração, ledger de placeholders ou recuperação automática de eventos reais. A melhoria anterior de assinatura do Storage permanece descrita abaixo.

O incidente confirmado está em [whatsapp-ana-inbound-readonly-2026-10-14.md](whatsapp-ana-inbound-readonly-2026-10-14.md). O objetivo adicional é deixar trabalho problemático durável para processamento posterior e permitir o avanço de rotas independentes. FIFO, epoch, identidade, atribuição imutável ao lead e dependências herdadas continuam obrigatórios. Um timeout não comprova conclusão nem cancela sozinho um executor remoto.

## Implementação local desta rodada

| Ponto | Comportamento implementado |
| --- | --- |
| Cabeça bloqueada por lock | `SKIP LOCKED` escolhe outra cabeça elegível antes do limite de uma cabeça por sessão. O sucessor da rota bloqueada conserva sua dependência. |
| Captura lenta na mesma sessão | Reserva curta por mutex org/SID e lock compartilhado de sessão, compatível com a captura nativa. O claim seguinte usa outra instrução READ COMMITTED, com snapshot atualizado. Cutover e claimant anterior continuam incompatíveis com a reserva. |
| Receipt com alvo ausente | Callback comprovadamente de status é dividido em até 128 efeitos duráveis por identidade do provedor, na mesma transação. Um alvo em retry não segura outro alvo nem uma conversa independente. |
| Callback ambíguo ou misto | Não é dividido por suposição. Conteúdo de cliente em evento de receipt permanece em retry antes de qualquer executor, sem falso acknowledge. |
| Falha/panic do executor | Contextos e orçamento existentes continuam limitados. Panic tem erro sanitizado e tentativa de liberação pela transição existente, validando owner/epoch/Edge. Falha de uma rota comprovada permite drenar outras rotas comprovadas já claimed; a mesma rota ou um fence de sessão continua protegido. |
| Retenção dos efeitos | Efeito morto permanece durável. Irmãos concluídos ficam guardados enquanto houver pendência ou irmão ainda não expirado. A limpeza só remove uma família inteira dentro do conjunto elegível e bloqueado; um limite menor que a família adia sua limpeza. |
| Notificação WhatsApp | Reconciliação usa o gateway SQL existente com org/SID, sem fallback ao reconciliador antigo sem SID. |
| Envios | Outbox e sua ordem por conversa, inclusive texto/mídia, não foram alterados. |

Código: `webhook_route_claim.go`, `webhook_route_claim_query.go`, `webhook_receipt_parts.go`, `webhook_inbox_retention.go`, `webhook_worker_panic.go` e `webhook_worker_route_failure.go`, em `apps/api/internal/whatsapp`. O resultado e a matriz final ficam em [whatsapp-queue-isolation-local-closure-2026-10-14.md](whatsapp-queue-isolation-local-closure-2026-10-14.md).

O inbox é o ledger de efeitos. O primeiro item representa seu próprio alvo e conserva a chave original do callback; não afirma que todos os irmãos foram aplicados. A resposta de ingresso só ocorre depois da persistência atômica de todos os itens. Chaves derivadas e hashes são determinísticos; um conflito com a representação antiga falha fechado e não deixa irmãos parciais. Marcadores enviados pelo provedor são removidos.

Tentativas esgotadas não se tornam sucesso e não são reabertas automaticamente se o alvo aparecer mais tarde. A recuperação desse efeito morto precisa de uma operação controlada. Receipts antigos já persistidos como `__session__` também não são reclassificados ou repetidos automaticamente. O incidente de Ana não foi recuperado em produção nesta rodada.

## Contratos observados no candidato antes desta implementação

| Contrato local confirmado | Fonte |
| --- | --- |
| Captura snapshots dentro da transação de ingresso, com epoch, antes de persistir o inbox | [webhook_ingress.go](../../apps/api/internal/whatsapp/webhook_ingress.go#L547), linhas 547–551 |
| Predecessor exato precisa estar concluído ou possuir outcome no mesmo org/SID | [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L83), linhas 83–109 |
| Linhas anteriores da mesma lane/epoch/rota e eventos `__session__` continuam barreiras FIFO | [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L114), linhas 114–130 |
| Avalia prioridade antes de escolher a cabeça; exceção transitiva preserva FIFO e rejeita ancestral morto | [webhook_dependency_priority.go](../../apps/api/internal/whatsapp/webhook_dependency_priority.go#L3), linha 3; [webhook_dependency_claim.go](../../apps/api/internal/whatsapp/webhook_dependency_claim.go#L7), linhas 7–10 |
| Suporta a representação de cabeçalho de álbum sem inventar mídia | [webhook_native_structured_content.go](../../apps/api/internal/whatsapp/webhook_native_structured_content.go#L18), linha 18 |
| Conclusão verifica snapshot, cardinalidade e outcomes junto à atualização do inbox | [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L1207), linhas 1207–1273 |
| Receipts atualizam alvos conhecidos monotonicamente e deixam o batch em retry quando há IDs ausentes | [webhook_native_processor.go](../../apps/api/internal/whatsapp/webhook_native_processor.go#L5166), linha 5166; linhas 5272–5279 |

O suporte a álbum não reabre por si uma linha já `dead`. A prioridade transitiva também não resolve sozinha a raiz morta e as barreiras de receipts de Ana. A versão/configuração publicada permanece não verificada, e o schema publicado observado não tinha `edge_execution_id`; uma entrega do candidato exige compatibilidade de API, SQL e Edge.

## Contratos da proposta e limites preservados

### 1. Separar captura durável de enriquecimento de conteúdo

Manter o recebimento bruto durável e deduplicado. Para uma **mensagem de cliente identificada com segurança**, executar a captura de identidade, rota, snapshot, atribuição e linha de mensagem em uma transação curta, antes de operações lentas de mídia ou decodificação. A resolução de lead usa o snapshot congelado e a proveniência do predecessor, nunca o vínculo atual escolhido após a chegada.

Quando o conteúdo ainda não puder ser interpretado, criar uma âncora real somente se os mínimos de captura forem provados: org/SID, identidade canônica do provedor, direção, tipo de evento de cliente, snapshot elegível, epoch e alvo coerentes. A linha real terá conteúdo neutro identificado como pendente, sem fabricar fala, mídia, autor ou resultado comercial. Os efeitos obrigatórios da captura precisam estar concluídos antes de liberar uma dependência; operações de distribuição ou vínculo que ainda não tenham sido resolvidas não podem ser escondidas por um placeholder.

Um ledger explícito de **captura ancorada com conteúdo pendente** permanece uma proposta separada, não implementada nesta rodada. O caminho suportado já captura a mensagem e o job de mídia na mesma transação; isso foi testado com download falhando e texto seguinte na mesma rota. Conteúdo ainda não suportado mantém sua dependência, sem `routing_outcome completed` fictício ou placeholder para ocultar efeito obrigatório.

O inbox original não será marcado `processed` só para liberar a fila. A implementação precisará distinguir captura concluída, conteúdo pendente e conclusão total, com estados compatíveis entre API/SQL/Edge. O job de conteúdo posterior só poderá enriquecer a mesma linha por compare-and-set: não criar outra mensagem, mudar lead/CID/SID, refazer distribuição, aumentar contadores novamente ou reproduzir efeitos comerciais.

Uma linha `suppressed`, uma mensagem sem identidade válida ou uma hipótese de controle técnico não pode virar mensagem capturada para satisfazer a fila. Subtipo desconhecido não é prova de mensagem de cliente; o envelope `Message` isoladamente também não basta.

### 2. Escalonar cabeças independentes

Usar identidade de fila baseada em `(org, SID, epoch, rota)` e manter a ordem de ingresso/proveniência, inclusive dependências entre lanes. `live` e `backlog` são prioridades, não autorização para ultrapassar uma dependência da mesma rota. Índices e plano de claim precisam ser medidos em dataset sintético antes de escolher uma migração.

Um trabalho em retry ou quarantined conserva a barreira da sua rota enquanto sua captura obrigatória não estiver concluída. O scheduler deve procurar outra cabeça elegível de outra rota, sem deixar o primeiro item bloqueado dominar a sessão. Locks curtos e `SKIP LOCKED` devem permitir escolher **outra rota**; não selecionar um sucessor da mesma rota porque sua cabeça está locked.

Cada claim/completion deve comparar org/SID/epoch/owner da lease e identidade da cabeça. Revalidar isso depois de qualquer I/O. Usar orçamento limitado por tentativa, retry com backoff e limite de tentativas; ao falhar, devolver capacidade ao executor para atender outra rota. A prova de predecessor continua vinculada ao inbox/provider ID exatos. Uma raiz `dead` sem captura concluída continua bloqueando seus próprios dependentes até recuperação autorizada.

Aplicar fairness entre sessões e rotas, limite de paralelismo e reserva de capacidade para trabalho pronto. Não aumentar concurrency/polling como substituto dessa mudança de contrato. Sem classificação do efeito, um evento genuinamente global da sessão continua sendo uma barreira global.

### 3. Tratar receipts sem transformá-los em mensagens

No caminho anterior, um receipt de chat direto podia ganhar chave `receipt:<chat>`; chat ausente, grupo, batch com chats diferentes ou identidade ambígua retornava `__session__`. A implementação desta rodada conserva esse caminho para callbacks não classificados; apenas os efeitos comprovadamente de status recebem `receipt-target:<hash>`. Não se remove a barreira por uma troca genérica de SQL.

O caminho anterior de status gravava mensagens/outbox e reconciliava notificações, mas os IDs não resolvidos permaneciam no inbox/batch para retry. Nesta rodada, o próprio inbox passou a registrar **um efeito por alvo de receipt** nos callbacks elegíveis, com parent, ordinal, hash do alvo, status e escopo/epoch. Eventos já persistidos na representação antiga não foram convertidos.

Alvos conhecidos usam a resolução canônica existente, locks em ordem e atualização monotônica. Alvos ainda ausentes aguardam em uma fila de receipts por identidade; não bloquearão conversas sem relação quando estiver provado que só alteram status de transporte. Identidade estrangeira/ambígua fica quarantined, não reconhecida como concluída. O parent só pode ser concluído segundo um contrato explícito de efeitos registrados/aplicados; não fabricar routing outcomes de mensagem para receipts.

Preservar o contrato de [processNativeEvolutionStatuses](../../apps/api/internal/whatsapp/webhook_native_processor.go#L5138): aquisição canônica do batch, validação mensagem/outbox, atribuição imutável e progresso monotônico. A migração para efeitos por alvo precisa provar idempotência de irmãos conhecidos quando um irmão está ausente, morto ou em outro tenant. Um batch desconhecido que possa conter conteúdo de cliente não pode ser desmembrado nem reconhecido como receipt por suposição.

### 4. Classificar DLQ e controles desconhecidos

| Classe | Tratamento proposto |
| --- | --- |
| Álbum conhecido e compatível com o novo parser | Recuperação durável, pontual e autorizada da raiz exata; processamento normal com efeitos reais e deduplicação |
| Mensagem de cliente comprovada, conteúdo ainda não suportado | Âncora real e ledger de captura pendente de conteúdo, somente após implementar/testar o contrato acima |
| Identidade/rota/subtipo ou efeito ambíguo | Quarantine durável; conservar a barreira da rota identificada. Se o escopo do efeito também é desconhecido, manter fence de sessão |
| Receipt bem formado com alvo futuro | Ledger de efeito pendente por alvo, sem fake ack de alvo e sem bloquear rotas independentes |
| Controle técnico comprovado pela allowlist | Persistir motivo de ignore antes de acknowledge, sem criar mensagem/outcome |

A allowlist atual é deliberadamente estreita: edição criptografada com subtipo exato e sem conteúdo de cliente/captura congelada, `readself` seguro e `buttonclick` vazio. Ver [webhook_native_processor.go](../../apps/api/internal/whatsapp/webhook_native_processor.go#L482), linhas 482–529, e persistência em `private.whatsapp_webhook_ignored_events` em [webhook_ingress.go](../../apps/api/internal/whatsapp/webhook_ingress.go#L439), linhas 439–458. Não incluir `albumMessage` nessa lista nem descartar resposta opaca com ID de botão.

O limite de um desenho seguro é explícito: não se pode prometer que toda outra rota sempre continuará quando um executor remoto ativo ou um evento de semântica global desconhecida ainda puder escrever. Nesses casos, primeiro é necessária prova de fechamento/cancelamento ou classificação do efeito.

## Limites atuais, não configuração publicada

| Limite observado no código local | Valor / fonte |
| --- | --- |
| Processamento nativo por item | 45 s, [webhook_runtime_limits.go](../../apps/api/internal/whatsapp/webhook_runtime_limits.go#L12) |
| Recovery / completion / rollback | 20 s / 5 s / 2 s, mesmo arquivo, linhas 13–15 |
| Transação nativa | `lock_timeout` 2 s, `statement_timeout` 20 s, mesmo arquivo, linha 42 |
| Claim SQL | `statement_timeout` 5 s, [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L881) |
| Retry | Backoff exponencial limitado pelo SQL; `attempts < max_attempts`, [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L1308), linhas 1308–1328 |
| Recovery de lease nativa / reserva Edge não iniciada | 5 minutos, [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L1361), linhas 1361–1419 |
| Caminhada transitiva / split de batch | 32 elos / 128 mensagens, [webhook_dependency_claim.go](../../apps/api/internal/whatsapp/webhook_dependency_claim.go#L34) e [webhook_ingress.go](../../apps/api/internal/whatsapp/webhook_ingress.go#L796) |
| Defaults de worker webhook | Intervalo 1 s, batch 10, concurrency 4, [config.go](../../apps/api/internal/config/config.go#L314), linhas 314–317 |

Esses números não foram lidos da configuração publicada. O timeout HTTP não encerra Edge ativo: o marcador permanece até fechamento real, conforme [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L1349). Não converter timeout em conclusão, descarte ou nova execução concorrente de um efeito ainda ativo.

## Matriz de implementação e homologação da fila

Os itens abaixo são **testes exigidos para a proposta**, não resultados já obtidos. Começar com fixtures sintéticas e banco dedicado; não usar a cadeia real de Ana para desenvolver o contrato.

| Caso | Resultado exigido |
| --- | --- |
| Raiz álbum `dead`, seguida de herdados `live/backlog` | Recuperação pontual cria no máximo uma mensagem; efeitos/outcomes reais; cadeia progride em ordem; replay não duplica entrada, mensagem ou contador |
| Falha/timeout antes da captura | Mesma rota continua bloqueada; outras rotas independentes avançam; lease é liberada com rollback, sem outcome |
| Falha/crash entre âncora e job de conteúdo | Transação não deixa meia âncora; após commit o job pode retomar a mesma linha; nenhum `processed` fictício |
| Unknown subtipo de cliente comprovado | Conteúdo pendente explícito; atribuição congelada; dependência aceita somente pelo novo ledger real de captura |
| Unknown ambíguo ou controle misturado com resposta | Sem mensagem inventada, sem ignore genérico; quarantine e fence apropriados |
| Receipt batch: conhecido + futuro + estrangeiro | Conhecido progride monotonicamente, futuro fica pendente por alvo, estrangeiro não muda; nenhum bloqueio de outra rota sem relação |
| Receipt `__session__` atrás de raiz morta | Só remover barreira após classificação e persistência dos efeitos por alvo; não bypass cego do parent |
| Dois workers, cabeça locked e rota vizinha pronta | Vizinha pode avançar; nenhum worker pula para sucessor da rota locked |
| Mesmo route key em lanes distintas e predecessor cruzado | FIFO/dependência preservados; prioridade não autoriza ultrapassagem |
| Transferência de lead durante retry/decode | Mesmo WM/CID/SID/lead capturado; decoder não usa vínculo atual; antigo corretor sem outra permissão perde acesso |
| Dois orgs/SIDs com provider ID/alias iguais | Sem merge, efeito ou outcome cruzado; sem lookup apenas por telefone |
| Cutover durante I/O, epoch retido e Edge ainda ativo | Worker antigo não completa nem reexecuta fora da fence; só active epoch escreve; HTTP timeout não libera Edge ativo |
| Exaustão/limite de profundidade/ciclo/retention | Fica durável e observável; sem loop infinito, conclusão inventada ou limpeza de mensagem bruta necessária à recuperação |

Usar como base as regressões existentes [receipt parcial](../../apps/api/internal/whatsapp/webhook_receipt_partial_integration_test.go#L10), [timeouts](../../apps/api/internal/whatsapp/webhook_runtime_limits_integration_test.go#L10), [barreiras](../../apps/api/internal/whatsapp/webhook_dependency_barrier_integration_test.go#L51) e [negativas de dependência](../../apps/api/internal/whatsapp/webhook_dependency_negative_integration_test.go#L8). Elas não substituem testes do novo ledger ou dos novos estados.

Antes de homologação: medir age/contagem por rota, motivos de bloqueio, pending receipts por alvo, âncoras com conteúdo pendente, tentativas, leases e outcomes. Não registrar payload, telefone, URL assinada, JWT ou credenciais. Exigir rollout compatível, rollback que reconheça os novos estados e aprovação explícita de qualquer recuperação real.

## Demora de mídia: fatos de código e medidas pendentes

Não foi medida a causa dos 3–4 segundos relatados. Separar seleção da conversa, fila local, GET de autorização/assinatura, transferência do arquivo e `loadedmetadata`/`canplay` ou decode de imagem. Não atribuir esse tempo à API, ao banco, ao provedor ou ao formato de áudio sem medir essas etapas.

| Caminho atual | Evidência estática |
| --- | --- |
| Página monta até 50 mensagens e pede DTO sem links assinados | [ConversationsScreen.tsx](../../components/features/whatsapp/ConversationsScreen.tsx#L632), linhas 632–636 |
| Cada mídia armazenada montada sem URL inicial pede GET adicional | [use-whatsapp-message-media-url.ts](../../hooks/use-whatsapp-message-media-url.ts#L129), linhas 129–133; fanout de N mídias é provado, duração não |
| GETs do hook têm teto global 4 e dedup somente na instância | Mesmo hook, linhas 7–32 e 92–104; não há gate de viewport nessa etapa |
| Balão usa default `includeMediaUrls = true` | [use-whatsapp-messages-paginated.ts](../../hooks/use-whatsapp-messages-paginated.ts#L63), linha 63; não presumir o mesmo fanout adicional quando DTO vem assinado |
| Backend hidrata em lote com escopo antes/depois e até 6 signers | [repository.go](../../apps/api/internal/whatsapp/repository.go#L1472); query count de escopo não cresce por mensagem |
| Cache de assinatura já existe; misses simultâneos agora compartilham somente a assinatura | [repository.go](../../apps/api/internal/whatsapp/repository.go#L1427) e [media_signing_coalescing.go](../../apps/api/internal/whatsapp/media_signing_coalescing.go): TTL 15 min, margem 1 min, cache e voos com teto 4096 |
| TTL recebido por GET é usado; URL inicial ganha orçamento local de 14 min | Hook, linhas 59–60 e 106; timer das linhas 134–137 renova todo componente montado |
| Galeria não faz prefetch | [use-whatsapp-media-gallery.ts](../../hooks/use-whatsapp-media-gallery.ts#L47) e [whatsapp-media-gallery-read.ts](../../lib/whatsapp-media-gallery-read.ts#L13): leitura selecionada autoriza novamente, sem cache de URLs; readers não coalescem promises |
| Áudio usa `preload="metadata"`; blob completo é fallback de erro | [MessageAudioPlayer.tsx](../../components/features/whatsapp/message-bubble/MessageAudioPlayer.tsx#L246), linhas 246–273 e elemento audio no final; [message-media.ts](../../components/features/whatsapp/message-media.ts#L565), linhas 565–581 |

O backend individual verifica visibilidade/atribuição/path antes de assinar e revalida depois do Storage I/O, inclusive em cache hit: [repository.go](../../apps/api/internal/whatsapp/repository.go#L1395), linhas 1395–1419. A assinatura usa HTTP com limite local de 20 s em [storage.go](../../apps/api/internal/whatsapp/storage.go#L55); isso é um limite, não tempo observado. O fallback de blob tem limite de 20 s em [message-media.ts](../../components/features/whatsapp/message-media.ts#L599).

### Otimizações candidatas, após prova local

1. **Priorizar o que está visível e a intenção do usuário.** Pedir URL no viewport ou em ação explícita, com fila bounded. Não enfileirar automaticamente todas as mídias históricas antes da mensagem visível. Preservar placeholder e erro honesto; ações foreground devem usar a mesma autorização, sem rota de bypass.
2. **Coalescer somente requests idênticos no mesmo lifetime autorizado.** Compartilhar promessa entre bubble/galeria apenas com chave completa: org, usuário, geração da sessão autenticada, access scope, SID WhatsApp, lead/CID/message, origem/path e versão. Remover a promessa ao concluir; não criar cache global de URLs/decisões de autorização. A galeria continua autorizando uma seleção nova quando não há request idêntico em andamento. Um consumidor que aborta não pode cancelar os demais; quando todos saem, abortar e impedir resposta tardia de escrever estado.
3. **Preservar o cache/coalescing de assinatura atrás da autorização.** O candidato local abaixo evita assinaturas duplicadas para misses simultâneos do mesmo org/path/configuração, sem manter lock SQL durante rede. Cada caller ainda revalida acesso e atribuição antes de receber a capacidade. Não aumentar paralelismo antes de medir saturação.
4. **Respeitar validade real da URL.** Compartilhar `expiresIn`/momento de obtenção, não estender 14 minutos a uma URL antiga só porque foi remontada. Renovar conforme necessidade/visibilidade e sem loop por falha. Preservar a invalidação por 403/404/410 e cancelamento em logout, troca de usuário/org/SID/lead e revogação de acesso.
5. **Separar autorização de transporte/decode.** Medir quantos GETs de link e requests de arquivo cada áudio dispara; conservar o fallback de blob limitado a erro, abort/limite de bytes e liberação de object URLs. Não pré-baixar o arquivo inteiro para todas as mensagens. URL refresh durante playback precisa teste que preserve posição, rate e owner do áudio.

O fingerprint frontend agora inclui a SID autenticada no `accessScope`, além de UID/org/permissões e escopo físico WhatsApp ([hook](../../hooks/use-whatsapp-message-media-url.ts#L53); [query scope](../../hooks/use-whatsapp-query-scope.ts#L10)). A troca de sessão aposenta leituras, URLs e callbacks antigos. O `draftAccessScope` conserva texto do mesmo usuário/organização/permissões, mas tokens de visita impedem callbacks de uma sessão anterior e retorno A→B→A; o rascunho de lead ainda sem conversa também tem essa separação. Provas: `D:/Vimob/tmp/whatsapp-auth-sid-local-20261014/sid-draft-manifest.json` e `lead-unbound/lead-unbound-manifest.json`. Uma otimização futura de promessas no frontend precisa respeitar essa geração; ela não foi implementada por esse patch. Separadamente, os 54 registros JWT WhatsApp do candidato agora usam `withActiveModulePermission`, que valida a sessão antes de tenant/módulo/permissão ([routes.go](../../apps/api/internal/app/routes.go#L190)). A revisão local conferiu as negativas de GET/HEAD de mídia e o guard; a evidência da equipe em `D:/Vimob/tmp/whatsapp-route-active-session-20261014/route-session-manifest.json` registra 4 suítes unitárias, app 59 PASS/2 integrações opt-out SKIP e integração SQL dedicada 1 teste/80 subtestes PASS. Isso não revoga retroativamente URLs emitidas ou requests admitidos antes de remover a sessão e não comprova a versão publicada. O revalidador de actor depois do Storage continua verificando membership/grants/atribuição; esse patch não compartilha ou armazena seu resultado.

### Melhoria local de assinatura comprovada

O RED bloqueou a primeira resposta do Storage e comprovou **2 POSTs concorrentes para a mesma mídia**. O candidato produz 1 POST para os dois callers. O registro de voos usa org, caminho normalizado, bucket, origem e identidade opaca do cliente HTTP. Não usa credenciais como chave, não altera o cache durável preexistente por `objectPath` e depende da configuração Storage imutável da instância atual; não introduz isolamento de cache entre configurações diferentes nem promessa compartilhada de ACL/SID.

Cada caller conserva seu contexto e sua autorização antes/depois do I/O. O executor compartilhado tem limite de 20 s; cancelar um waiter não cancela os demais. Cancelar o último remove e cancela o voo; sua resposta tardia não publica URL nem remove um substituto. O mapa tem teto 4096, com fallback à assinatura direta quando cheio. Erro/URL vazia não ficam no cache, e o TTL é calculado da expiração absoluta depois da espera, sem extensão.

Evidência local em `D:/Vimob/tmp/whatsapp-signing-coalescing-20261014`: `red.log`, `green.jsonl`, `source-before.json`, `source-freeze.json`, `repository.patch`. Foco: **12 testes principais PASS, 0 FAIL, 0 SKIP**, com 9 subcasos cobrindo cancelamento de ambos os tipos de waiter, resultado tardio/substituto, erro/vazio/retry, cinco dimensões de namespace, saturação, cancelamento anterior, cleanup e TTL. Pacote WhatsApp completo: **623 PASS, 0 FAIL, 2 SKIP**, 290,939 s, no clone dedicado `127.0.0.1:57922`, sistema `7696313589555176164`, via runner com guards. Os pulos foram `TestLocalEdgeExecutionFenceAndCutover` e `TestLocalUnlinkedStorageGC`, que exigem serviços Edge/Storage reais ausentes nesse ambiente. `full-go-package.jsonl`, `full-go-before-source-hashes.json`, `full-go-after-source-hashes.json` e `proof.json` vinculam o resultado a **229 fontes Go sem mudança durante a execução**. Revisões independentes de Root e Updates não identificaram P1/P2 novo concreto. `-race` não foi executado: CGO estava desativado e não havia gcc/clang no PATH; nenhum compilador foi instalado. O benefício comprovado é reduzir assinaturas duplicadas; quantidade de GETs frontend, latência real de abertura e download/decode não foram reduzidos ou medidos por esse teste.

### Validação e medição de mídia

Exigir fixtures de 50 mensagens com N mídias, cold/warm URL, DTO com/sem URL e dois consumidores da mesma mensagem. Medir quantidade de GETs, máximo simultâneo, prioridade visível e fila local, com zero requests reais nos testes. Demonstrar que render/hover não dispara escrita, e que uma única ação explícita não duplica refresh/download.

Negativos: mesmo UID com nova sessão autenticada; SID revogado/missing/mismatch/recovery; duas orgs/SIDs; lead transferido; path/capture state alterado durante assinatura; galeria fechada enquanto resposta chega; unmount de um consumidor compartilhado; URL expirada; erro de decode; retry único; 403/404/410; áudio play/pause/rate/seek/owner e ausência de object URL leak. No servidor, preservar os testes de [perda de acesso durante Storage I/O](../../apps/api/internal/whatsapp/media_response_access_deep_integration_test.go#L23) e [hidratação após perda de leitura](../../apps/api/internal/whatsapp/media_response_access_deep_integration_test.go#L351).

Na medição natural autorizada da UI, guardar somente durações, contagens, status e categoria do endpoint com URL redigida. Não extrair headers, tokens, URLs assinadas completas, base64, áudio/conteúdo ou payload de clientes. A evidência deve separar ambiente publicado do candidato local e latência de link, download e readiness/decode.

## Entrega em fases

1. Homologar a coalescência de assinatura local e medir a mídia; uma otimização frontend posterior exige os negativos de escopo/SID e autorização própria. SQL permanece sem alteração por esse patch.
2. Concluir a validação local do isolamento e do ledger de receipts nesta rodada. O contrato genérico de âncora com conteúdo pendente permanece separado e não é necessário para o caminho de mídia já suportado.
3. Preparar release coerente API/SQL/Edge e plano de rollback/observabilidade, sem recuperar eventos reais automaticamente.
4. Só com autorização operacional, classificar e recuperar a raiz exata do incidente de Ana, acompanhar a cadeia e verificar mensagens/outcomes sem duplicatas.

**Estado desta rodada: isolamento local implementado, com teste final registrado no relatório de fechamento. Nenhuma migração, publicação ou recuperação de evento real foi executada.**
