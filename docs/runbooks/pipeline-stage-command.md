# Movimento comercial de lead por automação

Implementação local da correção F02 da auditoria de 16/10/2026. Não houve deploy,
configuração remota nem aplicação da migração no banco operacional.

O movimento manual e o nó visual `move_lead` usam `leads.moveStageTx`. A transação
confere destino, status terminal, motivo de perda, reserva/liberação do imóvel,
proveniência, atividades, auditoria e notificações. O comando visual também grava
o efeito idempotente e o evento durável de atualização antes do mesmo COMMIT.
Não existe fallback para o movimento SQL incompleto.

## Contrato interno

`POST /v1/internal/automations/stage-command`, autenticado por
`X-Internal-Token`, recebe somente `organizationId`, `executionId`, `nodeKey`,
`leaseToken` e `effectKey`. O destino e o motivo vêm do nó da versão imutável,
carregada novamente no banco. A chave é
`automation:<executionId>:<nodeKey>:move_lead`. Dados, permissões e destino
informados pelo chamador não podem substituir esse snapshot.

O endpoint exige execução corrente e não cancelada, lease e nó correspondentes,
organização, versão revisada, módulo habilitado e o acesso vigente do autor da
versão. Autor removido/inativo, cobrança sem acesso ou permissão insuficiente
produzem erro explícito. Essa escolha conservadora exige revisar o responsável
pelos fluxos quando um usuário deixa a organização; não fabrica um administrador
para executar regras antigas.

Sucesso retorna `{ok:true,status:"succeeded",effect_id,response}` somente depois
do COMMIT. A repetição da mesma identidade e configuração devolve o resultado
persistido, inclusive após avanço do cursor ou cancelamento da execução. Esse
ACK continua exigindo autor e módulo atualmente autorizados; ele não executa
uma nova transição. Reutilização com outra
configuração, organização ou versão é conflito. Falha comercial reverte a
transação inteira e fica visível no passo/execução; não deixa efeito `sending`
órfão. Quando o movimento provoca cancelamento da execução pelo trigger existente,
o efeito confirmado continua válido e o worker não avança uma execução cancelada.

O editor visual preserva `config.lost_reason` ao criar, abrir e salvar o fluxo.
Ele aceita até 300 caracteres. Se o destino resultar em Perdido e não houver
motivo válido, o comando recusa a operação e preserva o lead.

## Configuração preparada, sem ativação

- API: `AUTOMATION_COMMAND_TOKEN`, vazio por padrão; vazio desabilita o endpoint.
- Edge: `AUTOMATION_COMMAND_TOKEN` com o mesmo segredo dedicado e
  `AUTOMATION_COMMAND_API_URL` com a origem HTTPS da API, sem caminho, credenciais,
  query ou fragmento. HTTP só é aceito em loopback para testes locais.

Essas variáveis são exclusivas de servidor. Não usar `NEXT_PUBLIC_*`, segredo de
IA ou token de sessão de usuário. Os exemplos permanecem vazios; os testes usam
segredos e identidades sintéticos.

Indisponibilidade, resposta ambígua ou falha de leitura posterior ao COMMIT não
significam sucesso. O worker mantém o nó e a chave e usa o RPC autenticado
`defer_automation_stage_command`: no máximo três adiamentos de 30, 60 e 120
segundos por nó. O quarto resultado indisponível encerra com
`automation_command_retry_exhausted`. O claim e o início direto respeitam
`next_execution_at` usando exclusivamente o relógio do banco; o início direto
usa `claim_specific_automation_execution`, sem comparar relógio do Edge. Erros de permissão, lease, configuração e imóvel não entram
nessa repetição automática. Um retry após COMMIT consulta o ledger em vez de
repetir os efeitos comerciais.

## Publicação futura e reversão

A migração `20261016041918_automation_canonical_stage_command_guard.sql` retira
a execução direta de `private.automation_move_lead_stage`. Worker antigo recebe
`canonical_lead_command_required` e registra falha, sem mover parcialmente o lead;
ele não possui o novo mecanismo de adiamento. Por isso a futura publicação exige
pausar os executores, preparar API/configuração, aplicar a migração revisada,
atualizar o Edge e então retomar. Verificar réplicas e execuções pendentes antes
de retomar. Não executar esse roteiro sem autorização específica de publicação;
o bloqueio do ledger remoto em `supabase/README.md` continua válido.

Em reversão, pausar os executores e preservar ledger/histórico. Não restaurar o
movimento SQL antigo, pois isso reintroduz F02. Reverter os consumidores juntos
ou manter `move_lead` explicitamente suspenso até restaurar o serviço canônico.
Não apagar efeitos já confirmados e não reiniciar execuções inteiras para repetir
um único nó. Revisão de falhas antigas é operação separada.

O ACK exige ainda fluxo ativo, não excluído e versão revisada. Pausar/excluir o
fluxo ou revogar o autor após o COMMIT pode impedir recuperar a confirmação pelo
endpoint; o efeito permanece íntegro no ledger e não é repetido. Conferir esses
casos antes de decidir qualquer recuperação operacional.

## Evidência e limite

O teste `scripts/supabase/test-automation-stage-command-postgres.mjs <porta>` cria
e remove um banco aleatório em um PostgreSQL de loopback explicitamente fornecido.
Não lê `.env` nem aceita um DSN operacional. Cobre guard, grants, dois tenants,
lease, cancelamento, backoff, limite e claim concorrente. Os testes Go exercitam
o kernel e o ledger; os testes Node executam o transporte e a ação real do Edge.

As fixtures são sintéticas. Elas não substituem reset/pgTAP do baseline completo,
verificação do ledger remoto, teste de versões mistas ou homologação com as
permissões e integrações reais. Nenhum resultado local comprova o comportamento
da produção atual.
