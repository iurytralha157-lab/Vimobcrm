# Notificações e som de novo lead

O `NotificationSoundProvider` acompanha as notificações no layout protegido, dentro do `QueryProvider`. A navegação entre páginas mantém o monitor ativo. O cabeçalho usa o contexto para mostrar os controles de silenciar e testar no menu de notificações.

## Critérios do alerta

- A fonte é a primeira página da consulta autorizada de notificações, compartilhada com o cabeçalho. O SSE e os eventos de lead apenas pedem atualização; seu conteúdo não autoriza áudio.
- Somente `metadata.event_key === 'new_lead_received'`, com organização e destinatário atuais, lead vinculado e notificação não lida, pode tocar.
- A primeira lista estabelece uma base silenciosa. IDs já observados, páginas antigas e notificações anteriores à sessão são ignorados. A janela de frescor é 90 segundos para acomodar a reconciliação existente de 60 segundos, com tolerância de relógio de 5 segundos.
- Eventos de criação, atribuição, redistribuição, recebimento pela Meta e atualização do lead solicitam atualização agrupada de notificações e contador. A atualização genérica é necessária para o produtor de filas gerenciadas. Os hints são agrupados, com intervalo mínimo de dois segundos entre reconsultas; o conteúdo da resposta autorizada continua decidindo o som. O transporte e as proteções de privacidade existentes permanecem ativos.
- A API de listagem recebe o sinal de cancelamento, o usuário esperado e a organização capturados pela consulta. Trocar de escopo desmonta o monitor anterior e invalida suas tentativas pendentes.

## Áudio e preferência

O áudio usa duas notas curtas via Web Audio e é ativado por uma interação com o sistema. O teste também pode ativá-lo. Se o navegador bloquear a reprodução, o teste mostra a falha e continua disponível para uma nova tentativa. Testar não altera o silenciamento.

O carregamento inicial compartilha o atraso existente de 2,5 segundos. Uma chegada incorporada à primeira lista fica na base silenciosa, mesmo que tenha ocorrido durante esse início. Suspensão longa da aba, áudio bloqueado ou uma chegada consultada depois da janela de 90 segundos também podem resultar em silêncio; a ativação posterior não reproduz o backlog.

A preferência é guardada por usuário neste navegador, em `localStorage`, e sincronizada entre abas por eventos de armazenamento. Quando o armazenamento da preferência está bloqueado, a aba começa silenciada e permite alteração temporária local. Não há permissão de notificações do navegador nem download de arquivo de áudio.

## Exclusividade entre abas

O coordenador usa uma transação nativa `readwrite` do IndexedDB para reivindicar o ID da notificação dentro do escopo organização e usuário. Um intervalo de dois segundos agrupa chegadas em sequência. IDs suprimidos por esse intervalo também são registrados para impedir que um replay toque depois.

As reivindicações duram dez minutos e a limpeza é limitada por transação. Sem IndexedDB disponível, o alerta automático é suprimido; o teste manual continua independente. A exclusividade vale para abas com a mesma origem e perfil de navegador. Outros navegadores ou dispositivos mantêm seu próprio áudio.

Uma aba que feche depois do commit da reivindicação e antes de emitir o áudio pode consumir o alerta. Esse comportamento preserva a garantia de no máximo uma reprodução automática. O monitor confere novamente escopo, silenciamento e áudio ativo antes de reproduzir.

## Verificação local

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/notifications/new-lead-sound-policy.test.ts lib/api/notifications-intent.test.mjs lib/notifications/lead-sound-coordinator.browser.test.mjs hooks/notifications/new-lead-sound.runtime.test.mjs
npm run typecheck
```

O lint deve incluir os arquivos deste domínio e os consumidores alterados em `hooks/use-notifications.ts`, `lib/api/notifications.ts`, `components/providers/protected-provider.tsx` e `components/shared/layout/AppHeader.tsx`.

Os testes usam identidade e notificações sintéticas, dois contextos de página na mesma origem, React, QueryClient, Radix e IndexedDB reais. A emissão é contada com um AudioContext controlado; isso não comprova volume físico, permissões do dispositivo ou o comportamento do navegador em produção.

## Reversão

Remover a integração do provider e os controles do cabeçalho interrompe o monitor global. Remover seletivamente os novos arquivos e os trechos desta implementação preserva alterações concorrentes dos consumidores. A intenção explícita da listagem é compatível com os demais chamadores e pode ser mantida. Não restaurar arquivos compartilhados inteiros para reverter este recurso.
