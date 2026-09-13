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
6. Uma reconciliação de segurança busca conexões sem sync há seis horas, pois
   as notificações push do Google são best-effort e podem ser perdidas.

Criações, edições e exclusões iniciadas no Vimob entram na fila durável. Na
exclusão, o vínculo com o evento remoto é preservado depois que a atividade
local some, permitindo retentativas sem deixar um evento órfão no Google.

## Componentes

- UI: `components/features/schedule/GoogleCalendarConnect.tsx`
- Hooks: `hooks/use-google-calendar.ts` e `hooks/use-schedule-events.ts`
- Proxy autenticado: `apps/api/internal/integrations`
- OAuth, sync e webhook: `supabase/functions/google-calendar-*`
- Lógica compartilhada: `supabase/functions/_shared/google-calendar.ts`
- Banco, Vault e cron: migrations `google_calendar_bidirectional_sync`,
  `google_calendar_foreign_key_indexes` e `google_calendar_reliability_sweep`

## Segurança

- Tokens OAuth ficam no Supabase Vault; não existem colunas de access token ou
  refresh token em texto puro.
- O estado OAuth é aleatório, tem validade de dez minutos e só pode ser usado
  uma vez.
- O retorno OAuth aceita apenas a origem configurada do Vimob.
- Toda leitura ou escrita é filtrada por `organization_id` e `user_id`.
- Webhooks validam o identificador, o recurso e o hash do token do canal.
- Pausar a sincronização encerra os canais ativos e o webhook ignora qualquer
  notificação atrasada daquela conexão.
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
GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL=https://app.vimobcrm.com.br/settings?tab=integrations&integration=google-calendar
```

O segredo do cron não é uma variável de ambiente. Ele é gerado pela migration
e guardado no Vault.

## Configuração no Google Cloud

1. Ative a **Google Calendar API** no projeto Google Cloud usado pelo Vimob.
2. Configure a tela de consentimento OAuth com o domínio oficial do Vimob.
3. Crie um cliente OAuth do tipo **Aplicativo da Web**.
4. Cadastre como URI de redirecionamento autorizada o valor exato de
   `GOOGLE_CALENDAR_REDIRECT_URI`. Esquema, host, caminho, barra final e caixa
   precisam coincidir; o endpoint legado `google-calendar-auth` não deve ser
   cadastrado.
5. Declare `openid`, `email` e
   `https://www.googleapis.com/auth/calendar.events.owned`. Esse último é o
   menor escopo que permite ao Vimob ler e alterar eventos das agendas que o
   usuário possui.
6. Cadastre `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_CALENDAR_WEBHOOK_URL` e
   `GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL` nos secrets das Edge Functions.

O webhook precisa ser uma URL HTTPS pública. URLs locais não recebem chamadas
do Google; em desenvolvimento, teste OAuth/push com um callback HTTPS de
staging ou um túnel aprovado para esse fim.

## Ativação dos workers privados

As migrations não adivinham o endereço público do projeto. Um operador de
banco deve guardar a base URL das Functions no Vault e reconciliar os jobs
depois da migration `google_calendar_reliability_sweep`:

```sql
do $setup$
declare
  secret_id uuid;
begin
  select id into secret_id
  from vault.secrets
  where name = 'google_calendar_sync_base_url'
  limit 1;

  if secret_id is null then
    perform vault.create_secret(
      'https://<project-ref>.supabase.co',
      'google_calendar_sync_base_url',
      'Base URL usada pelos workers privados do Google Agenda'
    );
  else
    perform vault.update_secret(
      secret_id,
      'https://<project-ref>.supabase.co',
      'google_calendar_sync_base_url',
      'Base URL usada pelos workers privados do Google Agenda'
    );
  end if;
end
$setup$;

select private.reconcile_google_calendar_cron_jobs();
```

Depois, confirme que existem exatamente estes jobs ativos em `cron.job`:
`google-calendar-enqueue-due-pulls`, `google-calendar-sync-jobs` e
`google-calendar-renew-watches`. Não use uma chave JWT ou service role no
comando do cron; a autenticação é feita pelo segredo dedicado do Vault.

## Roteiro de teste

1. Abrir `/agenda` e clicar em **Google Agenda**.
2. Conectar uma conta Google e aceitar o acesso à agenda própria.
3. Confirmar que eventos existentes do Google aparecem no Vimob.
4. Criar um evento no Vimob e confirmar que ele aparece no Google.
5. Editar título e horário no Google e aguardar até dois minutos no Vimob.
6. Editar o mesmo evento no Vimob e confirmar a mudança no Google.
7. Excluir o evento no Vimob e confirmar a remoção no Google.
8. Pausar o sync automático e confirmar que o estado aparece como pausado.
9. Alterar um evento no Google enquanto pausado e confirmar que ele não entra
   no Vimob; reativar e usar **Sincronizar** para confirmar a convergência.
   Alterações explícitas feitas no Vimob continuam sendo enviadas ao Google
   enquanto a conexão existir; a pausa interrompe somente watches e pulls automáticos.
10. Desconectar, conectar novamente a mesma conta e confirmar que não há erro
    de unicidade nem uma segunda conexão ativa.
11. Desconectar e confirmar que o token foi removido do Vault e os canais estão
    marcados como encerrados.

## Gates de lançamento

- Aplicar e reconciliar as migrations no ambiente alvo antes das Functions.
- Publicar de forma coordenada `google-calendar-oauth`,
  `google-calendar-sync`, `google-calendar-webhook` e o tombstone seguro de
  `google-calendar-auth`.
- Confirmar os cinco secrets das Functions sem copiar seus valores para logs.
- Confirmar os três jobs de cron e executar o roteiro acima com uma conta de
  teste em staging.
- Validar no Google Cloud que o redirect cadastrado termina exatamente em
  `/google-calendar-oauth/callback`.
- Concluir a verificação pública do OAuth antes de liberar para todos os
  clientes.

## Verificação pública do Google

Para remover o aviso de app não verificado e o limite de usuários, alinhar o
branding ao domínio atual, declarar o escopo sensível, fornecer justificativa,
gravar um vídeo público/não listado demonstrando o fluxo OAuth completo e
atualizar a solicitação na Central de verificação. Alterar o branding enquanto
uma análise está em andamento atualiza a solicitação existente, portanto essa
mudança deve ser coordenada antes do envio final.
