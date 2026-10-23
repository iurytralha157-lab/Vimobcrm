# WhatsApp: fechamento local e publicação conjunta

> Complemento posterior: [fechamento da revisão total de 12/10](whatsapp-audit-closure-2026-10-12.md).
> Os números abaixo são históricos; o complemento registra as novas correções,
> três migrations adicionais e validação final do conjunto atual.

## Escopo autorizado

Trabalho no checkout principal `D:\Vimob\workspaces\vimob-crm`, branch `main`,
base `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`. As 441 entradas existentes
no status local foram preservadas; patches e snapshots anteriores às edições estão
em `D:\Vimob\tmp\whatsapp-local-20261011`. O candidato de 09/10 foi apenas
fonte de comparação. A orientação de criar outro checkout no inventário de
09/10 foi substituída pelo pedido de publicar o trabalho principal em conjunto.
O inventário final usa o mesmo agrupamento de arquivos não rastreados do
baseline. Preservar esse estado não significa validar todas as features
das alterações preexistentes.

Esta preparação não executa deploy, migrações remotas, alteração de flags,
envio ao provedor ou recuperação de mensagens de produção.

A revisão ampliada de interface, balões, mídia, falhas, telefone e comportamento
está no [complemento de 11/10](whatsapp-interface-hardening-2026-10-11.md).
Os gates abaixo registram a preparação anterior; as fontes adicionais exigem
os resultados próprios do complemento antes da publicação conjunta.

## Contrato confirmado

- Contatos sem lead aparecem na inbox privada do dono da conta, inclusive após
  recarregar. É obrigatório criar/vincular lead e entrar no atendimento antes
  de responder pelo CRM. Retenção de sete dias e promoção exigem o contrato v1.
- O histórico acompanha o lead. Administradores consultam os leads da
  organização; gestores/líderes consultam os leads autorizados por seu escopo.
  O antigo responsável perde acesso quando não resta outra permissão.
- Somente administrador/dono da organização que é dono da conta autoriza
  compartilhamento. O
  receptor da conta compartilhada atende na inbox apenas leads atribuídos a
  ele. Permissão ampla de histórico não concede envio por essa conta.
- Envio pendente exige o remetente, vínculo e entrada de atendimento originais
  ainda válidos. Transferência ou revogação impede iniciar o envio antigo.
- Push é privado do responsável atual pelo atendimento. Antes de iniciar o
  provedor, um aviso intocado pode ser redirecionado ao novo responsável.
  Entrega iniciada, aceita ou concluída não é repetida para outro usuário.
- Reação altera uma mensagem identificada na mesma organização e sessão. Não
  inicia atendimento, intake, distribuição, automação, preview, unread ou push.

## Partes e evidências

| Parte | Mudança local | Verificação necessária |
| --- | --- | --- |
| Fila | Dependência transitiva limitada; seleção de head elegível antes do limite por sessão | Reprodução vermelha/verde no PostgreSQL; FIFO, sessão única, concorrência, epoch e duplicação |
| Captura/inbox | Prova do predecessor e geração; recuperação limitada ao abrir/reconectar inbox | SQL de proveniência, captura de mensagens consecutivas, persistência/retencão e teste visual |
| Acesso | Admin-only; filtro operacional do compartilhado; revalidação antes do provedor; expurgo do cache revogado | Duas organizações, transferência, regrant, downgrade e histórico versus inbox |
| Mídia/reação/push | Epoch nativo na mídia; RPC comum de reação; produtor durável e fence de push | Provedor simulado, pgTAP, remoção/replay, cancelamento/redirecionamento e dispositivos |
| Release | Migrations novas, manifests, templates e roteiro conjunto | Gates do checkout completo, comparação com banco alvo, piloto e reversão |

