# Harness seguro de perfis QA para auditoria de release

Status em 2026-08-16: **bloqueado para execução em produção**. O preflight e o executor de cleanup existem como código preparatório, mas não foram executados; nenhuma organização, identidade, equipe ou convite foi criado.

## Objetivo e limites

Criar, somente depois de todos os gates passarem, um tenant descartável com três identidades novas e controladas:

- administrador da organização (`organization_members.role = admin`);
- líder de equipe (`organization_members.role = user` e `team_members.is_leader = true`);
- usuário comum (`organization_members.role = user` e `team_members.is_leader = false`).

A equipe deve nascer, em uma única operação, com uma semana completa e explícita: segunda a sexta de 08:00 a 18:00; sábado e domingo inativos. O ciclo termina apenas quando organização, dados do tenant, perfis públicos e identidades de Auth estiverem comprovadamente ausentes.

Este harness não executa SQL, migrations, deploy, seed direto, cobranças, uploads ou conexão com provedores externos. Tokens e senhas nunca devem ser salvos neste repositório, em arquivos `.env` de QA ou no relatório final.

## O que não pode ser reutilizado

Não executar `npm run test:e2e` contra produção. O setup atual em `tests/e2e/support/seed.ts` abre conexão PostgreSQL, executa `DELETE`/`INSERT`/`UPDATE`, usa service role, IDs fixos e uma senha fixa. `E2E_ALLOW_REMOTE=true` existe apenas para um projeto de staging isolado; não torna o seed seguro para a base real.

Também não usar:

- CRUD genérico de `/v1/admin/tables/*`, pois ignora os fluxos de domínio e seus invariantes;
- `seed-organization-data`, que importa dados de telecom e não provisiona tenant/perfis;
- `POST /v1/users`, que retorna `user creation requires invitation` por desenho;
- criação direta pelo Supabase Admin, que pularia convite, consentimento legal e membership oficial.

## Gates obrigatórios (fail closed)

Todos precisam estar verdes antes da primeira mutação:

1. `GET /healthz` retorna `200 {"status":"ok"}`.
2. `GET /readyz` retorna `200 {"status":"ready"}` e, portanto, o backend consegue consultar o banco.
3. Um login **novo**, feito após a recuperação do incidente, consegue obter sessão; não basta reaproveitar JWT antigo.
4. `GET /v1/me` com essa sessão retorna `context.isSuperAdmin === true`.
5. `GET /v1/admin/organizations?search=<RUN_LABEL>` funciona e não encontra nome exato igual.
6. Existem três caixas de e-mail reais, exclusivas e controladas para este run. Os endereços nunca foram usados no Vimob. O operador consegue abrir os três links enviados pelo Resend.
7. Foi definido um `RUN_LABEL` único, por exemplo `VIMOB-QA-20260816-A1B2`, e um prazo de expiração do tenant de no máximo 24 horas.
8. Foi confirmado que o operador tem uma forma **server-only** de chamar Supabase Auth Admin `deleteUser` para os três UUIDs após o purge. Uma sessão normal do CRM não atende este gate.
9. Durante o run não serão cadastrados CNPJ/CPF, telefone/WhatsApp, avatar, meios de pagamento nem integrações. Somente os três e-mails controlados podem receber comunicação.
10. O relatório do run terá um ledger com `runLabel`, `organizationId`, `invitationIds`, `userIds`, `teamId`, horário de criação e prazo de limpeza. Senhas, JWTs e tokens de convite ficam fora do ledger.

### Preflight automatizado, estritamente read-only

O script faz exatamente quatro `GET`s: `/healthz`, `/readyz`, `/v1/me` e `/v1/admin/organizations`. Ele não carrega `.env` e não possui método de escrita.

```powershell
$env:QA_API_URL = 'https://api.vimobcrm.com.br'
$env:QA_PERSONA_RUN_LABEL = 'VIMOB-QA-20260816-A1B2'
$env:QA_SUPERADMIN_ACCESS_TOKEN = Read-Host -MaskInput 'Token temporário de superadmin'
node scripts/tests/qa-persona-preflight.mjs
Remove-Item Env:\QA_SUPERADMIN_ACCESS_TOKEN
```

Resultado esperado:

