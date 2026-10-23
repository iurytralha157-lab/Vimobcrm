# Criação operacional de contato ganho — preparação local

Estado: código e migration preparados no checkout principal. Nenhum banco,
serviço, deploy ou produção foi acessado nesta correção. A execução SQL real
e os efeitos de comissão ainda precisam de homologação autorizada.

## Contrato

`POST /v1/leads` continua aceitando `dealStatus: "won"`. Um contato NOVO que
termine ganho exige `lead_operate` e o escopo de operação sobre sua atribuição
efetiva, após as automações e a distribuição. A API cria o estado inicial aberto
e faz a transição real por UPDATE na mesma transação, reutilizando a reserva,
o evento/outbox e o gatilho existente de comissão/recebível. O recibo de importação
só conclui no COMMIT dessa transação.

Reentrada de contato existente mantém sua política própria: importação com
`lead_import` e escopo válido pode preservar um ganho existente sem
`lead_operate`. O RPC de importação histórica silenciosa não foi alterado.

O PropertyID comercial vinculado tem a permissão de leitura e a visibilidade canônica revalidadas no próprio bloqueio, antes do INSERT. As demais referências InterestPropertyIDs de metadata mantêm sua validação individual e não constituem um snapshot retido. O imóvel é bloqueado sem alterar sua disponibilidade
nesse momento. Isso evita que dois novos contatos mantenham locks de FK sobre o
mesmo imóvel enquanto tentam adquirir o lock exclusivo de reserva.

## Migration e compatibilidade

`20261013033112_defer_new_lead_stage_status_until_commercial_transition.sql`
adiciona `private.set_lead_creation_status_phase(uuid,uuid,text)` e um guard na
automação de etapa. O guard usa GUC LOCAL por organização/lead gerado no servidor;
não usa metadata fornecida pelo browser. Só papéis backend podem ativá-lo.
Adia somente a automação de status e preserva a automação de responsável.

APIs antigas, outros leads e o RPC histórico não ativam o guard e mantêm o
comportamento anterior. A migration deve anteceder a nova API em um rollout
futuro autorizado; o problema antigo só estará corrigido depois de todas as
réplicas backend usarem a nova implementação. Não executar `db push` como parte
desta preparação: permanece o bloqueio de reconciliação do ledger do projeto.

Sem o guard, ganho explícito retorna HTTP 503
`lead_creation_workflow_unavailable` antes do INSERT de contato. Criação aberta
comum permanece compatível; se um caminho legado produzir ganho, a transação é
revertida antes do COMMIT. Esse código específico permite nova tentativa manual
com a mesma intenção/chave após corrigir a disponibilidade do fluxo; não indica
COMMIT desconhecido e não autoriza retry automático. Outros erros continuam
seguindo seus contratos próprios.

## Evidência e validação pendente

Testes locais de política/kernel/mock verificam permissão, escopo de duas
organizações, indisponibilidade, drift, falha de UPDATE/evento, ausência de guard,
ordem dos locks e finalização anterior ao COMMIT/recibo. Contratos de fonte
conferem o guard SQL e a integração no repositório. Isso não executa gatilhos SQL.

Antes de homologar em banco descartável autorizado, verificar:

- Ganho explícito e ganho por etapa/distribuição: reserva, proveniência,
  comissão/recebível, atividade/outbox e recibo atômicos.
- `lead_create` ou `lead_import` sem `lead_operate`; atribuição final fora do
  escopo; referências de outra organização; imóvel já reservado/indisponível.
- Duas criações simultâneas para um imóvel; pool com uma conexão; rollback de
  falha financeira, evento/outbox ou finalização do recibo.
- Papel `authenticated` com GUC forjado; par organização/lead incorreto; guard
  ausente; APIs antigas; automação de responsável e importação histórica silenciosa.

Reversão de código deve preservar recibos e dados existentes. Reverter para a
API anterior reintroduz o defeito de ganho na criação e exige decisão explícita;
não apagar recibos nem reescrever migrations históricas para obter rollback.
