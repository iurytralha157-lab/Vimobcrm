# Google Agenda: envio do Vimob

## Contrato do produto

O Vimob é a origem dos compromissos. Depois que uma pessoa autorizada conecta a própria conta Google, a criação e a edição de um compromisso no Vimob enfileiram o envio para a agenda Google dessa pessoa. Excluir o compromisso no Vimob enfileira a remoção do evento Google vinculado. A fila permite retentativas quando o Google está indisponível.

Eventos criados, editados ou excluídos diretamente no Google **não alteram o Vimob**. A conexão OAuth não importa eventos existentes, não cria canal de notificações (watch) e não faz sincronização de entrada. O código de entrada legado permanece no repositório para compatibilidade, mas o corte de mão única não publica o webhook nem executa jobs de pull/watch.

Ao desconectar a conta, os eventos já enviados permanecem no Google. Edições e exclusões feitas depois no Vimob não podem ser transmitidas com o token revogado. A interface deve avisar disso antes da desconexão.

A primeira publicação disponibiliza a conexão a todos os usuários Vimob com acesso ativo à Agenda e permissão `schedule_manage`. Cada pessoa conecta a própria conta Google. Não há lista de UUIDs nem liberação gradual no serviço Functions; o acesso efetivo também depende das regras do projeto OAuth no Google Cloud. A desconexão da própria conta continua disponível.

## Estado observado em 2026-10-06

Na URL https://supabase.vimobcrm.com.br, as três rotas Google Agenda consultadas respondiam `404 Function not found`, enquanto `evolution-go-webhook` respondeu. Portanto, o status da integração ainda não funciona nesse destino. O editor da stack no Portainer guarda `SUPABASE_PROJECT_URL=https://supabase.vimobcrm.com.br`, mas o ambiente efetivo do processo da API Go não foi lido. O banco tem cinco tabelas `google_calendar_*`, uma conexão em erro, 24 jobs `pull_incremental` mortos, nenhum Cron da Agenda, nenhuma RPC filtrada de saída e não tem `google_calendar_sync_base_url` no Vault. O roteador e os arquivos montados no host, as variáveis reais das Functions e o projeto Google Cloud ainda precisam ser verificados. O comportamento descrito neste guia é o do **checkout local**, ainda não publicado.

O fluxo e a ordem da liberação geral estão em deploy/supabase-self-hosted/google-calendar-release-readiness.md. Nenhum comando de implantação deste guia foi executado em produção.

## Componentes e segurança

- Interface: components/features/schedule/GoogleCalendarConnect.tsx, hooks/use-google-calendar.ts e lib/api/google-calendar.ts.
- Proxy autenticado da API Go: apps/api/internal/integrations. A API encaminha somente google-calendar-oauth e google-calendar-sync.
- OAuth, envio e fila: supabase/functions/google-calendar-oauth, supabase/functions/google-calendar-sync e supabase/functions/_shared/google-calendar.ts.
- Vínculos, tokens e jobs: tabelas google_calendar_tokens, google_calendar_event_links e google_calendar_sync_jobs. O segredo OAuth fica no Supabase Vault; a tabela guarda a referência.
- A API Go grava o compromisso e o job de envio na mesma transação. O worker reivindica somente `push_upsert` e `push_delete` por meio de `public.google_calendar_claim_outbound_sync_jobs(integer,text)`. A migração local revoga o acesso de `service_role` à RPC antiga de claim sem filtro.
- A conexão exige associação ativa à organização, Agenda habilitada e permissão de gerenciar Agenda. A rota de status e a desconexão continuam disponíveis para quem já está conectado.

O OAuth usa os escopos openid, email e https://www.googleapis.com/auth/calendar.events.owned. Esse último autoriza acesso aos eventos de agendas próprias no Google; a aplicação local o usa para enviar e manter os eventos vinculados. A política do produto continua sem importação de eventos do Google.

Nesta versão, o evento vai somente para a agenda do dono conectado. O envio não adiciona convidados nem dispara convites Google para outros usuários. Uma futura distribuição de convites exige checagem própria de associação ativa e privacidade de cada destinatário.

O Vimob prevalece em edições posteriores: uma alteração feita diretamente na cópia Google pode ser substituída pela próxima edição do compromisso no Vimob. A exclusão no Vimob remove a cópia vinculada do Google, mesmo que ela tenha sido editada lá. O worker ainda verifica identidade, dono e organização antes de remover um evento recuperado sem vínculo; uma divergência de identidade exige revisão operacional.
Vínculos legados sem a identidade Vimob gravada no evento remoto também exigem revisão antes de atualização ou remoção automática.

