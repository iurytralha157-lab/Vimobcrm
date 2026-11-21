# Fase 5 do Vimob CRM

| Etapa | Entrega |
| --- | --- |
| 5.1 | Repositórios Go separados por responsabilidade em Meta, Times, Agenda, Imóveis, Configurações e Automações. A divisão preserva assinaturas, SQL e imports dos consumidores. |
| 5.2 | SLA e pool possuem comandos privados Go. Os avisos de saúde de sessão podem ser ativados no supervisor WhatsApp Go. A implementação foi publicada em `8839b384`, com ativação separada dos agendamentos. |
| 5.3 | OpenAPI cobre os resumos e passos de execuções de automação. O CI compara métodos e caminhos com o roteador Go. |
| 5.4 | Revisão das 12 rotas HTTP Next e de suas dependências. Veja [auditoria](architecture-phase5-next-api-audit-2026-11-20.md). |
| 5.5 | A entrada de validação reexporta os 113 contratos de seus módulos donos. Notificações passaram a `lib/api` e a fachada de gamificação sem consumidores saiu. |
| 5.6 | CI de homologação e produção com gate de imports entre domínios e registro explícito das dependências históricas. Veja [regra dos gates](../../scripts/architecture/README.md). |

## Agendamentos de SLA e pool

Os comandos são `POST /v1/internal/operations/sla-check` e
`POST /v1/internal/operations/pool-check`. O processo precisa de
`API_BACKGROUND_WORKERS_ENABLED` habilitado e de um
`OPERATIONS_CHECKS_COMMAND_TOKEN` dedicado. O agendador deve usar
`X-Vimob-Operations-Token`, HTTPS e corpo vazio ou `{}`. Mantenha o segredo
no mecanismo de segredos do ambiente. Os comandos retornam contagens e
usam o menor limite entre 55 segundos e o timeout HTTP configurado.

SLA reutiliza a seleção da RPC de leads pendentes, com até dez lotes de
cem por chamada, fila por última checagem e lock por lote. A transação
grava atualização de SLA, atividade, timeline e notificações juntas. A
timeline inclui título e descrição, campos obrigatórios do esquema atual.
Destinatários precisam de perfil e vínculo ativos. A resposta informa
`more` quando atinge o limite de lotes e `busy` com HTTP 409 quando
encontra um lote concorrente. No pool, o Go descobre os candidatos e as
RPCs existentes revalidam estado e fazem as gravações com as mesmas chaves
de idempotência. O envio continua com o dispatcher canônico.

### Validação antes de trocar

1. Em ambiente isolado, validar permissões do papel real da API nas duas
   RPCs de pool e na RPC de SLA. Validar a execução de ponta a ponta com
   registros sintéticos, incluindo deduplicação, escopo por organização e
   concorrência com atendimento e primeiro contato.
2. No ambiente alvo, inventariar quem invoca cada função. Conferir
   agendamentos e históricos em `cron.job` e `cron.job_run_details`, quando o
   serviço usa Supabase Cron, e incluir outros jobs e invocadores do ambiente.
   Guardar identificação, frequência e últimas execuções sem copiar segredos
   dos comandos. [Documentação do Supabase Cron](https://supabase.com/docs/guides/cron)
3. Validar que frequência e volume cabem nos limites da API e do agendador.
   Conferir leads checados e atraso dos pendentes no SLA. Conferir avisos,
   redistribuições, ocorrências ignoradas e falhas no pool.
4. Trocar uma rotina por vez. Conferir a imagem da API e seu `/readyz`,
   pausar o invocador anterior e aguardar o término das chamadas em
   andamento, inclusive as que o agendador já enfileirou para HTTP.
   Só então agendar o comando Go.
   Conferir resposta HTTP, estado no Postgres e efeitos na fila canônica.
   As Edge Functions podem servir de retorno enquanto essa etapa é acompanhada.
5. Para voltar, pausar o novo job, aguardar seu término e restaurar o job
   anterior com a configuração registrada.

## Saúde de sessão WhatsApp

O supervisor existente pode assumir a confirmação da perda de conexão e
gravar aviso ao titular e administradores ativos junto do evento de auditoria.
`WHATSAPP_SESSION_HEALTH_NOTIFICATIONS_ENABLED` começa desabilitado.
Validar a cobertura do supervisor, conexões com Evolution legado e uso do
comando manual de superadmin antes de aposentar a Edge. A sequência de
ativação e retorno está no [guia de saúde de sessão](../../apps/api/internal/whatsapp/session-health-cutover.md).

## Verificação da 5.2 em 20/11

No Supabase de homologação, `vimob-homologacao`, a consulta em somente
leitura encontrou `pg_cron`, `pg_net` e as três RPCs esperadas. O
`service_role` pode executá-las e `authenticated` fica bloqueado. A busca
pelos nomes das rotinas nos comandos do Cron e nas funções SQL não encontrou
invocadores correspondentes. O inventário de Edge Functions desse projeto
também não contém os verificadores. O ambiente Cloud pode confirmar o
catálogo e as permissões, e os ensaios dos efeitos foram feitos no Docker
isolado com dados sintéticos.

| Rotina | Comportamento verificado |
| --- | --- |
| SLA | Go com o esquema do Supabase local e papel `service_role`. Aviso e atraso gravam atividade, timeline e três notificações aos destinatários elegíveis. Resposta anterior, lead ganho e importação silenciosa ficam fora. A repetição não cria avisos duplicados. |
| Pool | Go com as duas RPCs instaladas no PostgreSQL local. Confirma aviso e redistribuição, preserva o lead atendido após a seleção e repete chamadas com a mesma chave sem duplicar efeitos. |
| Sessão WhatsApp | Supervisor Go com provedor sintético. A perda confirmada grava avisos, fila e auditoria. Reconexão durante a confirmação, webhook mais recente e falha de enfileiramento impedem a gravação dos efeitos. |

Em produção, o inventário de 20/11 encontrou cinco jobs ativos de
outras rotinas e zero agendamentos de SLA, pool e saúde de sessão. Nos
sete dias observados no proxy, houve zero chamadas a esses verificadores.
A publicação de `8839b384` entregou os comandos com a ativação desabilitada
por padrão. A Edge de saúde conserva a compatibilidade da chamada manual.
Para uma futura troca de agenda, confira a resposta HTTP além do histórico
do Cron, que pode registrar apenas o enfileiramento da chamada.

## Funções de automação

| Função | Trabalho que ainda executa |
| --- | --- |
| `automation-runner` | Processamento de gatilhos, atrasos e execuções pelo runtime compartilhado. É chamada pelo worker Go. |
| `automation-inactivity` | Varredura das automações por inatividade. É chamada pelo worker Go. |
| `automation-trigger` | Consumo e processamento de eventos de gatilho. |
| `automation-delay-processor` | Liberação de esperas vencidas e continuação de execuções. |
| `automation-executor` | Processamento de uma execução específica. O webhook Evolution legado contém uma chamada na continuação por resposta. |

Esses pontos executam o runtime. A revisão manteve os cinco ativos e
preservou as Edge de integrações externas. O manifesto e o lock de fontes
da Edge continuam válidos para o mesmo conjunto publicado.