```json
{
  "ok": true,
  "gates": {
    "health": "ok",
    "readiness": "ready",
    "superadmin": true,
    "runLabelAvailable": true
  }
}
```

Esse preflight não prova que o Supabase Auth aceita um login novo nem que os e-mails chegam. Esses dois gates continuam manuais.

### Descoberta da suíte sem banco ou mutações

Para revisar o denominador do Playwright sem iniciar servidores, executar o setup global ou exigir credenciais do Supabase isolado:

```powershell
$env:E2E_DISCOVERY_ONLY = 'true'
npx playwright test --list
Remove-Item Env:\E2E_DISCOVERY_ONLY
```

Esse modo apenas carrega a configuração e lista os cenários. Ele não relaxa os bloqueios do modo normal: uma execução real continua exigindo Supabase local ou staging explicitamente isolado e nunca aceita os hosts de produção.

## Cabeçalhos dos contratos autenticados

```http
Authorization: Bearer <ACCESS_TOKEN_EM_MEMORIA>
Accept: application/json
Content-Type: application/json
X-Organization-ID: <QA_ORGANIZATION_ID>  # obrigatório nas operações do tenant
```

O header de organização pode ser omitido nos endpoints exclusivos de superadmin, mas deve ser enviado nas chamadas do administrador, líder e usuário para tornar o tenant testado explícito.

## Provisionamento oficial

Cada fase deve ser registrada no ledger e validada antes da próxima. Se uma fase falhar, não improvisar por tabela ou SQL: iniciar o cleanup com os identificadores já obtidos.

### 1. Criar organização e convite do administrador

Autorização: superadmin confirmado por `/v1/me`.

```http
POST /v1/admin/organizations

{
  "name": "<RUN_LABEL>",
  "segment": "imobiliario",
  "adminEmail": "<QA_ADMIN_EMAIL>",
  "adminName": "QA Administrador"
}
```

Resposta esperada: HTTP 201 com `organization.id` e `organization.admin_invitation`. Exigir:

- `admin_invitation.email_sent === true`;
- `admin_invitation.existing_account === false`;
- `admin_invitation.accepted === false`;
- `creation_recovered === false` no primeiro envio.

O token de convite é removido da resposta por desenho. O link precisa ser obtido da caixa de e-mail controlada. Uma repetição dentro de 30 minutos pode recuperar a mesma organização/convite; nunca assumir que um timeout significa que nada foi criado.

### 2. Dar acesso temporário sem cobrança

Uma organização nova nasce em trial, mas sem `trial_ends_at` e sem catálogo de módulos suficiente. Antes de aceitar o convite, configurar um trial curto e explícito, sem plano ou cobrança:

```http
POST /v1/admin/organizations/<QA_ORGANIZATION_ID>/access

{
  "organizationUpdates": {
    "is_active": true,
    "subscription_status": "trial",
    "subscription_type": "trial",
    "trial_ends_at": "<DATA_UTC_DE_AMANHA_OU_ATE_14_DIAS>",
    "clear_trial_ends_at": false,
    "max_users": 3,
    "admin_notes": "Tenant descartável <RUN_LABEL>; apagar até <DEADLINE_UTC>"
  },
  "modules": [
    "crm", "properties", "site", "automations", "agenda", "whatsapp",
    "ai_agent", "campaigns", "instagram", "portals", "api", "webhooks",
    "cadences", "tags", "round_robin", "reports", "performance", "gamification"
  ]
}
```

Não habilitar `financial`: o módulo tem regra operacional específica e não é necessário para a matriz Admin/Líder/Usuário deste tenant. Não criar cliente, assinatura ou checkout no Asaas.

Após `200 {"ok":true}`, consultar `GET /v1/admin/organizations?search=<RUN_LABEL>` e `GET /v1/admin/organizations/<ID>/modules`. Confirmar trial futuro, limite 3 e módulos esperados. O endpoint de acesso não é uma única transação para organização + todos os módulos; a leitura posterior é obrigatória.

### 3. Aceitar o administrador pela interface oficial

Abrir o link recebido na caixa de e-mail em um perfil de navegador isolado. Definir uma senha nova no gerenciador de segredos temporário, aceitar Termos e Privacidade e concluir pela tela de convite.

Contrato público usado pela tela:

