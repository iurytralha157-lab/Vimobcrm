# Pipeline: fechamento local dos dois P2 da Agenda

Rodada de 19/10/2026, checkout principal `D:/Vimob/workspaces/vimob-crm`,
branch `main`, base `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee` mais as
alterações locais existentes. Esta é a primeira etapa dos 14 pontos da auditoria
do card: somente os dois P2 de autorização da Agenda são tratados aqui.

## Sessão ativa nas rotas

As 14 rotas `/v1/schedule/...` de capabilities, dashboard, eventos,
conclusão, remarcação, comentários e participantes usam
`withActiveModulePermission`. Esse wrapper já existente verifica autenticação
e sessão ativa antes de resolver tenant, módulo e permissão dedicada.
Leituras e escritas têm a mesma fronteira, incluindo HEAD das rotas GET.

Sessão revogada ou SID ausente não alcança o handler; indisponibilidade da
verificação falha fechada com erro transitório. As regras de módulo `agenda`,
`schedule_view` e `schedule_manage` permanecem. O guard de sessão não substitui
autorização do evento ou do lead. Tokens antigos sem SID passam a receber a
mesma recusa que já existe nas ações centrais de leads.

Referência do contrato de identidade: [sessões do Supabase](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).
A correção reusa o verificador de sessão do projeto; não altera o SDK ou o Auth.

Não há middleware global novo, configuração, migration ou mudança nas rotas dos
outros domínios. A verificação de sessão acrescenta o custo do gate existente a
essas requisições; latência no alvo não foi medida nesta rodada.

## Vínculo novo exige operação do lead

Criar um evento com lead ou substituir o lead vinculado exige
`authorization.CanOperateLead` sobre o responsável e a equipe atuais do
recurso, além do `lead_operate` global. A sequência permanece:

1. Lock do lead da organização com `FOR SHARE ... SKIP LOCKED`.
2. Consulta fresca do pool; lead não assumido continua recusado, inclusive para
   admin e independentemente de a audiência do pool ser true ou false.
3. Leitura do responsável/equipe no mesmo tenant e validação canônica.

A terceira consulta substitui a antiga checagem de visibilidade, sem adicionar
uma consulta ao fluxo. `to_jsonb(l)->>'team_id'` mantém a compatibilidade do
snapshot legado; valores NULL são convertidos para o recurso vazio esperado.
Ausência ou escopo inválido retorna `ErrInvalidReference`, sem revelar recurso
de outra organização. Falhas de consulta continuam sendo propagadas.

Um líder pode ler o lead de um corretor liderado gravado sob outra equipe e
ainda não poder operá-lo. Esse caso agora é recusado também pelo novo vínculo
de Agenda, como já é pelas ações centrais do lead. Admin/owner, corretor próprio
e líder dentro da capacidade efetiva continuam autorizados.

## Manutenção de evento existente

`Update` mantém primeiro `canEditEvent` e a revisão CAS do compromisso. Só
valida capacidade do lead quando o payload fornece um ID diferente do vínculo
atual. Lead omitido, mesmo ID reenviado ou remoção do vínculo conservam a
autorização independente do evento; não concedem capacidade nova sobre o lead.

Concluir, remarcar, comentar e manter participantes preservam os contratos
existentes do evento. A correção não transforma participação em permissão de
operar um lead e não exige que um participante readquira a capacidade do lead
apenas para manter seu compromisso já autorizado.

## Regressões e limites

- Testes de rota usam mux, JWT e middleware reais, com checker/resolver
  sintéticos, duas organizações e entradas inválidas que param antes do banco.
  Cobrem sessão revogada, SID ausente, falha do checker, recovery, anônimo,
  módulo/permissão ausentes, tenant estrangeiro, SID de outro ator e controles
  ativos que alcançam os parsers.
- Testes de vínculo executam `validateLead`, guard de lock/pool e autorização
  reais com linhas sintéticas: líder cross-team, controles legítimos, duas
  organizações, pool, lock ocupado, falha/ausência de leitura e vínculo
  omitido/inalterado/removido/substituído.
- O cenário de líder cross-team falhou antes do patch e passou depois. A suíte
  de rotas também tem reprodução anterior sem o guard. Provas RED e GREEN e
  recibos finais ficam em
  `D:/Vimob/outputs/pipeline-agenda-p2-fixes-20261019-u014`.
- PostgreSQL real, políticas/grants instalados, prévia autenticada e produção
  não foram exercitados. Testes que exigem banco/opt-in são relatados como
  pulados, sem contá-los como aprovados.

## Entrega e reversão

Verificação final desta rodada:

| Comando | Resultado |
|---|---|
| Go serial, oito pacotes de Agenda, app, autorização, HTTP, tenant, escopo, leads e cadências | 849 testes principais PASS, 0 FAIL, 92 SKIP por dependência de banco/opt-in. Incluindo subtests: 3.632 PASS e 178 SKIP; não somar pais e filhos. |
| `npm run test:agenda` | 213 PASS, 0 FAIL, 0 SKIP; helpers e contratos de domínio, sem serviço/provedor real. |
| `npm run audit:check` | Exit 0, quatro testes do inventário aprovados; inventário não regenerado. |
| `git diff --check` nos arquivos editados | Aprovado. |

Os testes novos já integram os totais Go; as repetições focadas RED/GREEN não
são somadas novamente. Typecheck/lint/frontend global não foram repetidos:
nenhum código TypeScript/CSS ou contrato de payload do cliente mudou nesta etapa.

Os ajustes são de backend, compartilhados pela Agenda e pelo agendamento no
card da Pipeline. Nenhum layout, fonte, componente UI, cache de outras abas,
integração Google ou configuração remota é alterado.

Não houve deploy, migration, commit ou push. O candidato deve ser publicado
somente no rollout autorizado. Para desfazer a rodada local, reverta apenas os
hunks de sessão/vínculo desta etapa e seus testes/documentação, comparando com
o checkpoint externo `before/`; não restaure arquivos inteiros sobre os ajustes
preexistentes. Retirar esses guards reabre as falhas, portanto não é alternativa
segura para liberar um usuário que perdeu autorização.

Os outros 12 pontos da auditoria continuam no backlog original; os resultados
desta etapa não representam o fechamento completo da Pipeline ou a homologação
de 300 usuários.
