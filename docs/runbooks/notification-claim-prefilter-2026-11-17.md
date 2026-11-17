# Pré-filtro do claim de notificações bloqueadas

O claim geral considera tanto entregas agendadas quanto entregas bloqueadas
que precisam de nova autorização de push WhatsApp. O segundo braço invoca
`private.whatsapp_inbound_push_needs_reassignment(delivery)` sobre candidatos
de todos os canais, embora o helper exija, através de `is_unstarted`,
`channel='push'` e `attempt_count=0`.

O [cutover](../../supabase/cutovers/20261117_prefilter_notification_blocked_push_claim.sql)
expõe somente esses dois predicados ao planner. Não altera elegibilidade,
ordenação, limite, `FOR UPDATE SKIP LOCKED`, lease, token, tentativas,
autorização antes de envio, provedor ou destinatário. O braço rápido de avisos
de leads, o protocolo de device push e a aposentadoria do failover Edge
permanecem intactos. Não há índice, tabela, migration ou flag nova.

## Evidência observada

Consulta somente leitura de produção em 17/11/2026, 16:45–16:50 UTC:

- O cutover de fast claim de 11/11 já estava aplicado: marker existente e índice
  `notification_deliveries_lead_whatsapp_due_idx` válido e pronto.
- 49.551 bloqueadas WhatsApp, 7.056 push e 83 e-mail. Os dois canais sem push
  não podem satisfazer o helper de reassignment.
- `EXPLAIN` **sem ANALYZE**, com o SELECT de candidatos extraído da função
  instalada, estimou custo 1.517.029 antes e 963.534 depois (~36,5% menor).
  O plano novo limita o braço bloqueado a push no índice já existente.
- O plano do fast claim permaneceu independente, usando seu índice, custo
  estimado 21,8. Custos do planner não são medições de latência real.

Os arquivos de evidência estão em
`D:/Vimob/outputs/whatsapp-encrypted-edit-recovery-20261117/`:
`notification-claim-catalog-readonly.json`,
`notification-claim-live-definition.sql`,
`notification-claim-explain-readonly.sql/.txt` e
`notification-claim-prefilter-explain-readonly.sql/.txt`.
Não contêm payload, destinatário, telefone ou credencial.

## Aplicação e reversão

O operador aplicou o cutover em produção em **17/11/2026, aproximadamente
17:03 UTC**, com CAS, transação e backup protegido das definições e atributos.
Confirmou COMMIT; leitura independente às **17:05:12 UTC** confirmou o postimage
`5745e185e04aeafdde8d0486bed3de60`. Isso comprova a substituição, sem concluir
melhoria de latência. A medição posterior usa uma janela nova e somente leitura.
O backup privado de recuperação permanece fora do Git, sob acesso restrito.

Conferir host/banco e preservar `pg_get_functiondef` da função instalada antes
da operação. Executar como `postgres` no host dono do banco, em operação
autorizada, com `psql -v ON_ERROR_STOP=1 -v direction=apply -f <cutover>`.
O arquivo abre uma transação com lock timeout de 500ms e statement timeout
de 10s; CAS e advisory lock protegem a substituição.

Preimage normalizada de `prosrc`: `fd5d88955a50359567c13b09780ac644`.
Postimage: `5745e185e04aeafdde8d0486bed3de60`. Aplicar exige hashes exatos
dos dois helpers que provam a implicação. OID, grants, owner, configuração,
assinatura e demais atributos de catálogo são preservados e conferidos.

Reversão: o mesmo arquivo com `-v direction=rollback`. Exige o postimage
exato, restaura o corpo original e confere o MD5. Repetição ou drift falha
antes da alteração. Se outra operação já mudou o corpo, investigar a nova
preimage; não substituir a função inteira cegamente.

Após aplicar, conferir o MD5 e medir, em janela equivalente, calls/tempo/rows
do claim agrupados por `(dbid,userid,queryid,toplevel)`, contenção, throughput
da inbox e estado das entregas. A melhoria real ainda depende dessa medição.
Não chamar a função mutante com `EXPLAIN ANALYZE` como diagnóstico em produção.

## Verificação sintética

[`scripts/tests/notification-claim-prefilter.local.mjs`](../../scripts/tests/notification-claim-prefilter.local.mjs)
exige `VIMOB_RUN_WHATSAPP_CI=LOCAL_WRITE_TEST`,
`VIMOB_WHATSAPP_CI_ROOT` e o caminho explícito da definição preimage exportada.
Usa `verifiedClient` para conferir a identidade do PG descartável e reverte
todo o preparo e DDL ao fim. Executar com dependências Node instaladas:

```
node scripts/tests/notification-claim-prefilter.local.mjs <preimage.sql>
```

Cobre apply/rollback com atributos íntegros, repetição, direção inválida,
drift dos helpers e 18.000 combinações de canal, estado, tentativas, prazo,
agendamento, tenant, protocolo do worker e escopo de canais. Exige casos
positivos reais do helper instalado, zero divergência, e rejeição de notificação
estranha à organização, comum, ausente ou já iniciada. Nenhum transporte de
provedor é criado. A CI geral não executa automaticamente este teste local.
O [resultado seguro registrado](notification-claim-prefilter-2026-11-17.validation.json)
contém somente nomes de checks, contagens, resultado e ausência de transportes.