Verificações locais: 111 testes Node na preparação de reconciliação, cache,
rascunho, entrada, reações, som e service worker. Depois das correções finais,
57 testes Node de acesso, cache, ordenação e validação passaram; nove de
ordenação/reações passaram em outra rodada. Essas contagens se sobrepõem e
não devem ser somadas. Os 16 testes React/QueryClient em Chromium cobrem
resposta atrasada, troca A→B→A, transferência, reconciliação durante leitura,
janela mínima/renderização, cursor expirado e negação real de histórico com
status 400. Dez cenários Go/PostgreSQL de fila passaram, incluindo 19
subcasos; três integrações de autorização/compartilhamento passaram, com
cinco subtestes de histórico/mídia, após A2/B1/B2 final. Todos esses testes
específicos executaram sem pulos. Typecheck, lint e auditoria do checkout
completo passaram. Os relatórios gerados da auditoria foram atualizados;
as 147 ocorrências visuais preexistentes em 48 arquivos continuam no inventário.
O webhook Edge passou no compilador Deno, que não é coberto pelo Next.

Depois do ensaio completo A2/B1/B2 com as fontes finais, a matriz de 14
arquivos SQL passou 479 assertions, sem falhas ou pulos e com ROLLBACK em
todos os arquivos. Ela inclui 44 assertions de push/SSE e 39 de reações,
com exclusão da conversa, lease vencido, promoção legítima e rejeição de
promoção forjada. Os eventos privados de contador/som também foram
validados pelo handler real do BackendRealtimeBus.
A integração de push com envio simulado e transferência em outra conexão
passou e confirmou commit antes da chamada externa. O build das fontes
congeladas passou em Next 16.3.8/Turbopack: compilação em 7,5 minutos,
TypeScript em 94 segundos e 85 páginas em 2,6 segundos. Usou somente
variáveis sintéticas e o preload que bloqueia leitura de `.env`.

Foram reproduzidos e corrigidos quatro problemas de leitura: aviso de
reconciliação descartado durante outra leitura/janela mínima; desempate por
UUID de mensagens no mesmo segundo; remoção de reação que dependia de uma
sequência ausente do DTO público; histórico retido após o erro real
`400 invalid_whatsapp_reference`. O hook guarda uma leitura posterior,
coalesce avisos e preserva o agendamento entre renderizações equivalentes.
A interface expurga o histórico negado; erro de validação comum e o 409 de
cursor não revogam o acesso.

A leitura v2 é opt-in. Banco usa timestamp efetivo, criação, sequência
privada de admissão e UUID como último desempate. Snapshot tardio de echo
não muda a ordem da linha preexistente. Cursor transmite somente dois
timestamps UTC6 e UUID; sua âncora é resolvida dentro do mesmo escopo
autorizado. Âncora removida/trocada exige 409 e uma nova leitura da cabeça.
O frontend separa o cache v2, preserva a ordem canônica da API e microssegundos,
inclusive nas reações, sem depender de metadata privada. Reações também não
alteram preview ou último horário de mensagem no histórico.

Três testes Go de ordenação/protocolo passaram, com seis subcasos reais de
paginação, histórico, preview, backfill de provider ID, echo tardio e âncora
fora do escopo/removida. Reação no preview foi conferida pela RPC real.
EXPLAIN de cabeça v2 com mil mensagens sintéticas e ROLLBACK mostrou
Incremental Sort e o índice de timeline: 21 linhas para LIMIT 20 e 1,125 ms
nessa execução local. Isso não é SLA; a tabela de snapshots estava vazia,
então essa execução não prova o plano do lookup de rota em produção.

A rodada E2E final passou os quatro cenários em 49,3 segundos, sem pulos,
usando esse build e o binário Go final. O gate manteve p95 até 15 segundos
e máximo até 60 segundos, com medição POST→DOM independente da espera dos
guards HTTP. Com cinco amostras em cada grupo, p95/máximo foram 1.410 ms
para lead e 1.346 ms para contato sem lead. Essa amostra local pequena
não comprova SLA nem desempenho sob carga.

A API e o DOM preservaram a ordem 0→1→2 na chegada, reconciliação da cabeça
e reload, tanto em três callbacks consecutivos quanto num POST de envelope
com três mensagens. Os callbacks produziram três mensagens capturadas,
três notificações duráveis e seis hints SSE direcionados. A admissão do
envelope reconhecido gerou três entradas duráveis, todas processadas pelo
Native, com um timestamp de envio e três timestamps de criação observados.
O worker processa cada entrada em sua própria transação; o teste mede essa
divisão sem exigir criação numa transação única. O empate exato entre
envio/criação é a regressão separada de SQL/repository com fixtures
sintéticas. Metadata vazia pode estar ausente pelo contrato `omitempty`;
nenhuma chave privada é aceita pelo E2E.

