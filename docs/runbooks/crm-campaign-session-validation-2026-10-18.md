# Campanhas e revogação de sessões — validação local de 18/10/2026

Continuação da [auditoria dos filtros compartilhados](crm-filter-sidebar-rollout-2026-10-17.md). Escopo: P2 de múltiplas campanhas em Contatos/Pipeline e investigação de JWT aceito depois de logout. Checkout principal `D:\Vimob\workspaces\vimob-crm`, branch `main`, HEAD `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`, incluindo alterações locais de outras auditorias.

Não houve deploy, push, commit, migração, alteração de permissões, troca de senha ou escrita nos registros do CRM. A prévia existente na porta 3000 foi preservada, inclusive seu destino de API publicada. A API temporária desta verificação executou separadamente em loopback, com PostgreSQL forçado a somente leitura e workers desligados.

## P2 de campanhas

O erro identificado na API publicada é ignorar os parâmetros repetidos `campaignIds` (Contatos) e `filterCampaigns` (Pipeline). A interface envia esse formato quando duas ou mais campanhas estão selecionadas. Sem o filtro interpretado pelo servidor, o resultado pode coincidir com a consulta sem campanhas.

Uma campanha selecionada na interface ainda envia o parâmetro singular de compatibilidade. Portanto, a falha observada com um parâmetro plural isolado não demonstra que a seleção única da interface esteja quebrada.

O checkout atual já continha o tratamento correto, preservado nesta rodada:

- `apps/api/internal/leads/support_contacts.go`: interpreta `campaignIds`, mantém o singular e repassa a seleção ao construtor de atribuição.
- `apps/api/internal/leads/pipeline_board_types.go`: interpreta `filterCampaigns`, mantendo `filterCampaign`.
- `apps/api/internal/leads/pipeline_board.go`: usa a seleção completa no predicado de atribuição.
- O SQL utiliza parâmetros vinculados e `ANY` para múltiplos valores; os predicados de organização e visibilidade continuam necessários. A correspondência de campanha/página/conjunto/anúncio pertence à mesma atribuição, sem combinar dimensões de eventos diferentes.

Não foi criado um fallback que filtre apenas a página já carregada, una resultados incompletos no navegador ou escolha somente a primeira campanha. Essas estratégias alterariam contagens, paginação e exportação.

Foi acrescentado `apps/api/internal/leads/campaign_query_protocol_test.go`. O teste passa uma URL codificada pelos parsers públicos e pelos construtores reais de SQL de Contatos e Pipeline, com três perfis e duas organizações sintéticas. Confere:

1. Parâmetro singular legado e plural com um valor.
2. Duas campanhas, incluindo nome com vírgula, sem separação indevida do texto.
3. Ordem invertida e valores duplicados.
4. Parâmetro singular de compatibilidade junto do plural da interface.
5. Preservação explícita dos argumentos de organização, usuário e visibilidade do perfil, além de todos os predicados anteriores ao filtro.
6. Inclusão da seleção inteira como parâmetro SQL, sem interpolar os valores no texto da consulta.

O teste verifica parser, SQL gerado e argumentos. Não executa PostgreSQL, não renderiza o navegador e não prova quais registros reais retornam.

Um ensaio de mutação usou apenas um overlay temporário do Go para retirar a leitura dos plurais. O novo teste reprova essa variante deliberadamente defeituosa em 36 casos de seleção plural, preservando os controles singulares. A versão normal passa os 60 casos de seleção. Nenhum arquivo de produto foi modificado para realizar o ensaio.

## Revogação de sessões

