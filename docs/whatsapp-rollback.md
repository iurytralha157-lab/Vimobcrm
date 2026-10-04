# Reversao do WhatsApp: Edge, nativo e CTWA

Este e o roteiro unico para decidir uma reversao futura. Ele nao autoriza deploy,
mudanca de flag, ativacao de sessao, reprocessamento ou exclusao. Antes de agir,
registre o estado da sessao e confirme a compatibilidade da imagem anterior com
o esquema e com os eventos ja gravados. `/readyz` sozinho nao comprova isso.

## 1. Registrar o estado antes de escolher a volta

Anote o UUID da sessao piloto, a organizacao, o SHA e digest de **cada** tarefa
Web e API, a imagem Edge, o banco ligado a cada API, o modo efetivo
`WHATSAPP_WEBHOOK_PROCESSOR_MODE`, as allowlists, o callback no Evolution Go,
o ultimo backup recuperavel e as filas da sessao. Nao imprima URL de webhook
com credenciais. Confira que as duas tarefas da API executam o mesmo contrato.

As consultas abaixo sao somente de leitura. Substitua todas as ocorrencias de
`COLE_UUID_DA_SESSAO_AQUI` pelo UUID da sessao antes de colar no SQL Editor.
Execute uma consulta por vez no banco efetivo e registre os resultados. Se uma
tabela nao existir, pare e confira o ledger de migracoes; isso nao prova que o
estado esteja desligado.

```sql
select session_id, cutoff_at, activated_at
from private.whatsapp_webhook_session_cutovers
where session_id = 'COLE_UUID_DA_SESSAO_AQUI'::uuid;

select session_id, activated_at
from private.whatsapp_ctwa_recent_successor_rollouts
where session_id = 'COLE_UUID_DA_SESSAO_AQUI'::uuid;

select session_id, capture_from, purge_enabled
from private.whatsapp_nonlead_retention_sessions
where session_id = 'COLE_UUID_DA_SESSAO_AQUI'::uuid;

select status, count(*), min(created_at) as oldest_created_at
from public.whatsapp_webhook_inbox
where session_id = 'COLE_UUID_DA_SESSAO_AQUI'::uuid
group by status order by status;

select status, count(*), min(created_at) as oldest_created_at
from public.whatsapp_outbox
where session_id = 'COLE_UUID_DA_SESSAO_AQUI'::uuid
group by status order by status;
```

## 2. Decidir pelo estado da sessao

| Estado confirmado | Caminho permitido para avaliar | Volta proibida ou nao comprovada |
| --- | --- | --- |
| Sem corte por sessao, sem coorte CTWA e sem purge | Pode-se avaliar `edge` com a API atual que conhece a inbox duravel e mantem o callback tokenless. `native_fallback` serve apenas para um canario anterior a esses cortes. Uma imagem anterior so entra depois de verificar esquema, filas e contrato de callback. | Nao assumir que desligar flags desfaz migracoes que mudaram compartilhamento, auto-resposta, notificacoes ou supervisor. |
| Corte por sessao ativo, mas sem coorte CTWA | Manter uma API que entende o epoch e o gatilho da inbox. Testar separadamente qualquer volta para Edge antes de mudar o modo. | Nao recolocar uma API que nao grava o marcador do corte ou usa worker antigo. |
| Coorte CTWA ativa | Manter as duas APIs no mesmo SHA compativel, em modo `native` para a sessao piloto. Parar a ampliacao; investigar e corrigir adiante, isolando apenas a sessao piloto se necessario e aprovado. | `edge`, `native_fallback` e a imagem `90b72a65` nao sao rollback seguro dessa sessao. O gatilho recusa o writer antigo. Nao apague a linha da coorte como atalho. |
| Purge de sete dias ja executou | Corrigir o fluxo e avaliar restauracao em ambiente separado, com backup e reconciliacao. | Trocar imagem ou flag nao restaura mensagens, arquivos do Storage ou avisos externos ja enviados. |

Esses estados podem coexistir. Se a leitura for inconclusiva, mantenha a versao
compativel e pare a ampliacao; nao experimente um rollback na sessao ativa.

## 3. Procedimento para voltar ao caminho Edge, somente no primeiro estado

1. Suspenda apenas a ampliacao do canario. Registre tarefas, imagens, flags e
   filas antes de qualquer mudanca. Confirme que nenhuma sessao a ser alterada
   possui corte, coorte ou purge ativo e que a API mantida suporta a inbox.
2. Mantenha o callback Evolution Go apontado para a API tokenless. Se a volta
   for autorizada, altere o modo para `edge` na API **compativel** e retire o
   UUID piloto da allowlist nativa. Nao altere outras sessoes por acidente.
3. Confira ambas as tarefas e observe ingressos novos, retries, inbox, outbox,
   envio, recebimento e historico. Trabalho pendente nao e motivo para apagar
   ou reenfileirar; se uma imagem anterior nao entende esse trabalho, conserve
   a API compativel ate existir um plano comprovado.
4. Considere imagem anterior apenas quando o esquema e cada evento pendente
   forem compativeis e o callback continuar sem segredo na URL. Reverta Web e
   API como par de SHAs testado. Nunca use `latest` como referencia.

## 4. Procedimento depois do corte ou da coorte CTWA

Nao use a sequencia de Edge acima. Confirme as duas tarefas compativeis, o papel
do banco, o estado do worker e os erros `whatsapp_ctwa_cohort_*`. Pare a
ampliacao, registre a primeira falha e preserve inbox, snapshots e outbox.
Corrija adiante com um novo SHA compativel. Se for preciso isolar a sessao
piloto, planeje o efeito sobre mensagens novas e obtenha autorizacao antes da
mudanca. Nao reprocesse, descarte ou edite eventos para simular uma reversao.

## 5. Criterios de encerramento

Leia a imagem e a configuracao efetiva de cada tarefa; valide `/readyz` e um
envio e recebimento reais na sessao piloto, uma unica mensagem/card no CRM,
permissoes de acesso, ausencia de efeitos de eventos antigos e filas sem leases
presas. Compare com a linha de base registrada antes da mudanca. Aviso externo
ja enviado e exclusao fisica nao sao desfeitos por rollback.

O corte antigo de credenciais em URL continua exigindo callback tokenless e
autenticacao interna por header. Nunca restaure uma imagem que coloque segredo
na URL do webhook.