As duas capturas finais foram inspecionadas, com as três mensagens inteiras
em ordem. Depois do E2E, a limpeza guardada deixou as 21 tabelas de fixture
zeradas. Os processos Go/Next e os cinco serviços oficiais criados para
esse ensaio foram encerrados após conferir PIDs e labels. O PostgreSQL
descartável em tmpfs continua ligado para preservar o schema de teste;
nenhum volume antigo ou serviço de produção foi alterado.

O build local acrescentou dois includes do diretório temporário ao
`tsconfig.json`; o snapshot anterior foi restaurado e o SHA256 conferido.
Os includes e demais alterações que já existiam no checkout foram preservados.
Typecheck completo passou novamente após as duas correções de expectativa
do E2E, que não alteraram produto ou limite de latência.

Os quatro pacotes Go afetados passaram na rodada final: 1.653 casos/subcasos
aprovados, sem falhas. Nesse comando unitário, 68 testes opcionais de banco
foram pulados deliberadamente por ausência de suas variáveis; não são prova
de integração. As integrações relevantes abaixo foram executadas em rodadas
próprias, contra o clone identificado, sem pulos.

Envio local com `httptest`: três testes principais passaram em 6,034s.
Texto percorreu SendMessage, outbox, início durável, completion e dois echoes
sem duplicação. Seis casos de imagem/áudio cobriram sucesso, transferência
antes do worker e durante assinatura Storage; as negativas consumiram zero
tentativas e fizeram zero chamadas ao provedor. Reações cobriram adição,
remoção, dedupe, completion e echo pela RPC comum. Esses testes conferem
payload e fences; não comprovam bytes/reprodução de mídia no telefone real.
O guard original de texto em 57722 foi mantido; 57922 exige opt-in, marker
de label e nome exato do banco descartável. Após cleanup, todas as tabelas
de negócio/sessão/notificação das fixtures estavam zeradas.

## Banco descartável

O banco local antigo iniciou recuperação prolongada de disco. Para permitir
reprodução sem dados reais, foi criado PostgreSQL 17 Supabase em container
descartável `vimob-wa-test-ready-20261011`, banco `vimob_whatsapp_clone`, exposto
somente em `127.0.0.1:57922`. O diretório de dados usa tmpfs. `fsync=off` e
privilégios ampliados de fixture são exclusivos desse container; não são
configuração de release. Nenhum volume antigo foi removido ou reparado.

O clone contém somente o schema da base local de 09/10, ledgers oficiais de
Auth/Storage/Realtime e fixtures sintéticas. O dump exclui Cron operacional;
o wrapper gerado de GraphQL e os roles internos são reconstruídos conforme
a base de origem. As quatro migrations de 11/10 são aplicadas em ordem.
Isso prova compatibilidade com essa base local, não equivalência com o banco
de produção nem aplicação integral da cadeia histórica de migrations.

O primeiro start do Auth usou search_path incorreto e tentou DDL antigo fora
do schema Auth. Esse clone foi reconstruído antes de sementes e E2E. O
harness usa os serviços oficiais e roles corretos, alvos loopback e variáveis
sintéticas, sem carregar os arquivos `.env` do checkout. Adaptações do harness
ficam fora de `migrations/`. Teste pulado por falta de banco nunca é registrado
como aprovado.

A primeira execução visual revelou `wal_level=replica` no container
descartável, impedindo a replicação do broadcast. Apenas esse container foi
recriado com `wal_level=logical`; os ledgers/schema e quatro migrations foram
restaurados limpos. A2/B1/B2 e a matriz de 479 assertions passaram novamente.
O CORS temporário Kong foi ajustado para os headers reais de auth-js e
PostgREST. Esses ajustes não mudam o produto nem a configuração remota.
Uma expectativa antiga de inbox administrativa foi substituída por provas
separadas de inbox operacional e conteúdo do histórico autorizado, incluindo
conta compartilhada e conversa sem lead privada.