Logout e validade criptográfica do JWT são verificações diferentes. O Supabase remove a sessão afetada, mas um JWT já emitido pode continuar dentro do prazo de validade. Para bloqueio imediato, o servidor precisa conferir se o `session_id` assinado ainda existe. Referências oficiais: [sessões do Supabase](https://supabase.com/docs/guides/auth/sessions) e [signOut](https://supabase.com/docs/reference/javascript/auth-signout).

Na revisão publicada anteriormente observada, as leituras de `/v1/me`, Contatos e Pipeline tinham validação de JWT sem o guard de sessão ativa. No checkout atual, as mesmas rotas já utilizam o guard; esse código foi preservado.

- `apps/api/internal/app/auth_sessions.go` consulta `auth.sessions` por SID e usuário assinados em cada chamada protegida. Não há cache de sessão nesse checker.
- `apps/api/internal/httpserver/active_session.go` rejeita SID ausente ou revogado com 401. Checker indisponível/erro de consulta retorna 503, com limite de três segundos, sem liberar a operação.
- O cache de associação da organização é um mecanismo separado e não substitui a consulta da sessão.
- O fluxo de logout global do checkout já trata falhas transitórias, resultados de revogação não comprovados e troca concorrente de sessão. Os testes existentes desse fluxo passaram; não houve edição de AuthContext ou alteração do comportamento de logout nesta rodada.

Foi acrescentado `apps/api/internal/app/session_revocation_lifecycle_routes_test.go`, usando rotas registradas e verificador real de JWT, com checker de sessão e resolução de tenant sintéticos. São três perfis, duas identidades/SIDs e duas organizações. O mesmo JWT é aceito enquanto o SID existe e rejeitado após remover apenas esse SID do checker.

Os 114 requests do teste incluem 72 negativos após revogação; 24 controles ativos de Contatos/Pipeline que chegam à validação de entrada do handler; e 18 controles de `/me`/tenant. GET e HEAD são cobertos. O teste também preserva a outra sessão e o bloqueio de acesso à organização alheia. Não demonstra revogação global de todas as sessões, Realtime ou Data API direta.

## Banco real: pré-requisito que bloqueou as campanhas

A conexão temporária com o banco real foi estabelecida por encaminhamento SSH em loopback. O verificador PostgreSQL confirmou `default_transaction_read_only=on`; a API utilizou também `ForceReadOnly=true`, pool máximo de uma conexão, workers desativados e header `X-Vimob-Database-Read-Only: true`. Nenhum comando remoto de configuração foi executado.

O primeiro controle autenticado de `/v1/me` da API local retornou 500 `tenant_resolution_failed`, antes de disponibilizar contexto de acesso. Um diagnóstico Go temporário, somente leitura, executando o resolver atual, isolou:

```text
SQLSTATE 42703
column leader_membership.membership_generation does not exist
```

O alias é `public.organization_members`, no carregamento de liderança em `apps/api/internal/tenant/repository.go`. A dependência está em `supabase/migrations/20261009030225_membership_access_generation.sql`, que acrescenta `membership_generation` em associações da organização, equipes e filas. A ausência de `organization_members.membership_generation` foi confirmada nesta rodada; a mensagem não certifica o estado das outras duas tabelas nem toda a cadeia de migrations.

A [auditoria da Dashboard](dashboard-hardening-2026-10-12.md) já documentava o pré-requisito de geração de associação. A comparação protege contra reaproveitamento de permissões de uma associação anterior. Retirá-la, ignorar o erro ou usar um tenant privilegiado apenas para obter resultados violaria o objetivo da validação.

Nenhuma migration foi aplicada e nenhuma proteção foi relaxada. Assim, a matriz de consultas de campanhas da API local com os três perfis reais **não foi concluída**. Os resultados antigos da API publicada não validam as correções locais.

## Revogação com três perfis reais da Vetter Co.

Foi usado um controle positivo separado, `GET /v1/me/account-status`. Essa rota exige sessão ativa e lê somente o status da própria conta; não resolve tenant nem consulta a coluna ausente. A associação atual à Vetter Co., o papel e a liderança ativa das três identidades foram confirmados por SELECTs parametrizados, somente leitura. Isso não avalia a geração de associação nem substitui `/v1/me` com contexto completo.

Para cada uma das três identidades reais — administrador, líder e usuário comum — foi criada uma sessão temporária, sem alterar senha, papel ou permissões:

- Antes do logout: `account-status` retornou 200 e contrato válido, nos três casos.
- Logout SDK com escopo `local`: três sucessos; somente as sessões temporárias correspondentes foram revogadas.
- Depois do logout: o mesmo JWT, ainda não expirado, foi recusado em GET e HEAD de `account-status`, `/me`, `/contacts` e `/pipeline-board`: 24 respostas 401, com `session_revoked` nos 12 GETs e sem payload autenticado. HEAD não transporta corpo JSON no servidor real.

Essa sequência comprova o guard de sessão da API local contra o Auth/banco reais nos três perfis. Não comprova as consultas de campanhas, o carregamento completo de tenant, logout global de outras sessões nem a versão publicada. As duas primeiras tentativas diagnósticas de administrador também tiveram suas sessões temporárias encerradas; não entram no total desta matriz de três perfis.

Um GET público de `/healthz`, nesta rodada, confirmou que a API publicada continua em `7e490c7559b37d058395804b857173fc326e76d6`. A prévia existente na porta 3000 continua ligada a essa API. O teste do código corrigido ocorreu exclusivamente na API temporária em loopback, porta 18181.

## Regressões executadas

| Verificação | Resultado | Limite |
| --- | --- | --- |
| Pacote Go `leads`, após a ampliação do teste | 599 testes de topo aprovados, zero falhas | 62 testes de integração opt-in pulados |
| Pacote Go `app`, após o teste de ciclo de sessão | 73 testes de topo aprovados, zero falhas | Dois testes opt-in de banco pulados |
| Logout global do navegador | 22 aprovados, zero falhas | Testes com dependências simuladas |
| Mutação que ignora plurais | Reprovada como esperado | Defeito introduzido somente no overlay temporário |
| Build da API atual | Aprovado; fontes estáveis durante o build | Binário inclui o estado compartilhado do checkout, não somente o HEAD |
| Sessão real de três perfis da Vetter Co. | Três controles ativos 200; 24 bloqueios 401 após logout | Controle positivo em `account-status`; consultas de negócio bloqueadas por schema |

Os números das suítes não somam reexecuções nem tratam eventos de subtestes como testes independentes. Os 64 skips não foram convertidos em aprovação. Não houve mudança visual/frontend nesta rodada; testes visuais e de responsividade anteriores não foram apresentados como uma nova validação.

Comandos locais reproduzíveis, sem ativar integrações de banco:

```powershell
go test -p 1 ./apps/api/internal/leads ./apps/api/internal/app -count=1
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/auth/global-sign-out.test.ts lib/auth/global-sign-out.race.test.mjs
```

## Próxima validação de campanhas

Depois de reconciliar o pré-requisito de schema no ambiente escolhido, em trabalho autorizado e coordenado com a auditoria de acesso:

1. Confirmar `GET /v1/me` 200 e organização/perfil exatos para administrador, líder e usuário comum, sem conceder acessos para passar no teste.
2. Usar campanhas reais visíveis ao perfil: seleção única da interface, duas campanhas, ordem invertida e duplicatas; comparar a união completa dos registros autorizados, contagens, páginas e exportação aplicável.
3. Usar um identificador de campanha inexistente como critério, sem criar registro no banco, e exigir zero resultados; isso detecta o filtro silenciosamente ignorado.
4. Conferir os critérios compartilhados entre Contatos, Dashboard, Pipeline e Conversas. Contagens dos quatro domínios não precisam ser idênticas, pois os contratos de coorte e exibição diferem.
5. Revogar somente a sessão temporária de cada teste e repetir GET/HEAD com o mesmo JWT ainda não expirado. A revogação deve bloquear antes da resolução de tenant e do acesso aos dados.
6. Manter separadas as evidências da API local, da prévia que ainda aponta para a API publicada e de uma eventual futura implantação. Esta rodada não autoriza deploy nem migration.

## Evidências locais

Os arquivos de apoio ficam em diretórios temporários da máquina, sem tokens ou payloads de clientes nos relatórios:

- `C:\Users\andre\AppData\Local\Temp\vimob-campaign-session-fix-20261018-170718`: snapshot inicial, hashes dos arquivos preservados, logs das suítes e ensaio de mutação.
- `C:\Users\andre\AppData\Local\Temp\vimob-session-revocation-20261018-fa622250`: revisão das rotas e regressão de ciclo de sessão.
- `C:\Users\andre\AppData\Local\Temp\vimob-local-real-api-preflight-20261018-15e7a904`: verificação somente leitura, build, identidade dos processos temporários e logs operacionais.
- `C:\Users\andre\AppData\Local\Temp\vimob-vetter-local-api-live-20261018-2b69fd80`: diagnóstico sanitizado do pré-requisito de schema e testes reais desta rodada.

Esta rodada acrescenta somente os dois arquivos de testes e este relatório. As correções de produto já presentes, a migration de geração de associação e os trabalhos concorrentes permanecem preservados.

No encerramento, os processos temporários de API e encaminhamento SSH foram identificados e parados; as portas 18181 e 55433 ficaram sem listeners. A prévia existente na porta 3000 permaneceu no mesmo processo e destino. O comparativo do estado Git acrescentou somente os três arquivos desta rodada; os 17 arquivos protegidos do snapshot inicial mantiveram seus hashes.
