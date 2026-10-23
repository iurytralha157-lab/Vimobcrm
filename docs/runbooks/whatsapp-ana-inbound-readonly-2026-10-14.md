# WhatsApp: recebimento de Ana — diagnóstico somente leitura

Data: 14/10/2026. Este registro reúne o rastreio de metadados realizado no banco publicado durante a sessão de auditoria e a leitura do código local. Os contadores e estados abaixo são uma fotografia dessa consulta; não representam monitoramento contínuo.

Nenhum evento foi reprocessado, descartado ou marcado como concluído. Não houve alteração de filas, vínculos, permissões, mensagens, configuração de workers ou implantação. O documento omite telefones, endereços JID, conteúdo de mensagens, payload bruto e credenciais.

## Escopo e método

| Identificador | Valor |
| --- | --- |
| Organização | `01b782dc-6921-52eb-bc58-bb9d0d46d736` |
| Sessão WhatsApp | `3bf13e03-9613-448e-aff8-8aaddced472f` |
| Lead de Ana | `69ac1245-be0b-43c0-a543-e7f2553de7e9` |
| Conversa de Ana | `4e459517-3c7b-4ba2-89d9-2ada7cd13ecc` |

O agente principal consultou o Supabase já aberto no navegador autorizado pelo usuário. As consultas tiveram escopo de organização/sessão e IDs exatos, precedidas de introspecção das colunas presentes. Cada consulta foi delimitada por `BEGIN READ ONLY`, `statement_timeout` de 5 segundos, `lock_timeout` de 1 segundo e `ROLLBACK`. Não foram executadas funções de recuperação ou CTEs de escrita.

A consulta existente do usuário, número 951, foi preservada. Foi criado o rascunho privado número 317; o editor salvou o texto SQL e metadados desse rascunho. Esse salvamento não alterou dados de negócio. As consultas expuseram somente os metadados necessários à investigação; este registro não reproduz identificadores de telefone ou payloads.

## Estado confirmado da conversa

No escopo exato da conversa e de seu lead, havia 107 mensagens recebidas e 430 enviadas, capturadas para o mesmo lead. A consulta não encontrou mensagens suprimidas nem mensagens capturadas para outro lead nesse CID. A última recebida persistida tinha `sent_at` em **11/10/2026 às 12:20:54 UTC**, equivalente a **09:20:54 em São Paulo**.

As duas páginas observadas da API publicada, de 50 mensagens cada, continham somente mensagens enviadas. Isso descreve essas páginas; não significa que a conversa não possua histórico recebido.

Os aliases PN, PN no formato `@c.us` e LID consultados estavam coerentes com a mesma organização, sessão, identidade canônica e lead. Não foi usada correspondência apenas por telefone entre organizações ou sessões. A sessão estava conectada e ativa. A conversa tinha `archived_at = NULL` e `deleted_at = NULL`; o texto **Arquivados** na UI correspondia à etapa do lead, não ao arquivamento da conversa.

## Raiz encontrada e cadeia de bloqueio

O rastreio por predecessor exato encontrou o inbox abaixo na raiz da cadeia:

| Campo | Valor confirmado |
| --- | --- |
| Inbox | `18b26c44-656c-452f-9f58-c284b388c072` |
| Provider message ID | `2A294BA0D2E7DAC4A234` |
| Estado / lane / epoch | `dead` / `backlog` / `1` |
| Criação | 07/10/2026 22:40:31 UTC |
| Entrada em dead | 08/10/2026 01:52:19 UTC |
| Tentativas | 12 |
| Erro | `native WhatsApp processor does not support this event` |
| Estrutura observada | Evento `Message`, envelope `data.Info` + `data.Message`, nós `albumMessage` e `messageContextInfo` |
| Direção / edição | `isFromMe = false`, `isEdit = false` |
| Roteamento | Snapshot, `binding_eligible = true`, sem predecessor |
| Routing outcome | Ausente para o provider message ID exato na organização/sessão |

O erro e a estrutura identificam uma mensagem recebida de álbum rejeitada pelo processador que atuou nesse evento. O registro não contém conteúdo ou mídia do cliente. O SHA e a configuração atuais do backend publicado não foram verificados; a constatação não atribui uma versão específica ao processador publicado.

Todas as linhas seguintes pertencem à organização e à sessão indicadas no escopo:

| Ordem | Inbox / grupo | Relação confirmada |
| --- | --- | --- |
| 1 | `18b26c44-656c-452f-9f58-c284b388c072` | Raiz `dead`, sem outcome |
| 2 | `a1550d22-77f3-4780-98c5-543d7c1c3d89` | Evento `live` com predecessor exato na raiz |
| 3 | `61c7bd87-5a91-4efb-ada5-3abdec3b2b9c` | Evento `live` com predecessor exato no elo anterior |
| 4 | `5804b4fa-69fc-4433-8e4a-af621f0e6dc2` | Evento `backlog` dependente do elo anterior; criado em 09/10 às 13:52 UTC, `pending`, zero tentativas; rota diferente da de Ana |
| 5 | Receipts `backlog` com rota `__session__`; primeiro `1e21a186-3305-4ffc-ae22-920fc24b713a` | Primeira barreira de sessão observada em 09/10 às 14:01 UTC, `pending`, zero tentativas; posterior ao elo 4 e anterior à cabeça de Ana |
| 6 | `30456271-3039-4f3d-b7c0-90ed17fca5f9` | Cabeça `backlog` de Ana, criada em 11/10 às 12:21:11 UTC; sem predecessor próprio, mas atrás das barreiras de sessão |
| 7 | 224 eventos seguintes da rota de Ana | `pending`, herdando o predecessor; cadeia observada até 14/10 às 03:24 UTC |

Os elos 1–4 são vínculos explícitos de predecessor. A passagem pelos receipts e até a cabeça de Ana é uma **barreira FIFO da sessão**, não uma associação inventada de predecessor entre contatos.

A cabeça de Ana estava vencida para execução (`due = true`), com zero tentativas, máximo de 12, sem erro, `processing_lane = backlog` e epoch 1. Seu snapshot estava vinculado ao lead/CID acima, era elegível, tinha versão 1 e correspondia ao ledger; não havia predecessor no payload de roteamento nem no ledger. A direção recebida também foi confirmada. Portanto, seu bloqueio não era uma falha de parsing já tentada nesse inbox: ela ainda não havia sido executada.

O rastreio demonstrou uma fila durável parada: a raiz morta mantém dependentes sem conclusão; o backlog anterior impede receipts de sessão de avançar; esses receipts impedem o backlog posterior, incluindo a cabeça de Ana e seus 224 dependentes. Outras rotas `live` podem avançar enquanto essa barreira de backlog permanece. Isso não justifica remover a barreira `__session__` ou relaxar FIFO.

## Código local: explicação e limites

