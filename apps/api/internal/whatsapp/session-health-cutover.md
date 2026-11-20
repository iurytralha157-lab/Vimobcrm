# Saúde das sessões WhatsApp

O supervisor existente assume os avisos e a auditoria quando o bootstrap injeta
o escritor de notificações em `WithSessionHealthNotifications`. A configuração
padrão mantém a supervisão anterior. A ativação reutiliza a eleição entre
réplicas, as leases, o lock por sessão, os timeouts e o backoff existentes.

Para uma sessão Evolution Go ativa que estava conectada ou conectando, o
supervisor confirma a perda com duas observações conclusivas de desconexão
separadas por três segundos. Recuperação entre as observações, QR, resposta
inconclusiva, instância ausente e logout solicitado ficam fora dos avisos.
O caminho de recuperação do provedor continua sujeito às configurações,
guardas e à lista de sessões já existentes.

A transação confere a lease, a ordenação do último webhook e a identidade e
revisão da sessão antes da alteração. Nela grava a transição, enfileira um
aviso para o dono e para cada administrador com perfil e vínculo ativos
na mesma organização primária e registra `whatsapp.session_disconnected` no histórico de
auditoria. O dono recebe um aviso mesmo quando também é administrador.
A chave de deduplicação inclui sessão, destinatário e instante do episódio.
Falha de enfileiramento ou da auditoria reverte a transação.

## Antes de transferir o agendamento

- A Edge aceita a chamada de cron com segredo compartilhado e a chamada
  manual de um superadministrador ativo. A busca no código da aplicação e nos
  workflows do repositório encontrou apenas referências de inventário e testes.
  Confira separadamente o histórico operacional de chamadas e os agendadores
  externos. Se houver uso manual confirmado, mantenha a rota até migrar o
  consumidor.
- A seleção da Edge inclui sessões Evolution legado ativas em estado
  `connected` ou `connecting`. O supervisor Go usa o contrato Evolution Go e
  exige token da própria sessão. Confira o volume elegível por provedor e as
  sessões Go sem token antes de desativar o cron antigo. A consulta abaixo
  devolve apenas contagens.
- A Edge pode enviar aviso a partir da associação primária antiga de um
  usuário inativo. O Go exige perfil ativo e vínculo ativo e não removido na
  organização da sessão.
- Validar um canário isolado com recuperação durante a confirmação,
  desconexão confirmada, falha de enfileiramento e concorrência com um
  webhook. Conferir as notificações e a auditoria persistidas no mesmo
  episódio.
- Confirmar um único produtor dos avisos por sessão antes de ativar o Go.
  Para retornar, desligar a emissão no Go antes de reativar o agendamento
  anterior. Os avisos e as auditorias já persistidos continuam disponíveis.

```sql
select
  provider,
  count(*) as edge_eligible,
  count(*) filter (
    where provider = 'evolution_go'
      and nullif(btrim(advanced_settings->>'token'), '') is null
  ) as go_without_session_token,
  count(*) filter (
    where provider = 'evolution_go'
      and (
        lower(coalesce(advanced_settings->>'auto_reconnect_enabled', 'true')) = 'false'
        or lower(coalesce(advanced_settings->>'auto_reconnect_blocked_reason', '')) = 'user_logged_out'
      )
  ) as go_health_opted_out
from public.whatsapp_sessions
where coalesce(is_active, true)
  and status in ('connected', 'connecting')
group by provider
order by provider;
```

## Ensaio local do supervisor

`TestSessionHealthSupervisorPostgres` usa um provedor HTTP de loopback e o
claim PostgreSQL real de `20260912173704_harden_whatsapp_session_supervisor_state.sql`.
O ensaio confirmou gravação única de aviso do dono, aviso do administrador,
auditoria e entrega enfileirada após perda confirmada. Recuperação entre
sondagens e observação desatualizada conservaram o status. Uma falha induzida
após enfileirar o primeiro aviso reverteu todos os efeitos.

O teste é opt-in via `VIMOB_SESSION_HEALTH_TEST_DATABASE_URL`. Use um
PostgreSQL descartável em loopback com banco vazio `vimob_phase52_session_health`,
marcador `vimob.test_fixture=session-health-disposable` e sem pg_cron.
O ensaio local usou as tabelas de organizações, usuários, vínculos, sessões,
auditoria, templates, notificações e tokens de push da baseline canônica, os
contratos de lease e o DDL, helpers e gatilho de entrega de
`20260905093544_normalize_notification_delivery_outbox.sql` anteriores ao
backfill histórico. O teste usa dados sintéticos e deixa os registros para
inspeção no banco descartável. Execute uma vez por banco e remova o ambiente
após conferir o resultado.
