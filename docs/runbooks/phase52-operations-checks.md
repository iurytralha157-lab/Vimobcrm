# Checagens de SLA e pool na API Go

A API oferece `POST /v1/internal/operations/sla-check` e
`POST /v1/internal/operations/pool-check` para o agendador. As rotas exigem
`API_BACKGROUND_WORKERS_ENABLED` e um
`OPERATIONS_CHECKS_COMMAND_TOKEN` dedicado no servidor. O agendador envia
`X-Vimob-Operations-Token` por HTTPS e corpo vazio ou `{}`. Guarde o token no
mecanismo de segredos do ambiente.

O SLA avalia até dez lotes de cem leads por chamada e grava status, timeline,
atividade e avisos na mesma transação. A resposta `more` indica que a chamada
atingiu o limite de lotes. `busy` com HTTP 409 indica concorrência com outro
lote. O pool usa as RPCs existentes para revalidar cada candidato antes de
gravar efeitos. As respostas dos comandos contêm apenas contagens e estados.

## Verificação e troca

1. Em ambiente isolado, use as RPCs instaladas para verificar permissões,
   avisos, redistribuição, deduplicação e concorrência com atendimento. Os
   ensaios Go de PostgreSQL ficam em `apps/api/internal/leads`.
2. No ambiente alvo, inventarie os invocadores de cada rotina. Consulte
   `cron.job`, `cron.job_run_details` e as funções SQL intermediárias. Cruze
   os resultados com os logs HTTP e com outros agendadores do ambiente.
   Registre frequência, estado e horários e mantenha os comandos e segredos
   fora do inventário. Se a rotina estiver sem produtor ativo, valide a
   necessidade de agendamento antes de habilitar um novo produtor.
3. Confira a imagem da API e seu `/readyz`. Para trocar uma rotina ativa,
   pause o produtor anterior e aguarde chamadas já iniciadas ou enfileiradas.
   Depois, aponte somente aquela rotina para o comando Go.
4. Confira código HTTP, duração da execução e efeitos persistidos. A conclusão
   do job do Cron pode indicar apenas o enfileiramento de uma chamada HTTP.
   Se for preciso reverter, pause o novo produtor, aguarde o término das
   chamadas e restaure o agendamento anterior com a configuração registrada.

As checagens de saúde do WhatsApp seguem o
[roteiro do supervisor de sessões](../../apps/api/internal/whatsapp/session-health-cutover.md).