Os cutovers canônicos A2/B1/B2 de identidade/vínculo foram ensaiados nesse
clone vazio, com intake/workers de negócio desligados. Não são migrations
automáticas e não foram executados em produção. Os 131 testes SQL de
identidade por fila e quatro de contexto passaram depois da sequência. O
teste antigo de contexto falhou antes de B1, porque pressupõe o trigger
estrito instalado. Essa diferença de fase precisa entrar no roteiro remoto.

O ensaio revelou que a definição antiga de `set_whatsapp_message_context`
em B1 substituía as provas de promoção humana instaladas pela retenção v1.
O arquivo de cutover preserva agora os helpers exatos quando existentes,
incluindo identidade imutável e autorização privada por transação. Continua
compatível com a fase anterior sem esses helpers. As três fontes atuais
foram executadas novamente em clone reconstruído; promoção e negativas
passaram na matriz completa posterior. Nenhuma migration histórica aplicada
foi reescrita para resolver esse conflito.

Os catálogos de permissão de referência também não vêm no dump somente de
schema. Fixtures devem criar as chaves exigidas em BEGIN/ROLLBACK; a ausência
de dados de catálogo não autoriza relaxar os helpers de acesso.

## Gates locais

```powershell
npm run typecheck
npm run lint
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/whatsapp-access-revocation.test.mts lib/realtime/whatsapp-refresh-coordinator.test.mts lib/whatsapp-query-cache.test.ts lib/whatsapp-message-input.test.ts lib/whatsapp-reactions.test.ts lib/whatsapp-sound-message.test.ts lib/access/whatsapp-session-sharing.test.ts supabase/functions/evolution-go-webhook/provider-reaction.test.ts supabase/functions/evolution-go-webhook/structured-content.test.ts scripts/tests/pwa-push-service-worker.test.mjs
node --test hooks/use-whatsapp-messages-paginated.race.test.mjs
npx --yes deno@2.5.6 check --no-config --no-lock --node-modules-dir=none supabase/functions/evolution-go-webhook/index.ts
node scripts/supabase/verify-migrations.mjs
node scripts/supabase/verify-edge-functions.mjs
```

Executar os pacotes Go afetados e suas integrações com
`WHATSAPP_TEST_DATABASE_URL` explicitamente apontando para o banco descartável.
Push exige também `WHATSAPP_PUSH_TEST_DATABASE_URL` e
`VIMOB_RUN_WHATSAPP_PUSH_DB_TESTS=LOCAL_WRITE_TEST`. Os envios fake exigem
`WHATSAPP_EPOCH1_TEST_DATABASE_URL`,
`VIMOB_RUN_WHATSAPP_SEND_DB_TESTS=LOCAL_WRITE_TEST` e o marker
`VIMOB_LOCAL_WHATSAPP_CLONE_VERIFIED`; o wrapper
`D:\Vimob\tmp\whatsapp-local-20261011\run-local-outbound-regressions.ps1`
confere label, porta 57922 e banco antes de habilitá-los. Ausência dessas
variáveis pode produzir skips; conferir zero skips nas rodadas de integração.
Executar os testes SQL de proveniência, inbox/unlinked, compartilhamento,
retenção, reações e push. E2E deve usar quatro alvos loopback e dados
sintéticos; discovery ou teste ignorado não comprovam o fluxo visual.

O gate da CI atual não executa automaticamente toda essa matriz de WhatsApp.
Registrar comandos, resultados e o SHA final de cada componente.

Testes históricos de contrato foram atualizados somente para a fase atual:
captura explícita nos casos que isolam o fence de automação, catálogo de
permissões sintético, collation explícita para pgTAP no PostgreSQL 17,
campos opcionais legados do marcador e autorização por geração/escopo. Não
foram removidos constraints ou guards para acomodar as fixtures.
Replays sintéticos de retenção/histórico carregam agora o envelope de
admission v1, mantendo as verificações de conteúdo, marker forjado e
idempotência. Auto-reply desabilitado exige resposta explícita sem escrita
SQL e ausência dos triggers produtores; o caminho ativo continua exigindo
os dois triggers válidos e o guard de atendimento.

