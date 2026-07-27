# Integração com Google Agenda

## Estado

A integração é pessoal por usuário e isolada por organização. Cada usuário
conecta a própria conta Google; administradores não compartilham credenciais
com a equipe.

O fluxo bidirecional é:

1. O usuário conecta a conta pelo OAuth na tela de Agenda ou em Integrações.
2. Um sync inicial importa os eventos da agenda principal do usuário.
3. Criações, edições e exclusões no Vimob são enviadas ao Google.
4. O Google notifica o webhook quando um evento muda.
5. O webhook enfileira um sync incremental; um worker privado processa a fila.

## Componentes

- UI: `components/features/schedule/GoogleCalendarConnect.tsx`
- Hooks: `hooks/use-google-calendar.ts` e `hooks/use-schedule-events.ts`
- Proxy autenticado: `apps/api/internal/integrations`
- OAuth, sync e webhook: `supabase/functions/google-calendar-*`
- Lógica compartilhada: `supabase/functions/_shared/google-calendar.ts`
- Banco, Vault e cron: migrations `google_calendar_bidirectional_sync` e
  `google_calendar_foreign_key_indexes`

## Segurança

- Tokens OAuth ficam no Supabase Vault; não existem colunas de access token ou
  refresh token em texto puro.
- O estado OAuth é aleatório, tem validade de dez minutos e só pode ser usado
  uma vez.
- O retorno OAuth aceita apenas a origem configurada do Vimob.
- Toda leitura ou escrita é filtrada por `organization_id` e `user_id`.
- Webhooks validam o identificador, o recurso e o hash do token do canal.
- Workers agendados usam um segredo privado do Vault.
- O escopo solicitado é
  `https://www.googleapis.com/auth/calendar.events.owned`, limitado a eventos
  em agendas que pertencem ao usuário.

## Variáveis das Edge Functions

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=https://<project-ref>.supabase.co/functions/v1/google-calendar-oauth/callback
GOOGLE_CALENDAR_WEBHOOK_URL=https://<project-ref>.supabase.co/functions/v1/google-calendar-webhook
GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL=https://app.vimobcrm.com.br/agenda
```

O segredo do cron não é uma variável de ambiente. Ele é gerado pela migration
e guardado no Vault.

## Roteiro de teste

1. Abrir `/agenda` e clicar em **Google Agenda**.
2. Conectar uma conta Google e aceitar o acesso à agenda própria.
3. Confirmar que eventos existentes do Google aparecem no Vimob.
4. Criar um evento no Vimob e confirmar que ele aparece no Google.
5. Editar título e horário no Google e aguardar até dois minutos no Vimob.
6. Editar o mesmo evento no Vimob e confirmar a mudança no Google.
7. Excluir o evento no Vimob e confirmar a remoção no Google.
8. Pausar o sync automático e confirmar que o estado aparece como pausado.
9. Reativar, usar **Sincronizar** e confirmar a convergência.
10. Desconectar e confirmar que o token foi removido do Vault.

## Verificação pública do Google

Para remover o aviso de app não verificado e o limite de usuários, alinhar o
branding ao domínio atual, declarar o escopo sensível, fornecer justificativa,
gravar um vídeo público/não listado demonstrando o fluxo OAuth completo e
atualizar a solicitação na Central de verificação. Alterar o branding enquanto
uma análise está em andamento atualiza a solicitação existente, portanto essa
mudança deve ser coordenada antes do envio final.