O checkout local estava em `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, com alterações ainda não implantadas. As referências abaixo explicam os contratos do candidato local; não são prova de que esse código esteja executando no ambiente publicado.

| Contrato | Fonte e linha |
| --- | --- |
| Erro do processador nativo para evento não suportado | [webhook_native_processor.go](../../apps/api/internal/whatsapp/webhook_native_processor.go#L449), linha 449 |
| Representação legível de `albumMessage`, sem inventar mídia | [webhook_native_structured_content.go](../../apps/api/internal/whatsapp/webhook_native_structured_content.go#L18), linha 18; uso no [parser](../../apps/api/internal/whatsapp/webhook_native_parser.go#L232), linha 232 |
| Predecessor precisa estar concluído no inbox exato ou possuir outcome no escopo exato | [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L83), linha 83; escopo e conclusão nas linhas 97–109 |
| FIFO considera linhas anteriores `pending/retry` da mesma lane/epoch; a rota `__session__` constitui barreira | [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L114), linha 114; estados na 118, ordem na 124 e rotas nas 126–129 |
| Prioridade de dependência não recupera evento morto nem declara predecessor concluído | [webhook_dependency_claim.go](../../apps/api/internal/whatsapp/webhook_dependency_claim.go#L3), linha 3; limite de 32 elos na 34, apenas `pending/retry` na 39 e ausência de outcome na 60 |
| Conclusão exige correspondência exata com o snapshot e grava outcomes junto à conclusão do inbox | [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L1207), linha 1207; escrita dos outcomes na 1225 e condições de conclusão nas 1271–1273 |
| Schema exigido pelo candidato inclui `edge_execution_id` | [webhook_ingress.go](../../apps/api/internal/whatsapp/webhook_ingress.go#L58), linha 58; claim em [webhook_worker.go](../../apps/api/internal/whatsapp/webhook_worker.go#L67), linha 67; espera pelo schema na 372 |
| Proveniência herdada preserva epoch, provider e inbox do predecessor | [20261011174224_guard_whatsapp_inherited_predecessor_provenance.sql](../../supabase/migrations/20261011174224_guard_whatsapp_inherited_predecessor_provenance.sql#L17), linha 17 |

A introspecção publicada confirmou que `whatsapp_webhook_inbox` **não tinha `edge_execution_id`**. Não foi executada uma consulta que exigisse essa coluna, nem sua ausência foi representada como um valor `NULL`. API, SQL e Edge do candidato precisam de uma implantação coerente e de verificação de compatibilidade. Defaults do código, readiness e a existência de mensagens enviadas não comprovam a configuração efetiva nem a atividade de cada worker publicado.

O suporte local a álbum representa o cabeçalho como conteúdo estruturado legível. Implantá-lo não reabre automaticamente uma linha já `dead`. A prioridade transitiva também não basta para sanar essa cadeia: seu contrato rejeita ancestrais mortos e preserva as barreiras FIFO.

Um inbox `processed` sem outcome, isoladamente, não prova perda: eventos técnicos, receipts ou fluxos legados podem ter contratos diferentes. Este diagnóstico usa o predecessor exato, sua elegibilidade e a ausência de conclusão/outcome da raiz; não presume que todo registro LID ou todo receipt deva produzir um outcome de mensagem.

## Evidência de validação local

O caso de álbum está coberto por [webhook_native_structured_content_test.go](../../apps/api/internal/whatsapp/webhook_native_structured_content_test.go#L35), linha 35. Os testes de prioridade e barreiras estão em [webhook_dependency_integration_test.go](../../apps/api/internal/whatsapp/webhook_dependency_integration_test.go#L167), linha 167, e [webhook_dependency_barrier_integration_test.go](../../apps/api/internal/whatsapp/webhook_dependency_barrier_integration_test.go#L51), linha 51. Os negativos incluem falha fechada e impossibilidade de fabricar outcome em [webhook_dependency_negative_integration_test.go](../../apps/api/internal/whatsapp/webhook_dependency_negative_integration_test.go#L8), linha 8, e linha 122.

O artefato local `D:/Vimob/tmp/whatsapp-db-validation-20261013/full-go-closure-proof.json`, concluído em `2026-10-14T03:19:26.0407708Z`, registra **616 testes de topo: 614 PASS, zero FAIL e 2 SKIP**. Foram verificados 227 hashes de fontes sem mudança durante aquela execução. Os skips foram `TestLocalEdgeExecutionFenceAndCutover` e `TestLocalUnlinkedStorageGC`; portanto, o resultado não comprova integração real com Edge ou Storage.

Log: `D:/Vimob/tmp/whatsapp-db-validation-20261013/go-local-full-closure.jsonl`.

SHA-256 do log registrado no artefato: `74B88DEA2E886EBB297ACE9C353133A1F6ACFF3838F566B183B053EFB5B9D0C9`.

Essa execução usou PostgreSQL 17.11 dedicado em loopback e fixtures sintéticas, sem acesso à produção. Não houve nova execução de testes para redigir este documento. O resultado local não comprova recuperação das mensagens reais, versão implantada ou funcionamento de ponta a ponta no provedor.

## Plano de recuperação pendente de autorização

1. Confirmar a versão e a configuração efetivas do ambiente publicado e a compatibilidade conjunta de API, schema SQL e Edge. Validar o processador compatível com o subtipo de álbum antes de recuperar a raiz.
2. Reclassificar somente a DLQ exata `18b26c44-656c-452f-9f58-c284b388c072`, na organização/sessão deste registro, verificando novamente estado, identidade, snapshot, epoch, conclusão e efeitos já persistidos. Não ampliar o alvo por telefone ou por erro textual.
3. Com autorização explícita, usar recuperação durável suportada para esse evento, mantendo identidade, deduplicação e proveniência. Não editar snapshots ou vínculos, fabricar outcomes, forçar `processed` ou substituir o processamento por uma conclusão fictícia.
4. Acompanhar a conclusão real da raiz, dos dois elos `live`, do backlog anterior e dos receipts de sessão, nessa ordem de dependência. Preservar FIFO, fences de epoch/lease e a barreira `__session__`; não executar replay amplo nem liberar dependentes antecipadamente.
5. Verificar o avanço da cabeça de Ana e de seus dependentes por IDs exatos, outcomes esperados e ausência de duplicatas; depois confrontar persistência e API da conversa. Registrar contagens antes/depois e separar conclusão técnica do recebimento confirmado na UI.

**Nenhum passo operacional desse plano foi executado.** A intervenção continua pendente de autorização; este registro documenta diagnóstico e critérios de recuperação.

## Aprofundamento: prevenção de bloqueio e demora de mídia

A solicitação posterior de permitir processamento diferido sem prender outras rotas está detalhada em [whatsapp-route-isolated-recovery-plan-2026-10-14.md](whatsapp-route-isolated-recovery-plan-2026-10-14.md). O plano propõe captura realmente ancorada antes de conteúdo diferido, filas por rota e efeitos duráveis de receipts por alvo, preservando FIFO, epoch, atribuição ao lead, deduplicação e a proveniência dos predecessores. Eventos ambíguos ou executores remotos ainda ativos não são concluídos por timeout. Esses contratos ainda precisam ser implementados e homologados; não houve acknowledge, reprocessamento, alteração de fila ou implantação.

O mesmo documento separa os caminhos de mídia da página e do balão, o fanout comprovado no código local, TTL/coalescing e os testes necessários de escopo/sessão autenticada. Os 3–4 segundos relatados de abertura de áudio/mídia não foram atribuídos a uma etapa por medição nesta análise. A investigação de latência e a prevenção futura de bloqueio não substituem a recuperação pontual e autorizada da raiz morta já identificada neste caso.
