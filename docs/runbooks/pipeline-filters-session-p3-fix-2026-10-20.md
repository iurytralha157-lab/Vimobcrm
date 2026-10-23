# Pipeline — sessão ativa no catálogo de equipes (P3)

Correção local de 20/10/2026 do FBL-06 da auditoria de filtros, busca e
carregamento. Checkout principal, sem deploy, commit, migration, configuração
remota, acesso a banco operacional ou reinício dos serviços CRM.

## Problema e alteração

`SharedFilters` e `useSharedFilters` usam `useTeams({catalog:true})`, que chama
`GET /v1/teams?includeInactive=false`. A lista completa usa o mesmo GET. A rota
verificava JWT, tenant e `team_view`, mas não verificava se a sessão continuava
ativa. Um JWT assinado, ainda não expirado, atravessava a autenticação depois
de revogar sua sessão.

Foi alterado somente o registro de `GET /v1/teams` em
`apps/api/internal/app/routes.go`: `withPermission` passou a
`withActivePermission`, reutilizando o middleware existente. Nenhum wrapper,
handler, repositório, payload, consulta, frontend ou configuração foi alterado.
HEAD herda a mesma rota; parâmetros como `includeInactive` conservam o contrato.

Ordem: JWT e restrição de recovery → sessão ativa → tenant/billing → organização
→ `team_view` → handler. O checker existente consulta `auth.sessions` pelo par
SID/subject verificado. Isso segue a orientação do
[Supabase sobre revogação e JWT](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).

- SID ausente/revogado ou de outro usuário:401 antes do tenant/repositório.
- Checker ausente/falho:503 `session_check_unavailable`, sem fallback permissivo.
- Recovery:403 antes do checker; JWT expirado/anônimo:401.
- Sessão ativa continua sujeita a billing, organização, `team_view` e ao escopo
  de equipes atual, incluindo liderança.

Há uma consulta adicional de sessão por request, com timeout existente de3s.
Não há promessa de latência operacional medida. Uma operação que já passou
pelo guard antes da revogação não é desfeita retroativamente.

## Regressão executada

Teste permanente:
`apps/api/internal/app/team_catalog_active_session_test.go` (266 linhas).
Usa mux, verificador JWT, handler e ramo de retorno vazio do repositório reais;
checker de sessão e resolver de tenant são sintéticos. Nenhum banco é aberto.

Antes da alteração:92 folhas,12 aprovadas e80 falhas esperadas, sem skips.
O controle com líder sem equipes retornou200 com o mesmo JWT antes e depois
da revogação, sem chamar o checker. Após a alteração:92/92 aprovadas, zero
falhas/skips. Com a mesma JWT, o controle ativo continua200 com `data:[]` e a
requisição posterior à revogação é401, sem nova resolução de tenant.

Composição sem somar pais/folhas:32 negações de sessão/autenticação,
24 sequências ativo→revogado para administrador/líder/usuário e duas organizações,
28 controles de organização/`team_view`,8 sucessos vazios seguidos de revogação.
GET/HEAD e catálogo/lista sem query são exercitados. Os controles de
administrador/usuário ativo param deliberadamente na autorização de tenant;
não representam leitura bem-sucedida de equipes desses perfis em PostgreSQL.

Regressão dos quatro pacotes:2.453 folhas aprovadas, zero falhas e8 integrações
puladas por ausência de banco/opt-in. Esse total já inclui os92 casos novos.

```powershell
go test -json -count=1 ./apps/api/internal/app -run '^TestTeamCatalog'
go test -json -count=1 ./apps/api/internal/app ./apps/api/internal/httpserver ./apps/api/internal/tenant ./apps/api/internal/teams
```

As execuções retiram DSNs, credenciais e opt-ins de integração do processo filho.
Skips de banco não são aprovações. Logs/recibos estão fora do checkout em
`D:/Vimob/outputs/pipeline-filters-session-p3-fix-20261020-n025`.
O recibo final também registra inventários, formatação e preservação por Git/SHA.

## Compatibilidade, limites e reversão

Consumidores de filtros e de gestão continuam usando o mesmo GET e DTO.
Tokens normais de login contêm SID. Não foi identificado consumidor legítimo
que dependa de token sem SID nesse GET; não remover o guard para acomodá-lo.
As rotas adjacentes de detalhe, estatísticas e escrita de equipes não foram
alteradas nem declaradas cobertas por esta correção.

Não se executou leitura de equipes com banco, sessão Supabase real, browser
autenticado, teste de carga ou produção. O processo da API não foi reiniciado;
o resultado comprova o código local e seus testes, não o binário já em execução.
Os outros cinco defeitos da auditoria não fazem parte deste patch.

Reversão local: desfazer seletivamente esta única substituição de wrapper e a
documentação/teste desta correção, preservando as alterações preexistentes.
Isso reabre o P3; não usar reset/checkout de arquivos completos nem publicar a
reversão como correção de segurança. Não há mudança de banco para reverter.