```http
POST /v1/public/invitations/<TOKEN_DO_EMAIL>/accept

{
  "name": "QA Administrador",
  "password": "<SENHA_SOMENTE_EM_MEMORIA_OU_SECRET_MANAGER>",
  "termsAccepted": true,
  "privacyAccepted": true,
  "termsVersion": "<VERSAO_ATUAL_DA_APLICACAO>",
  "privacyVersion": "<VERSAO_ATUAL_DA_APLICACAO>"
}
```

Usar a interface evita congelar versões legais no harness. No snapshot atual elas são `2026-08-04+sha256-75afb10bf95d` e `2026-08-04+sha256-cb69fff4e802`, mas podem mudar.

Fazer login novo como administrador e exigir de `GET /v1/me`:

```json
{
  "context": {
    "organizationId": "<QA_ORGANIZATION_ID>",
    "memberRole": "admin",
    "isSuperAdmin": false,
    "isTeamLeader": false
  }
}
```

### 4. Convidar líder e usuário

Autorização: token do administrador + `X-Organization-ID` do tenant.

```http
POST /v1/invitations

{"email":"<QA_LEADER_EMAIL>","role":"user"}
```

```http
POST /v1/invitations

{"email":"<QA_USER_EMAIL>","role":"user"}
```

Em ambas as respostas exigir `email_sent === true` e `existing_account === false`. Aceitar cada link em perfil de navegador isolado, com senha própria, nome correspondente e consentimentos atuais. Depois de cada login, validar `/v1/me`: `memberRole === "user"`, organização exata e `isSuperAdmin === false`.

Obter os UUIDs com `GET /v1/users` usando o administrador e conferir os e-mails exatos. Não usar `GET /v1/admin/users` como fonte de membership do tenant.

### 5. Criar equipe com agenda completa

Autorização: administrador + `X-Organization-ID`.

Payload de disponibilidade, repetido para líder e usuário:

```json
[
  {"day_of_week":0,"start_time":null,"end_time":null,"is_all_day":false,"is_active":false},
  {"day_of_week":1,"start_time":"08:00","end_time":"18:00","is_all_day":false,"is_active":true},
  {"day_of_week":2,"start_time":"08:00","end_time":"18:00","is_all_day":false,"is_active":true},
  {"day_of_week":3,"start_time":"08:00","end_time":"18:00","is_all_day":false,"is_active":true},
  {"day_of_week":4,"start_time":"08:00","end_time":"18:00","is_all_day":false,"is_active":true},
  {"day_of_week":5,"start_time":"08:00","end_time":"18:00","is_all_day":false,"is_active":true},
  {"day_of_week":6,"start_time":null,"end_time":null,"is_all_day":false,"is_active":false}
]
```

```http
POST /v1/teams

{
  "name": "Equipe <RUN_LABEL>",
  "is_active": true,
  "members": [
    {
      "userId": "<QA_LEADER_USER_ID>",
      "isLeader": true,
      "availability": "<ARRAY_COMPLETO_ACIMA>"
    },
    {
      "userId": "<QA_USER_USER_ID>",
      "isLeader": false,
      "availability": "<ARRAY_COMPLETO_ACIMA>"
    }
  ]
}
```

No JSON real, substituir cada string `"<ARRAY_COMPLETO_ACIMA>"` pelo array, não por texto. O backend exige exatamente sete dias únicos (0 a 6), valida início menor que fim e grava equipe, membros e disponibilidade na mesma transação.

### 6. Provas por persona

- Administrador: `/v1/me` tem `memberRole=admin`; `GET /v1/teams/<TEAM_ID>` mostra dois membros e um líder; `GET /v1/member-availability?teamMemberIds=<IDS>` devolve 14 linhas no padrão exato.
- Líder: `/v1/me` tem `memberRole=user`, `isTeamLeader=true` e `ledTeamIds` contém `<TEAM_ID>`.
- Usuário: `/v1/me` tem `memberRole=user`, `isTeamLeader=false` e não contém `<TEAM_ID>` em `ledTeamIds`.
- Nos três perfis, `organizationId` precisa ser exatamente o tenant QA e `isSuperAdmin=false`.

Se a auditoria funcional criar registros adicionais, cada ID deve entrar no ledger. Não conectar Meta, Google, WhatsApp/Evolution, Asaas, portais ou webhooks. Não criar cadências neste harness: além de fugir do objetivo, o E2E legado contém cadências e não é seguro na produção.