## Configuração necessária para o corte futuro

1. No projeto Google Cloud, habilitar a Google Calendar API, configurar a tela de consentimento, o domínio oficial e um cliente OAuth do tipo Aplicativo da Web. Registrar o callback HTTPS exato de `google-calendar-oauth/callback`. Para conectar todos os usuários autorizados no Vimob, conferir o status de publicação e a verificação OAuth exigida pelo escopo de Agenda. Em `Testing`, só contas listadas como usuários de teste conseguem autorizar e os refresh tokens podem expirar em sete dias; isso não atende à liberação geral.
2. No serviço Functions do destino correto, conferir a presença de `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI` e `GOOGLE_CALENDAR_POST_CONNECT_REDIRECT_URL`. Conferir o Client ID sem expor o secret. `GOOGLE_CALENDAR_WEBHOOK_URL` não é necessário para este fluxo.
3. Por SELECT, reconciliar as tabelas, os jobs pendentes, o Vault, a RPC existente e os Cron jobs. O Vault precisa ter google_calendar_sync_base_url e google_calendar_cron_secret para os workers. A nova RPC local deve ser reconciliada e aplicada isoladamente antes de ativar o worker novo; não executar db push em lote sem conferir o ledger real.
4. Manter desativados os Cron jobs de entrada google-calendar-enqueue-due-pulls e google-calendar-renew-watches. Somente google-calendar-sync-jobs processa a fila de saída. Um worker antigo que ainda use a RPC sem filtro deve sair de operação antes do novo corte.
5. Inspecionar o roteador e os mounts do Supabase self-hosted antes de copiar funções. O plano local seleciona somente google-calendar-oauth e google-calendar-sync, com os arquivos _shared importados. Preservar todas as rotas já em serviço. O manifesto local completo não corresponde ao runtime observado e não deve substituí-lo sem reconciliação.

GOOGLE_CALENDAR_IMMEDIATE_DISPATCH_ENABLED na API Go controla a tentativa de acordar o worker após a gravação. Desativada, o compromisso fica na fila até o Cron de saída ou outro disparo controlado. Ativada, a tentativa é imediata, mas a fila/Cron continuam necessários para retentativa. O envio em segundos depende da configuração e da medição em produção; a gravação no Vimob, sozinha, não prova chegada ao Google.

O retorno OAuth de web/PWA usa a URL web configurada. O retorno ao app nativo precisa de teste separado antes de anunciar suporte completo no aplicativo.

## Teste inicial com uma conta controlada

1. Confirmar, sem escrita, o destino efetivo da API, a publicação das duas Functions, as variáveis e a RPC. Confirmar que o status não retorna mais `Function not found`, que uma pessoa autorizada recebe `can_connect=true` e que uma pessoa sem permissão de Agenda recebe `can_connect=false` e não consegue conectar.
2. Auditar o backlog de `push_upsert`/`push_delete` por status, idade, conexão, organização e usuário. Ativar somente o Cron de saída após essa revisão e confirmar que ele não executa jobs de entrada. Sem esse Cron e com o despacho imediato desativado, nenhum envio automático pode ser comprovado.
3. Conectar uma conta Google dedicada. Confirmar que o OAuth não cria registros Vimob a partir do calendário Google.
   Compromissos antigos do Vimob não são enviados apenas por conectar; um novo cadastro ou uma edição posterior inicia o envio.
4. Criar, editar e excluir compromissos controlados no Vimob. Verificar no Google o evento vinculado, a atualização e a remoção; medir o atraso e observar jobs failed/dead. Alterar um evento vinculado diretamente no Google, depois editar e excluir pelo Vimob; confirmar que a versão Vimob prevalece.
   Confirmar também que nenhum participante recebe convite Google por esse fluxo.
5. Criar e editar um evento somente no Google. Confirmar que ele não aparece no Vimob, inclusive após a execução dos workers.
6. Testar desconexão e reconexão com a mesma conta. Conferir token revogado/removido, ausência de conexão ativa duplicada e eventuais jobs restantes sem expor credenciais.

A primeira publicação expõe a conexão a todos os usuários Vimob autorizados; a conta controlada verifica o fluxo em produção, mas não limita quem pode usar o botão. Exigir reconciliação do ambiente real, validação do Google Cloud e observação de ponta a ponta antes de considerar o serviço pronto para uso profissional. Nenhuma publicação, migração, alteração de variável ou escrita em produção faz parte desta atualização documental.
