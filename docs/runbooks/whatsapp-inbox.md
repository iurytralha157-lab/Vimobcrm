# WhatsApp: contrato da inbox e da outbox duráveis

> Revisão documental: 2026-10-08. Código de referência:
> `ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b`.
> Fonte: código desse commit e [runbook de deploy](../deploy-portainer.md).
> Não houve leitura de Portainer, banco ou filas de produção nesta revisão.

Este documento registra a regra de processamento encontrada no repositório.
Para preparar um corte, consulte o [runbook de deploy](../deploy-portainer.md)
e o [roteiro histórico de release](whatsapp-release-2026-09-12.md); a leitura
desses arquivos não confirma quais passos foram executados no ambiente atual.

## Inbox de webhooks

- O claim separa `live` e `backlog`, considera itens `pending` ou `retry` da
  época ativa da sessão e exige o snapshot de roteamento versão 1.
- Na mesma época, lane e rota (`routing_key`), itens mais antigos por
  `(created_at, id)` impedem o claim dos posteriores. A chave `__session__`
  impõe uma barreira para a sessão inteira. Rotas independentes podem avançar
  enquanto outra está bloqueada; não há FIFO global entre conversas ou lanes.
- Em `live`, um retry ainda não vencido bloqueia itens posteriores **da mesma
  rota**, mas não itens prontos de outras rotas. Em `backlog`, uma cabeça em
  retry pode pausar o claim daquela sessão nessa lane.
- Um item `live` pronto pode ultrapassar o histórico em `backlog`. A exceção é
  a raiz exata do backlog de que o item `live` depende: ela pode ser
  reivindicada para resolver essa dependência.
- As lanes têm slots separados. A configuração padrão de concorrência 4
  distribui 2 slots para `live` e 2 para `backlog`. Cada slot reivindica um
  item que pode iniciar imediatamente. Falhas recebem retry com atraso limitado;
  ao esgotar tentativas, o item vai para `dead`.

Fontes: [claim e dependências](../../apps/api/internal/whatsapp/webhook_worker.go)
(linhas 59–305), [slots e execução](../../apps/api/internal/whatsapp/webhook_worker.go)
(linhas 552–675), [falha e retry](../../apps/api/internal/whatsapp/webhook_worker.go)
(linhas 1445–1519).

## Outbox de envios

A outbox é independente da inbox. Texto e mídia usam lanes que podem reivindicar
e enviar itens prontos em paralelo; não há garantia de ordem global de entrega.
Fontes: [worker da outbox](../../apps/api/internal/whatsapp/outbox_worker.go)
(linhas 265–302) e [runbook de deploy](../deploy-portainer.md)
(seção de preparo das filas, linhas 210–212).

## Configuração e limite da evidência

O [runbook de deploy](../deploy-portainer.md) registra, para uma atualização
específica, `WHATSAPP_WEBHOOK_PROCESSOR_MODE=native` e
`WHATSAPP_WEBHOOK_ROLLOUT_SESSION_IDS=*` como valores então em uso em produção
(linha 258). Já o [código de configuração](../../apps/api/internal/config/config.go)
usa `edge` e lista vazia como defaults (linhas 331–332). Nenhuma dessas fontes
confirma as flags montadas hoje, os cutovers aplicados ou o comportamento ao
vivo. Mudança de modo ou allowlist exige conferir o ambiente, os pré-requisitos
de banco, a identidade das imagens e um canário específico antes do corte.

Os procedimentos de migração, operação e rollback permanecem no
[runbook de deploy](../deploy-portainer.md); não se deve reaplicar um corte
histórico apenas porque ele aparece na documentação.