## Cleanup autorizado, sem SQL

Cleanup deve começar no mesmo turno em que o teste termina e, no máximo, antes do deadline registrado.

### 1. Encerrar sessões controladas

Efetuar logout global nos três perfis enquanto as sessões ainda estão disponíveis. Guardar somente os três `userId`s no ledger. Um logout encerra refresh tokens; um access JWT já emitido pode continuar criptograficamente válido até expirar, por isso os passos de tenant e Auth abaixo continuam obrigatórios.

### 2. Purge oficial do tenant

Autorização: superadmin confirmado novamente por `/v1/me`.

```http
DELETE /v1/admin/organizations/<QA_ORGANIZATION_ID>

{"confirmation_name":"<RUN_LABEL_EXATO>"}
```

Resposta esperada:

```json
{"ok":true,"deleted_users":0,"cleanup_warnings":[]}
```

`deleted_users: 0` é esperado e importante: esse fluxo desativa o tenant, limpa Asaas/Google/Evolution/Storage do tenant e apaga os dados relacionais do tenant, mas deliberadamente preserva identidades e ativos pessoais. Se qualquer integração externa falhar, o fluxo fecha em erro e não deve ser contornado; registrar o erro e repetir somente pelo mesmo endpoint após resolver o provedor.

Provas imediatas:

- `GET /v1/admin/organizations?search=<RUN_LABEL>` não contém o ID nem o nome exato;
- os tokens antigos não obtêm contexto para `<QA_ORGANIZATION_ID>` em `/v1/me`;
- `GET /v1/user-organizations` de cada identidade não lista o tenant apagado.

### 3. Apagar as três identidades de Auth

Não existe hoje endpoint do CRM que faça isso:

- `DELETE /v1/admin/users/<ID>` apenas marca `public.users.is_active=false`;
- `DELETE /v1/users/<ID>` desativa membership/perfil e transfere recursos, mas não apaga Auth;
- a exclusão da organização retorna `deleted_users: 0` por contrato.

Portanto, após o purge do tenant, um operador server-only precisa executar para cada UUID o equivalente oficial a:

```ts
await supabase.auth.admin.deleteUser(userId)
```

O cliente precisa ser inicializado no servidor com a service role/secret key, nunca no navegador. Como o teste proíbe avatar e uploads, não deve haver objeto de Storage pertencente aos usuários; se houver, `deleteUser` pode falhar e o objeto deve ser removido pela Storage API antes de tentar novamente.

Provas finais para cada e-mail/UUID:

1. Supabase Auth Admin `getUserById(userId)` retorna usuário inexistente.
2. `GET /v1/admin/users` não contém UUID nem e-mail (a FK `public.users.id -> auth.users.id ON DELETE CASCADE` deve remover o perfil).
3. `GET /v1/admin/organizations?search=<RUN_LABEL>` continua vazio.
4. Nenhuma organização aparece em `/v1/user-organizations` com eventual JWT ainda não expirado.
5. O ledger marca `tenantPurgedAt`, `authUsersDeletedAt` e `residueVerifiedAt` para os três perfis.

Qualquer resíduo mantém o run aberto e bloqueia a afirmação de reversibilidade.

### Executor server-only, fail closed

O executor versionado em `scripts/qa/qa-persona-cleanup.mjs` automatiza somente os passos 2 e 3 acima. Ele não altera o contrato de `DELETE /v1/admin/organizations/<ID>`: o purge oficial precisa continuar retornando `deleted_users: 0`; só depois da prova de ausência do tenant o executor apaga as identidades separadamente pelo Supabase Auth Admin.

O ledger de cleanup deve ficar fora do repositório, com permissão restrita, e conter exatamente este núcleo:

```json
{
  "runLabel": "VIMOB-QA-YYYYMMDD-XXXX",
  "organizationId": "<UUID_DA_ORGANIZACAO>",
  "personas": [
    {"role":"admin", "userId":"<UUID_ADMIN>", "email":"<QA_ADMIN_EMAIL>"},
    {"role":"leader", "userId":"<UUID_LIDER>", "email":"<QA_LEADER_EMAIL>"},
    {"role":"user", "userId":"<UUID_USUARIO>", "email":"<QA_USER_EMAIL>"}
  ]
}
```

