# WhatsApp: mídia e identidade do dispositivo push — 12/10/2026

Correções locais no checkout principal `D:/Vimob/workspaces/vimob-crm`, baseado
em `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, preservando as alterações anteriores.
Nenhum provedor, dispositivo real, configuração remota ou banco de produção foi
usado. Esta etapa não cria migration, variável, worker ou fila durável.

## Contratos corrigidos

- O limite de quatro GETs simultâneos de mídia continua ativo. Se um pedido
  acordado for cancelado antes de adquirir a vaga, a vaga passa ao próximo.
  Um pedido cujo contexto já mudou não inicia o GET após sair da espera.
- Prévias `data:` de áudio aceitam `audio/ogg;codecs=opus` e
  `audio/webm;codecs=opus`, incluindo o valor Opus entre aspas. Os MIME continuam
  restritos por tipo de mídia; outros codecs, parâmetros extras e HTML são
  rejeitados. A aceitação da URL não comprova decodificação em hardware.
- `MediaRecorder.onstop` encerra o intervalo e fixa a duração, inclusive quando
  a parada não veio do botão. `onerror` invalida a aquisição, libera microfone,
  timer e FileReader, e impede dados ou callbacks tardios de criarem uma prévia.
- `settingsAPI.savePushToken` e `deactivatePushToken` aceitam um terceiro
  argumento `{ expectedUserId, signal }`. Mesmo sem argumento, capturam a
  identidade disponível ao iniciar a chamada. Uma identidade ausente ou
  diferente falha antes do transporte; renovar o token do mesmo usuário continua
  permitido. Os outros métodos e o comportamento genérico da API são preservados.
- Os hooks Native/Web capturam usuário, organização, geração e AbortController
  no gesto. Mudança de contexto ou desmontagem cancela a preparação e impede
  efeitos locais tardios: registro, desativação, unsubscribe, limpeza do endpoint,
  publicação de estado e atualização da interface.
- As mutações de PushManager continuam serializadas. Inicializações de hooks
  diferentes não compartilham a Promise de uma visita que foi cancelada; cada
  gesto revalida sua geração antes e após as fronteiras assíncronas.
- `deactivateCurrentPushEndpoint(org, options?)` recebe também `isCurrent`.
  Captura a revisão do endpoint lembrado antes de consultar o Service Worker.
  Uma inscrição mais nova, mesmo com o mesmo endpoint, impede a limpeza antiga.
  O chamador de logout fornece a identidade/sinal/geração do gesto.

Uma operação HTTP/PushManager já iniciada pode concluir após o cancelamento.
O cancelamento não desfaz uma operação remota já aceita; o cliente impede o uso
de outra identidade e os efeitos tardios no contexto novo. Não há reenvio
automático nem mudança nas filas de mensagens do WhatsApp.

## Evidências locais

Baseline de bytes e hashes, configurações de teste e logs:
`D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/`.

| Verificação | Antes | Depois |
| --- | --- | --- |
| Vagas de mídia, concorrência e cancelamento | 1 falha / 2 | 2/2 PASS |
| URLs/limites/compressão de mídia, incluindo Opus | Opus falha | 16/16 PASS |
| API real de dispositivo e limpeza de logout, com auth/fetch simulados | 8 falhas / 9 | 9/9 PASS |
| Hooks React Native/Web em Chromium, com Capacitor/PushManager simulados | 8 falhas / 9; troca de org: 2 subcasos falham | 10 casos + 2 subcasos PASS (12 contabilizados) |
| Parada espontânea e erro do gravador em Chromium | 2/2 falham | Incluídos no conjunto abaixo |
| Suíte React de mídia, recuperação, identidade, gravador e prévia | — | 28/28 PASS |

Todos os conjuntos GREEN acima terminaram com zero SKIP; os runtimes Chromium
verificam também ausência de `pageerror`. A execução BEFORE do gravador seleciona
somente os dois casos novos e usa a cópia anterior do hook. Os outros BEFOREs
usam os mesmos casos sobre os bytes preservados, sem mudar as expectativas.
O caso adicional de organizações mantém o mesmo usuário e cobre Native/Web:
o pedido antigo fica cancelado em `org-a`, e o registro atual usa `org-b`.

Comandos no checkout principal:

```powershell
node --test hooks/whatsapp-media-slot.test.mjs
node --experimental-strip-types --test components/features/whatsapp/message-media.test.mts
node --test lib/pwa/push-device-intent.test.mjs
node --test hooks/push-device.runtime.test.mjs
node --test components/features/whatsapp/media-ui-runtime.test.mjs
```

Para repetir os BEFOREs, as variáveis de processo `VIMOB_MEDIA_SLOT_SOURCE`,
`VIMOB_PUSH_DEVICE_BASELINE=1` e `VIMOB_MEDIA_DEEP_BASELINE=1` selecionam somente
fontes de teste locais. Não são variáveis de implantação.

TypeScript foi verificado com o projeto focado salvo na pasta de evidências,
incluindo o grafo de imports dos arquivos alterados. Lint focado e `diff --check`
fazem parte do fechamento. Gates gerais de TypeScript/lint/build são coordenados
separadamente; não se deve converter o gate focado em afirmação de gate global.

## Logout: sessão do gesto e limpeza depois das esperas

O logout do `AuthContext` captura usuário, `session_id` e geração síncrona ao
receber o gesto. O setter de sessão usado pelos eventos do SDK atualiza essa
geração antes do render: trocar A por B, voltar a A com outra sessão ou desmontar
cancela o gesto antigo. Refresh do token mantendo o mesmo `session_id` continua
válido. Sem esse claim, a comparação usa o token exato como fallback conservador.
O JWT é decodificado somente para identificar a visita do cliente; não substitui
a autorização do servidor. O claim é descrito na
[referência oficial de JWT](https://supabase.com/docs/guides/auth/jwt-fields).

O helper `signOutWithGlobalRevocation(operations, guard?)` confirma a identidade
do resultado fresco de `getSession()` antes da revogação. Em chamadas com guard,
consulta novamente o SDK antes de iniciar a limpeza local: a sessão em storage
pode já ser B enquanto o evento de auth ainda não foi entregue ao React. Uma
ausência de sessão só é aceita para o gesto previamente autenticado quando a
geração observou exatamente a transição original→null. Isso permite concluir o
logout local legítimo sem aceitar B→null ou A→B→A.

O retorno `cancelled` impede a limpeza ampla e o redirect. Um gesto explícito do
usuário atual pode começar enquanto a Promise antiga ainda aguarda o espelho de
push; o término antigo não remove o controle do gesto novo. O sinal combinado
também cancela a preparação de push quando muda a sessão do mesmo usuário.

`performFullCacheClear({ isCurrent? })` revalida o gesto após as esperas pelo
Service Worker, inscrição push, nomes e remoção de caches, e antes de limpar
storage ou navegar. Chamadas sem guard mantêm o comportamento anterior. As
operações de logout permanecem nas APIs públicas
[admin.signOut(jwt, scope)](https://supabase.com/docs/reference/javascript/auth-admin-signout)
e [auth.signOut({ scope: 'local' })](https://supabase.com/docs/reference/javascript/auth-signout).

Evidência adicional em `media/logout-baseline/` e nos logs ao lado:

| Verificação | Antes | Depois |
| --- | --- | --- |
| Helper de sessão, chamador real extraído por AST e limpeza de cache | 5 falhas do helper; 11 falhas conjuntas de caller/cache | 27/27 PASS |
| Storage do SDK muda para B durante revoke, sem evento React | 2/2 falham na fonte intermediária | Incluídos nos 27/27 |
| `SIGNED_OUT` automático, sessão inválida, dois caminhos de suspensão e recuperação | 6 falhas / 7 casos iniciais | 17/17 PASS, incluindo novos controles normais e troca de sessão do mesmo usuário |
| Clique Native já enfileirado na inicialização anterior | 2 falhas / 3 | 3/3 PASS |
| Controles legados de revogação verificada, 401/403/404, sessão ausente, refresh inválido e falha temporária | — | 11/11 PASS |

As regressões executam os corpos reais de `signOut`, setter e lifecycle do
`AuthContext` extraídos por AST, e os helpers compilados, com SDK, storage e
transporte sintéticos. Não afirmam um ensaio do AuthProvider inteiro em browser
nem revogação real no Supabase. Todos os GREENs têm zero SKIP. O controle legado
gera somente o aviso do Node `MODULE_TYPELESS_PACKAGE_JSON`; não mudou o modo de
módulos do projeto.

Os três chamadores de limpeza ampla no `AuthContext` passam o guard. O caminho
automático de `SIGNED_OUT` captura a geração já desautenticada e verifica tanto
o timer quanto as esperas da limpeza. Sessão inválida e suspensão capturam a
sessão original antes de mudar o estado do CRM e usam a revogação JWT explícita.
Uma conclusão antiga não limpa B nem mantém o controle de logout do gesto novo.
Para recuperação, `signOutLocallyWithSessionGuard` consulta a sessão original
antes do método local; não chama revogação GLOBAL. O destino legítimo de login
ou reset continua, mas um timer/lookup cancelado não limpa token nem navega B.

O listener Native de clique captura `usePushDeviceIntent` na inicialização e
confere esse gesto junto da geração do effect. Assim, a mudança de identidade
no layout já bloqueia o callback antigo antes do cleanup passivo dos listeners.
O callback de navegação é síncrono. Seu controle positivo continua produzindo
uma navegação. O runtime React Native/Web foi repetido depois desse delta:
12/12 PASS, zero SKIP e sem `pageerror`.

```powershell
node --test lib/auth/global-sign-out.race.test.mjs contexts/auth-logout.race.test.mjs lib/cache-utils.race.test.mjs contexts/auth-automatic-logout.race.test.mjs hooks/native-push-action.test.mjs
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/auth/global-sign-out.test.ts
node --test hooks/push-device.runtime.test.mjs
node node_modules/typescript/bin/tsc -p D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/tsconfig.logout.json --pretty false
node node_modules/eslint/bin/eslint.js contexts/AuthContext.tsx contexts/auth-logout.race.test.mjs contexts/auth-automatic-logout.race.test.mjs lib/auth/global-sign-out.ts lib/auth/global-sign-out.race.test.mjs lib/cache-utils.ts lib/cache-utils.race.test.mjs hooks/use-push-notifications.ts hooks/native-push-action.test.mjs
```

O log final conjunto `logout-and-native-final.log` registra os 47 casos
(27 + 17 + 3); os anteriores ficam preservados. Também finais:
`logout-controls-final.log`, `native-web-after-logout-final.log`,
`logout-typecheck-final.log` e `logout-lint-final.log`. Baseline da reabertura e
logs RED ficam em `logout-auto-baseline`, `logout-automatic-before.log` e
`native-action-before.log`. Os manifestos finais atualizados são
`logout-final-source-hashes.json` e `deep-media-auth-final-manifest.json`.
Este último reúne mídia, identidade de dispositivo e logout, substituindo os
hashes dos arquivos reabertos, sem apagar os manifestos e logs anteriores.

Há dois limites de operações já iniciadas. Uma revogação GLOBAL aceita com token
de A pode alcançar sessões novas do mesmo usuário criadas enquanto a requisição
estava em curso. Além disso, no SDK instalado `@supabase/auth-js 2.108.1`,
`GoTrueClient.ts:3901–3938`, o `signOut(local)` público espera inicialização/lock
e então lê a sessão corrente; não recebe JWT, identidade esperada ou AbortSignal.
Se B entrar depois que esse método começou, inclusive durante a espera por seu
lock, o cliente não dispõe de comparação e limpeza atômicas públicas para
impedir que o SDK limpe B. O probe antes da chamada fecha a troca já visível,
mas não elimina essa janela dentro do SDK. Nenhuma API privada foi utilizada.
As regressões comprovam que a conclusão antiga não inicia a limpeza ampla ou
redirect de B; não prometem desfazer revogação, unsubscribe ou limpeza do SDK já
iniciados. Uma garantia atômica mais forte exige contrato suportado pelo SDK ou
coordenação de sessão adicional, fora desta alteração local.

## Limites e reversão

Não foram testados permissão/microfone físico, falha real de dispositivo,
decodificação Ogg/WebM em todos os navegadores, APNs/FCM/Web Push do sistema
operacional ou entrega/clique com o CRM fechado. O piloto autorizado continua
necessário. Não houve ensaio de carga de 5–6 mil usuários.

`use-web-push.ts` já ultrapassava 800 linhas. O crescimento nesta etapa corresponde
a fences nas fronteiras assíncronas; o novo helper isola a identidade do gesto.
Uma separação posterior de inicialização/inscrição/desinscrição deve ocorrer em
refatoração própria com estes testes, sem mudanças incidentais neste reparo.

`AuthContext.tsx` também já ultrapassava 800 linhas. O delta de logout conserva
o provider e seus eventos existentes; a identificação do gesto fica no helper
de auth, e a limpeza mantém sua função pública. Uma futura separação do provider
deve preservar os mesmos testes de sessão, ABA e término tardio.

Para reverter localmente, compare cada arquivo com sua cópia em `media/baseline`
e remova apenas este delta, preservando as alterações que já estavam no checkout.
A geração/sinal do chamador de logout deve ser revertida em conjunto com seu
helper, sem restaurar outras partes de AuthContext.
Para o delta de logout, compare com `media/logout-baseline`, que já inclui o
patch anterior de identidade de push, e reverta somente guard/helper/cache em
conjunto. Não restaure o arquivo inteiro de um snapshot anterior do checkout.
