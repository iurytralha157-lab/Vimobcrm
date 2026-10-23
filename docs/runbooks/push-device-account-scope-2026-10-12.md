# Dispositivo push por conta: ajuste local de 12/10

Este documento complementa [a revisão adicional do WhatsApp](whatsapp-deep-fixes-local-2026-10-12.md). Produção, configurações remotas e provedores não foram alterados. As duas migrations abaixo são candidatas locais, ainda não aplicadas nem verificadas no PostgreSQL nesta rodada: o Docker/WSL local ficou indisponível. Compilação e testes com mocks não substituem esse gate.

## Contrato

O dispositivo pertence ao `user_id`. `push_tokens.organization_id` passa a ser metadado de cadastro, anulável quando essa organização é excluída. Cada entrega exige usuário ativo e associação ativa/não excluída **na organização da notificação**. A organização gravada no token não autoriza uma entrega nem limita o dispositivo à última organização visitada. Assim, um cadastro feito diretamente na organização secundária B atende tanto uma notificação autorizada de B quanto o WhatsApp da organização original A. A regra de operação do WhatsApp permanece restrita à organização original.

O destinatário de WhatsApp continua sendo o responsável atual com entrada de atendimento e autorização efetivas. O aviso ainda pendente segue o redirecionamento existente; a entrega já iniciada não é repetida. O protocolo interno do worker novo é `|push_device_v3|wa_push_v2`. Trabalhadores antigos não recebem a exceção de token entre organizações; notificações genéricas anteriores na mesma organização mantêm seu contrato.

O cadastro e a desativação Native/Web fixam UID, organização do gesto e `session_id`. Uma renovação de token com o mesmo SID continua válida. Troca de conta, organização, sessão, retorno A→B→A ou unmount abortam a intenção anterior. A API confere a identidade antes do primeiro HTTP e após uma renovação decorrente de 401. A desativação de endpoint usa o SID confiável do JWT no servidor; um cleanup SID1 não desativa uma inscrição feita pela SID2 da mesma conta. Linhas legadas com SID nulo continuam passíveis de limpeza pelo próprio UID.

## Migrations e admissão

1. `20261012223833_push_device_user_owned_delivery_scope.sql`: FK de organização `ON DELETE SET NULL`; autorização por organização da notificação; protocolo v3; início de entrega sob locks de usuário→associação→token; preflight de WhatsApp com atores antes de sessão/conversa/lead e CAS `40001` quando o responsável muda durante a espera.
2. `20261012232821_push_device_endpoint_owner_exclusivity.sql`: `registration_sid` derivado da admissão autenticada; chave física compartilhada para o mesmo token Native Android/iOS e endpoint Web; índice único parcial que permite somente um dono ativo por dispositivo. A migration aborta ao encontrar grupos ativos duplicados e informa somente a contagem. Não escolhe um dono nem desativa registros existentes.

`SavePushToken` usa uma transação única: usuário/associação→advisory da chave física→sessão Auth atual→desativação de outros UIDs→adoção de registro legado próprio→upsert→commit. O SID vem exclusivamente do contexto autenticado e é relido em `auth.sessions` depois da espera pelo dispositivo. A transação tem timeouts limitados e não mantém locks durante I/O do provedor. Adoção de row legado conserva seu ID; o `ON CONFLICT` inclui o predicado do índice parcial canônico.

`SyncOnly` preserva a política anterior: não reativa um dispositivo inativo do próprio usuário. A transferência de propriedade ocorre antes dessa decisão, portanto a conta atual pode retirar o vínculo de outra conta e receber `RequiresResubscribe`; isso exige uma inscrição explícita para voltar a receber. O opt-out Web é por UID, com compatibilidade de leitura do valor antigo por organização. Uma inscrição explícita atual grava a decisão de permitir por UID.

O catálogo da API lista somente dispositivos do UID autenticado, independente da organização aberta. Não projeta SID nem metadado de organização. A remoção de organização no administrador deve preservar `public.push_tokens`; essa dependência tem implementação e fixture próprias no domínio Admin. Os tipos gerados precisam ser regenerados pelo schema verificado; não foram editados manualmente.

## Rollout necessário