O teste React/Chromium é executado separadamente, sem o loader de alias usado
pelos testes TypeScript. O loader não é compatível com a resolução interna de
Playwright; isso não justifica alterar o loader compartilhado.

## Diagnóstico e recuperação por cadeia

`scripts/maintenance/diagnose-whatsapp-webhook-dependencies.sql` é somente
leitura, com timeout e limite de profundidade/heads. Verificar compatibilidade
do schema alvo antes de executá-lo; uma coluna ausente é bloqueio de
compatibilidade, não motivo para aplicar migração às cegas.

No diagnóstico somente leitura do navegador em 11/10, 17 caudas de
predecessor estavam `dead` e dez `pending` em backlog. Às 18:12:53 UTC, as 17
caudas mortas tinham o mesmo erro de formato não suportado e 12 tentativas.
Às 18:25:14 UTC, o inventário de nomes de campos agrupou quatro álbuns,
quatro contatos, duas localizações em tempo real, um interativo, um template
e cinco `secretEncryptedMessage`. Às 18:28:47 UTC, os cinco controles
criptografados tinham subtipo 2, alvo e ciphertext presente. Não foram lidos
textos, telefones ou conteúdo dos clientes. Esses números descrevem caudas
das cadeias no momento da consulta, não comportamento futuro. O patch
de seleção não ressuscita `dead`, não descarta mensagem e não reescreve
snapshot. Também não garante que todas as caudas pendentes tenham uma prova
válida para o caminho transitivo conservador.

O [roteiro de preenchimento](whatsapp-webhook-recovery-manifest.md) e o
[modelo de manifesto](whatsapp-webhook-recovery-manifest.example.json) estão
prontos para revisão. O modelo tem `cases` vazio e
`execution_authorized: false`; nenhum ID ou outcome desconhecido foi inventado.
O manifesto real ainda exige inventário atualizado da versão/schema alvo.

Para cada cadeia morta, classificar a falha e os efeitos duráveis existentes,
validar organization/session/epoch/route e a identidade de cada predecessor,
e preparar manifesto de recuperação exata. Conferir lease, token Edge,
outcomes, idempotência, estado do provedor e disponibilidade da sessão antes
de propor retry. Falha com resultado do provedor desconhecido exige
reconciliação. A autorização para implementar localmente não autoriza esse
replay remoto. Recuperação vem em operação separada e revisável.

O parser local reconhece os formatos estruturados conhecidos como conteúdo
legível, sem inventar URLs de mídia ou identidade a partir de vCard. Controles
criptografados de edição sem texto decifrado são identificados estritamente
antes de ordenar/capturar lotes. Eles não criam histórico ou push. Conteúdo
desconhecido continua protegido; uma captura elegível/ambígua já congelada
exige recuperação explícita. As 17 cadeias mortas não foram reativadas.

O fallback de álbum, contato, localizações, interativo e template exibe um
resumo textual. Ele não substitui renderização específica de todas as ações
desses formatos nem decifra texto de edição criptografada. Texto, imagem,
áudio e reação continuam com seus caminhos próprios.

## Concessões antigas

Executar inventário somente leitura com organização explícita antes da
publicação. Scope legado/nulo ou de equipe é inerte no novo modelo; dono que
hoje é gestor/usuário não autoriza grant. Um grant compatível com o papel
administrativo atual ainda tem `created_role_unproven`, porque o schema não
registra o papel do criador na criação. Não inferir esse papel por timestamp.
Revisar essas concessões e preparar regrant explícito quando necessário;
nenhuma limpeza em massa acompanha a migration.

O uso de WhatsApp por usuário associado a múltiplas organizações preserva
a restrição atual à organização de origem. A política de atendimento pela
organização ativa ainda depende da resposta do usuário; não foi ampliada
implicitamente junto com essas correções.

## Sequência de publicação futura

