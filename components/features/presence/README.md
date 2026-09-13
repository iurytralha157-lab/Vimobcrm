# Presença da equipe

Superfície frontend para visualizar o roster de usuários ativos da organização e o estado de presença retornado pelo BFF.

## Contrato e segurança

- A UI consome somente `GET /v1/user-presence` por `userPresenceAPI`; não acessa o Supabase diretamente.
- A resposta é validada por Zod antes de chegar ao componente.
- O trigger só aparece com uma organização ativa e a permissão `users_presence_view`.
- O endpoint é a fonte do roster ativo. A busca e a ordenação acontecem localmente sobre essa lista.
- O rastreador grava apenas a própria sessão, protegido por RLS. Os horários de conexão, heartbeat e saída são definidos pelo PostgreSQL, não pelo relógio do navegador.

## Comportamento

- O React Query consulta apenas enquanto o painel está aberto e repete a leitura a cada 30 segundos.
- A sessão envia heartbeat a cada 60 segundos. Uma aba visível fica ausente após cinco minutos sem teclado, ponteiro, toque ou rolagem; esconder a aba marca ausência imediatamente e a próxima interação restaura o estado online.
- No desktop, o painel é não modal, tem entre 340 e 360 px e ocupa toda a altura da lateral direita.
- No mobile, o conteúdo abre como `Sheet` pela direita, respeita as safe areas e mantém título e descrição acessíveis.
- Online usa verde e aparece sem idade de heartbeat. Ausente usa âmbar e informa o tempo desde a mudança para `idle`; offline usa cor neutra e informa o último acesso. As distâncias usam o `generated_at` da API como referência autoritativa, e as datas são renderizadas com `<time>`.
- Loading, erro inicial com retry, roster vazio e busca sem resultado têm estados próprios. Uma falha de atualização preserva o último roster válido e exibe um aviso compacto com nova tentativa.
- Presença e chat usam um estado de superfície compartilhado: abrir a presença preserva o chat minimizado, mas o oculta junto com seu launcher; expandir o chat fecha a presença. Assim, as duas superfícies não disputam espaço nem foco.

## Integração

`OnlineUsersPanel` está montado no `AppLayout` como irmão do chat e consome o `FloatingChatProvider` fornecido pelo `ProtectedProvider`. Assim, tanto o shell quanto o conteúdo das páginas protegidas podem usar `useFloatingChat`. O rastreador de atividade também é montado no `ProtectedProvider`, preservando a mesma sessão durante a navegação entre telas protegidas. A feature usa a tabela durável e o BFF como caminho único; não mantém uma segunda implementação de Supabase Realtime Presence.