- Antes de aplicar o índice, diagnosticar grupos duplicados sem imprimir endpoints/tokens. Se houver duplicatas, interromper a implantação e revisar a propriedade com autorização; não executar desativação automática por horário ou suposição.
- Pausar e drenar escritores antigos de cadastro/desativação, dispatchers antigos e emissores Edge diretos que não adotam o protocolo. Aplicar as migrations revisadas, atualizar a API/worker e então retomar. O índice impede dois donos ativos; não transforma duas operações autocommit antigas em uma operação atômica.
- O protocolo SQL controla o worker normalizado. Um serviço com `service_role` que envia diretamente ao provedor fora desse claim não recebe uma garantia automática de v3. Não ativar a exceção de organização mantendo esse caminho antigo em execução.
- Não restaurar grants de escrita de `push_tokens` para `anon`/`authenticated`. Reversão deve ser uma correção aditiva revisada; não remover a exclusividade para contornar conflitos.
- Reconciliar o ledger conforme `supabase/README.md` antes de qualquer implantação. Não usar `db push` na divergência atualmente documentada.

## Evidências e gates ainda pendentes

Os artefatos desta rodada ficam em `D:/Vimob/tmp/whatsapp-final-adjustments-20261012/media/`:

- API/helper reais transpilados: 14 testes passaram; quatro regressões falharam sobre o baseline antes da correção de SID. Controles genéricos do cliente: 12 passaram.
- Native/Web com React/Chromium e fronteiras mockadas: 20 passaram, sem skip ou pageerror; quatro regressões SID e uma regressão de opt-out foram observadas no baseline. Não houve chamada ao hardware ou provedor real.
- Prévia de áudio: baseline do handler real falhou em três de quatro casos. O caso adicional de prévia já tocando ao trocar contexto revelou, pela avaliação do callback/dependências reais em RAM, que a mesma URL não disparava cleanup; a asserção do baseline falhou e os cinco casos atuais de handler/layout passaram. Duas tentativas Chromium baseline excederam o timeout de infraestrutura e não constituem RED de produto. A suíte React atual passou em 33 casos, incluindo esse cleanup, sem skip ou pageerror. Não houve reprodução com hardware de áudio real.
- Settings offline: quatro testes principais e cinco casos de subject passaram; a leitura de contrato verifica a fronteira transacional e a ordem de admissão. Isso não valida o SQL no banco.
- O arquivo `notification_push_device_scope_integration_test.go` compila sem opt-in; seus 25 cenários de banco foram **SKIP**, não GREEN. Preparados: A+B, boot direto B, exclusão de cadastro B, autorização revogada, token/UID revogados, v1/v2/v3, HTTP já iniciado, ordem concorrente de atores/transferência, cadastro por conta, dois UIDs concorrentes, SID1 cleanup versus SID2, SID revogado enquanto aguarda advisory, adoção legado ativo/inativo e writer legado tentando duplicar dispositivo.

Quando o ambiente estiver pronto, verificar primeiro o container exato `vimob-wa-test-ready-20261011`, label `vimob.test=whatsapp-20261011`, porta `127.0.0.1:57922` e banco `vimob_whatsapp_clone`; obter janela exclusiva com o responsável pelo ensaio. Aplicar somente as duas migrations candidatas revisadas ao clone. Executar os testes com `VIMOB_RUN_WHATSAPP_PUSH_DB_TESTS=LOCAL_WRITE_TEST`, o DSN sintético e `VIMOB_WHATSAPP_TEST_TARGET_VERIFIED=vimob-wa-test-ready-20261011`, usando `go test ./internal/leads -run '^TestNotificationPushDevice' -count=1 -v`. Todos os HTTP desse fixture são `httptest` local. Confirmar cleanup, incluindo tokens e sessões Auth sintéticas, e executar a fixture Admin de exclusão de organização. Sem esse resultado, não declarar o pacote pronto para publicação.

## Limites materiais

A exclusividade elimina dois destinatários ativos no mesmo endpoint. O registro válido é o último commit autorizado da API; não determina qual gesto deve vencer entre duas sessões **ainda válidas** cujos Save já foram admitidos no servidor: não existe nonce confiável do dispositivo para ordenar gestos. A revalidação Auth bloqueia a sessão já revogada, e o SID protege a limpeza antiga; o servidor não interpreta SID ou `created_at` como ordem entre contas. Uma réplica antiga pode desativar o dono atual antes de falhar no índice, daí a exigência de parar/drenar escritores antigos. Não anunciar proteção universal de “último gesto” para um HTTP já iniciado.

O clique da notificação ainda exige abrir a organização permitida para atendimento; o Native mantém seu comportamento atual de registro ao relogin. Não foi criada uma preferência Native nova. A API pública do SDK Supabase não oferece pin de SID para `signOut({ scope: 'local' })`; os guards antes/depois dos awaits não cancelam um I/O já iniciado dentro do lock do SDK. Hardware, FCM/Web Push reais, entrega em segundo plano, TTL de URLs assinadas já emitidas e escala 5–6k continuam exigindo piloto e medição autorizados.