1. Fechar os gates locais e revisar as demais alterações da release conjunta.
   Preservar o inventário do delta WhatsApp para identificar regressões mesmo
   que os domínios sejam publicados juntos.
2. Comparar catálogo/ledger real com todas as migrations e dependências de
   associação, geração de acesso, RLS, notificações e WhatsApp. O bloqueio de
   `db push` do `supabase/README.md` continua vigente enquanto houver
   divergência. Não reescrever migrations aplicadas nem tratar o projeto
   cloud antigo como o banco self-hosted atual.
   O ensaio vazio não comprova o backfill de B1 sobre mensagens existentes.
   Em cópia fiel do alvo, classificar mensagens com `lead_id` nulo em
   conversas vinculadas por `capture_state`, quarantine e ledger. Captura
   ephemeral sem autorização deve impedir o corte; o backfill nunca serve
   como autorização para promovê-la ao histórico.
3. Aplicar migrations aditivas revisadas antes de escritores que chamam RPCs
   novos; publicar Go, Edge e Web com versões compatíveis. Guards de source
   drift devem abortar diante de uma função diferente, em vez de perder
   proteção. Troca de replicas não autoriza mudar processor mode/allowlist.
   Concluir a atualização de todas as réplicas Go com suporte à leitura
   `orderingVersion=2` antes de ativar a Web correspondente. Clientes antigos
   continuam usando a ordenação e os cursores legados; o cache da nova Web é
   versionado para não combinar páginas dos dois contratos. A sequência
   global de ingresso permanece privada e não integra DTO ou cursor público.
4. Confirmar os workers reais de mídia, retenção e dispatch de notificações.
   Os templates locais incluem a flag de retenção com padrão `false`.
   Mídia e dispatch também permanecem opt-in. Código e template não provam
   que um worker está habilitado em produção.
5. Tratar índice e ativação de epoch/unlinked como cutovers manuais separados,
   seguindo `whatsapp-inbox.md`: escritores compatíveis, dreno, zero tokens
   Edge relevantes, índice válido e validação de retenção/Storage.
6. Fazer piloto com número pessoal e compartilhado: contato sem lead antes e
   depois do reload, lead vinculado, mensagens consecutivas, reconexão,
   transferência com chat aberto, imagem, áudio, reação/remoção, push com PWA
   fechada e redirecionamento pendente. Conferir banco, provider ID, DOM e
   dispositivo, sem considerar apenas `202` ou `/readyz` como conclusão.
7. Medir ingestão→processamento→persistência→inbox e envio→confirmação, em
   separado. Amostras pequenas anteriores não garantem p95 sob carga. Abrir
   rollout gradual somente após verificar ordem, duplicação, acesso e fila.

## Reversão

Guardar imagens/SHA anteriores, configuração antes/depois e backup do banco.
Pausar rollout diante de erro de contrato, crescimento de fila, duplicação,
vazamento ou perda de mídia. O SQL aditivo e os tombstones permanecem para
evitar reapresentar conteúdo apagado. Não remover colunas/RPCs nem retroceder
epoch como parte automática do rollback. Uma API antiga pode ser incompatível
com capturas v1 novas; a escolha da imagem de reversão exige a mesma revisão
de escritores e leitores do cutover. Push já iniciado e mensagem já entregue
ao provedor não podem ser desfeitos pela troca de imagem.

## Limites de revogação

A revalidação bloqueia iniciar uma chamada antiga após transferência ou
revogação. Uma chamada com início durável já confirmado pode terminar depois
da transferência; o CRM não promete cancelá-la no provedor. Push iniciado usa
conteúdo genérico e não é reenviado ao novo responsável.
Um hint SSE já transmitido também não pode ser recolhido. Ele não contém
conteúdo da conversa, e o clique consulta a API com autorização atual.

A interface elimina caches revogados e cada nova emissão de mídia revalida
o lead imutável da mensagem. Uma URL Storage assinada já emitida pode
permanecer válida até seu TTL atual de 15 minutos, e bytes já recebidos não
podem ser revogados. Não confundir retirada de acesso no CRM com invalidação
imediata de um link previamente autorizado.