O script rejeita prefixo diferente de `VIMOB-QA-`, UUID/e-mail repetido, qualquer quantidade diferente de três perfis ou papéis diferentes de `admin`, `leader` e `user`. Ele também exige duas confirmações literais independentes — `RUN_LABEL` e UUID da organização — e um terceiro aceite explícito da exclusão permanente de Auth.

Somente depois da aprovação operacional e dos gates deste documento:

```powershell
$env:QA_SUPERADMIN_ACCESS_TOKEN = Read-Host -MaskInput 'Token temporário de superadmin'
$env:QA_SUPABASE_SECRET_KEY = Read-Host -MaskInput 'Secret server-only do projeto Supabase'

node .\scripts\qa\qa-persona-cleanup.mjs `
  --api-url 'https://api.example.invalid' `
  --supabase-url 'https://project-ref.supabase.co' `
  --ledger-file 'C:\secure\vimob-qa-ledger.json' `
  --confirm-run-label 'VIMOB-QA-YYYYMMDD-XXXX' `
  --confirm-organization-id '<UUID_DA_ORGANIZACAO>' `
  --audit-file "$env:TEMP\vimob-qa-cleanup.ndjson" `
  --acknowledge-permanent-auth-deletion

Remove-Item Env:\QA_SUPERADMIN_ACCESS_TOKEN
Remove-Item Env:\QA_SUPABASE_SECRET_KEY
```

As URLs são obrigatórias e não podem conter credenciais, path ou query. Token e secret não têm flags de linha de comando e não são carregados de `.env`. Um secret opaco `sb_secret_...` é enviado somente no header server-only `apikey`; um JWT legado só é aceito quando seu claim `role` é `service_role`. O log contém apenas eventos, status, papel e contadores — nunca token, secret, senha, UUID, `RUN_LABEL` ou e-mail completo.

Antes de qualquer `DELETE`, o executor confirma novamente `/v1/me`, vincula a organização por nome + UUID no CRM, exige que ela tenha exatamente os três usuários do ledger (um quarto usuário bloqueia o run) e vincula cada perfil por UUID + e-mail tanto no CRM quanto no Auth Admin. A sequência destrutiva é fixa:

1. `DELETE /v1/admin/organizations/<ID>` com `confirmation_name` exato;
2. nova busca pelo `RUN_LABEL` e listagem administrativa completa provam a ausência tanto do nome quanto do UUID da organização;
3. exatamente três `DELETE /auth/v1/admin/users/<UUID_DO_LEDGER>`;
4. três leituras Auth Admin por UUID precisam retornar inexistente;
5. `GET /v1/admin/users` precisa estar sem os três UUIDs e e-mails.

Uma resposta de purge com `deleted_users` diferente de zero, warning, organização residual, binding divergente ou perfil residual interrompe o processo. `--resume-cleanup` existe somente para retomar um run parcialmente concluído que já passou por esse mesmo executor; sem essa confirmação adicional, uma organização ou identidade inicialmente ausente fecha em erro.

Verificação local, sem socket ou upstream:

```powershell
node --test .\scripts\qa\qa-persona-cleanup.test.mjs
npx eslint .\scripts\qa\qa-persona-cleanup.mjs .\scripts\qa\qa-persona-cleanup.test.mjs
```

Os testes usam um `fetch` HTTP em memória e provam que nenhuma chamada de rede real ocorre.

## Autoridade disponível hoje

- O caminho de criação e purge de organização existe no CRM e não exige SQL, inclusive pela interface de superadmin.
- A sessão comum observada durante a auditoria não é superadmin; portanto ela não pode chamar esses endpoints.
- O backend possui cliente interno capaz de apagar Auth para compensações de provisioning e continua sem expor exclusão arbitrária pelo CRM; o executor separado usa Auth Admin server-only e limita os alvos aos três UUIDs/e-mails do ledger.
- Há chave de serviço configurada em arquivo de ambiente do projeto, porém ela não está carregada como autoridade desta sessão e não deve ser lida, copiada ou usada implicitamente.
- Consequência: **o caminho code-only para o ciclo reversível agora existe e está testado com mocks, mas a execução continua bloqueada até haver aprovação explícita, sessão superadmin nova, secret server-only fornecido em memória e tenant QA realmente provisionado**.
