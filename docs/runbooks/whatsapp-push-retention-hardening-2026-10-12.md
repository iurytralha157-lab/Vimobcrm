# WhatsApp: correção local de push pendente e retenção de reações

Estado em 12/10/2026: código e migrations novos foram testados somente em
Postgres local descartável, com dados sintéticos. Produção, flags, provedores,
tokens reais e dispositivos permaneceram intactos. O checkout principal já
possuía alterações locais; nenhuma limpeza ou reset acompanhou este trabalho.

## Contrato e mudanças

- O push de inbound novo capturado é destinado ao responsável atual com
  atendimento elegível. A autorização considera organização original do
  usuário, vínculo atual, concessão de compartilhamento e papel administrativo
  atual do dono. Conteúdo e nome do lead não integram o texto da notificação.
- A seleção e o redirecionamento ocorrem antes de consultar token ou configuração
  do destinatário antigo, tanto no dispatcher normalizado quanto no legado.
  O token é consultado sob a mesma transação de acesso. O marcador de início é
  confirmado antes do HTTP; os locks de acesso não permanecem durante a rede.
- Configuração ausente ou nenhum token disponível não registra início de envio.
  A claim pode verificar um aviso ainda intocado mesmo após o token antigo
  ficar inativo. Dependência bloqueada só acorda por mudança de autorização.
- Aviso que nasceu sem dispositivo recebe uma pendência em
  `private.whatsapp_inbound_push_waiting`. O worker de notificações existente
  revalida e materializa a entrega ou a redireciona, mantendo a validade
  original. O recheck sem dispositivo ocorre em um minuto; não há novo worker
  Go, cron, token fictício ou mudança nas filas inbox/outbox do WhatsApp.
- O cursor privado `whatsapp_inbound_push_waiting_seed` examina até 100 avisos
  anteriores por transação, apenas dentro da validade original e sem tentativa.
  Inserts novos registram a pendência diretamente. Há índices de vencimento,
  próxima consulta, organização e paginação do seed; a fila e o cursor usam RLS
  e ACLs de backend. Expiração sem mensagem existente é limpa em autocommit
  separado, antes de adquirir os locks de autorização.
- Uma tentativa já iniciada, inclusive ambígua, impede redirecionar o aviso.
  Alteração de responsável não gera avisos históricos. Uma chamada em curso
  pode terminar depois da transferência; isso não constitui autorização para
  repetir a notificação ao novo responsável.
- A retenção canônica agora elimina reações normalizadas somente quando o alvo
  já está `suppressed`, marcado `expired` e com `unlinked_retention_scrubbed_at`.
  Inclui estado removido e legado com alvo UUID nulo quando a identidade é
  inequívoca. Histórico capturado e promovido permanece protegido. A limpeza
  tem limite de 1–2000 por ciclo e informa `normalized_reactions_scrubbed`.

## Migrations e compatibilidade

Criadas com o CLI, sem reescrever arquivos aplicados:

1. `20261012052613_whatsapp_unlinked_normalized_reaction_retention.sql`.
2. `20261012053044_whatsapp_inbound_push_preflight_order.sql`.
3. `20261012061151_whatsapp_inbound_push_worker_protocol.sql`.

A segunda altera funções existentes somente diante das cláusulas esperadas;
source drift aborta a transação. O seed inicial examina no máximo 100 avisos,
sem chamada externa. A terceira retém todo push `whatsapp_inbound_attendant`
para workers sem a capacidade interna `|wa_push_v2`, inclusive token ativo;
somente réplicas novas avançam as exceções e a recuperação waiting. Os eventos
genéricos continuam disponíveis a v1. Isso impede que uma réplica antiga
consuma o aviso e marque falha permanente antes de revalidar atendimento.
A mudança exige atualização conjunta do SQL e das réplicas Go.
A API nova precisa do helper de expiração antes de
iniciar seu worker. Preservar as flags opt-in e o bloqueio de `db push` do
`supabase/README.md`; este ensaio não reconciliou o ledger remoto.

Rollback de binário não desfaz scrub já realizado. Manter a migration aditiva,
as tabelas privadas, os tombstones e o backup; não restaurar dados expirados
nem alterar epoch/allowlist como reversão incidental. Se necessário, pausar
explicitamente o worker no ambiente autorizado enquanto se corrige o código.

## Provas reproduzíveis e escopo

Alvo conferido: container `vimob-wa-test-ready-20261011`, label
`vimob.test=whatsapp-20261011`, imagem Postgres 17.6.1.075, tmpfs, zero mounts,
porta `127.0.0.1:57922`, banco `vimob_whatsapp_clone`. O schema veio de cópia
local sem dados CRM; isso não comprova comportamento sobre dados de produção.

O wrapper preservado em
`D:/Vimob/tmp/whatsapp-local-20261012/media-push-retention-gates.ps1` verifica
nome, label, imagem, mounts, porta e nome do banco antes de cada etapa. Nenhum
endpoint externo é permitido pelo transport dos testes; todo HTTP é
redirecionado para `httptest.NewServer` em loopback.

O comando Go final seleciona os testes sem abrir serviços:

```powershell
go test ./apps/api/internal/leads -run 'TestWhatsApp(InboundPush|PushCommits)' -count=1 -v
```

Ele exige opt-in `VIMOB_RUN_WHATSAPP_PUSH_DB_TESTS=LOCAL_WRITE_TEST`, URL exata
do clone e o marcador do wrapper `VIMOB_WHATSAPP_TEST_TARGET_VERIFIED`.
Sem opt-in, as integrações dão SKIP: isso não é prova de banco.

- RED anterior, com overlay dos bytes pré-edição e SQL anterior: sete falhas
  reais de token/configuração/zero dispositivo; as duas negativas de HTTP já
  iniciado passaram. Um erro inicial de UserID na fixture foi corrigido e o
  log preservado, sem contar aquele bootstrap como prova de produto.
- GREEN final: 20 cenários de push passaram em 12,531 s, zero SKIP. Exercitam
  dispatcher real, HTTP local, transferência A→B, token antigo inativo,
  configuração bloqueada, legado sem sender/token, token atual ausente,
  ativação de dispositivo, validade original, zero-job já iniciado, bloqueio
  concorrente de notification/materialize, seed limitado e orphan expirado.
  `TestWhatsAppPushCommitsProviderStartBeforeSenderAndTransfer` também prova o
  commit do marcador antes do sender e transferência em segunda conexão.
- Compatibilidade RED: antes da terceira migration, o dispatcher Go dos bytes
  pré-edição consumia os três casos incompatíveis: token antigo inativo, token
  ativo e aviso sem dispositivo inicial. O último chegou ao HTTP local.
  Compatibilidade GREEN: o mesmo overlay sobre o schema novo passou 3/3 em
  2,665 s, sem claim, HTTP, início de tentativa ou notificação ao novo usuário.
  A rodada nova de 20 cenários inclui também a prova de que push genérico v1
  continua claimable. O sufixo é criado pelo código Go; não é flag de ambiente
  nem parâmetro fornecido pelo usuário da API.
- Retenção RED: o RPC criou reação antes da expiração; o scrub canônico de
  sete dias limpou mensagens e deixou três reações normalizadas com identidade.
- Retenção GREEN: `whatsapp_normalized_reaction_retention.test.sql`, 21/21,
  RPC real→envelhecimento da fixture→scrub canônico, incluindo estado legado
  nulo/removido, isolamento de tenant, preservação do histórico e ACL.
  A fixture inteira encerrou com ROLLBACK, sem Storage DELETE.
- Um primeiro GREEN detectou metadata JSON nula no branch novo de retry e
  colisão de event_key na fixture com duas organizações. O branch passou a
  enviar objeto e a fixture usa UUID da sessão; a rodada completa acima foi
  refeita. Os logs anteriores continuam disponíveis.

Logs: `media-push-before-red.log`, `media-push-final-green.log`,
`media-retention-before-red.log`, `media-retention-final-green.log` e
`media-push-retention-cleanup.log`, no diretório tmp acima. O ciclo de
compatibilidade está em `media-push-protocol-before-red.log`,
`media-push-protocol-old-go-green.log` e `media-push-protocol-apply.log`.
Cleanup retornou
zero em Auth/usuários/organizações/leads/sessões/conversas/mensagens/reações/
inbox/notificações/deliveries/tokens/realtime/waiting. A única linha de
`waiting_seed` é o cursor permanente com `completed=true`; a fixture de cursor
foi revertida e não apagou esse registro de controle.

## Limites e publicação futura

Não foi validada entrega real em dispositivo, PWA encerrada, FCM/APNs/Web Push
externo, latência sob 6 mil usuários ou configuração efetiva de produção.
As flags de dispatch e retenção não foram habilitadas. URLs assinadas e
revogação de acesso continuam com seus contratos próprios; estes testes não
medem expiração de URL no navegador.

Para publicar, revisar o delta completo, reconciliar o catálogo/ledger em
cópia fiel do alvo, aplicar SQL revisado antes das réplicas Go novas e confirmar
o worker opt-in. Aplicar as três migrations revisadas como um conjunto antes
de reabrir dispatch; não liberar a segunda sem o gate da terceira para
réplicas antigas. O HEAD local anterior já usava a claim normalizada; as
funções legadas de claim existentes não integram aquele loop. Isso não prova
qual binário está implantado. Inventariar consumidores efetivos e drenar ou
pausar workers incompatíveis/legados antes da publicação. Acompanhar waiting
vencido, próxima consulta, cursor concluído,
estado/idade das entregas e `normalized_reactions_scrubbed`. Fazer piloto
autorizado com dispositivos e transferência antes/depois do marcador, sem
replay em massa nem tratar o ensaio local como conclusão em produção.
