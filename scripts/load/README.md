# Carga local do ciclo de lead

Este harness mede o caminho crítico de um lead no ambiente E2E local:

`entrada pública -> distribuição -> feedback -> ganho/perda -> automação -> dashboard`

Ele não altera o frontend, não publica nada e não é uma certificação de capacidade de
produção. O resultado serve como evidência repetível de correção funcional, isolamento
por perfil e comportamento sob concorrência controlada.

## Travas de segurança

O processo recusa a execução antes de escrever se qualquer uma destas condições falhar:

- `VIMOB_LOAD_CONFIRM` precisa ser exatamente `LOCAL_WRITE_TEST`;
- `E2E_ALLOW_REMOTE` não pode existir no ambiente, nem mesmo com valor `false`;
- API, Supabase, banco e aplicação E2E precisam usar hosts de loopback;
- uma execução normal exige banco recém-resetado, sem organizações nem usuários Auth;
- uma recuperação exige que o banco contenha exclusivamente a organização fixa
  `11111111-1111-4111-8111-111111111111`, com nome exato `Vimob E2E Teste`, e os
  usuários Auth marcados como E2E;
- a migration `20260728190000` e o contrato canônico de distribuição precisam existir;
- apenas um harness pode rodar por vez, protegido por advisory lock do Postgres.

Tokens e chaves não são gravados no manifesto, no relatório ou nos logs do harness.

## Pré-requisitos

1. Docker e Supabase CLI funcionando.
2. Node.js 22.15 ou mais recente.
3. Stack local iniciada e resetada imediatamente antes de cada execução normal:

   ```powershell
   npx supabase start
   npx supabase db reset
   ```

   O reset é obrigatório. Depois de uma execução, faça outro reset antes de iniciar um
   novo perfil. `-CleanupRun` é a única operação aceita sobre a fixture deixada por uma
   execução interrompida.

4. `.env.e2e.local` preenchido com os valores locais. No mínimo:

   ```dotenv
   E2E_SUPABASE_ANON_KEY=valor_local
   E2E_SUPABASE_SERVICE_ROLE_KEY=valor_local
   E2E_SUPABASE_URL=http://127.0.0.1:54321
   E2E_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
   E2E_VIMOB_API_URL=http://127.0.0.1:8081
   ```

Use somente credenciais retornadas pelo Supabase local. O script PowerShell valida o
banco antes de iniciar serviços, sobe uma API própria em porta livre e recusa a execução
se já houver um `automation-executor` ativo. Ele desativa workers com integrações
externas e encerra apenas os processos que ele próprio iniciou.

## Execução

O perfil recomendado para a primeira verificação é `smoke`:

```powershell
.\scripts\load\run-local-lifecycle.ps1 `
  -Profile smoke `
  -Confirm LOCAL_WRITE_TEST
```

Perfis disponíveis:

| Perfil | Uso | Concorrência |
| --- | --- | --- |
| `smoke` | Validação rápida do contrato completo | baixa |
| `ramp` | Aumento controlado de volume | média |
| `full` | Maior cenário local predefinido | alta, ainda limitada |

Se a API e a função já estiverem prontas com a configuração E2E local, também é possível
executar diretamente:

```powershell
$env:VIMOB_LOAD_CONFIRM = 'LOCAL_WRITE_TEST'
npm run load:lifecycle -- --profile=smoke
```

Não use `scripts/load/api-read-smoke.mjs` como substituto deste fluxo para escrita: ele
foi criado para leitura e não possui as mesmas garantias de alvo.

## O que é validado

- tempestade de idempotência sem duplicar lead ou distribuição;
- reentrada preservando o responsável esperado;
- distribuição direta e por equipe, respeitando escala;
- justiça básica entre membros e ausência de falhas de distribuição;
- visibilidade de administrador, líder e usuário comum;
- primeira resposta, feedback e transições para ganho e perda;
- criação, início, conclusão e efeito observável de automação;
- ausência de novos problemas críticos no runtime da automação;
- consistência dos KPIs e filtros do dashboard para os leads da execução;
- taxa de erro, HTTP 5xx, média, p50, p95, p99 e máximo por endpoint;
- delta de deadlocks do banco e, quando disponível, amostra de
  `pg_stat_statements`.

Os limites ficam no próprio perfil e podem ser endurecidos depois de uma linha de base
estável. Um perfil local aprovado não prova suporte a 5–6 mil usuários simultâneos;
essa afirmação exige ambiente isolado semelhante à produção e teste de capacidade
dedicado.

## Relatório e limpeza

O relatório JSON é emitido no terminal. Durante a execução, o manifesto recuperável é
salvo em:

```text
.tmp/vimob-load/<run-id>.json
```

O manifesto é gravado por troca atômica de arquivo. O `finally` sempre tenta remover os
recursos descobertos pelos marcadores exatos da execução e restaurar apenas a escala dos
dois membros E2E e o vínculo equipe/pipeline comprovado pela auditoria. IDs presentes no
manifesto nunca são usados sozinhos como autorização para excluir dados. Se um processo
for interrompido à força, use o ID mostrado nas mensagens:

```powershell
.\scripts\load\run-local-lifecycle.ps1 `
  -Confirm LOCAL_WRITE_TEST `
  -CleanupRun load-20260728T123456789Z-1a2b3c4d
```

A limpeza combina APIs públicas com exclusão direta e estritamente delimitada no banco
local. Isso é necessário porque algumas entidades não têm endpoint de exclusão física
(submissões/analytics) e automações usam exclusão lógica.

Se o manifesto tiver sido apagado ou estiver truncado, o harness ainda descobre
artefatos pelo prefixo exato, mas não consegue reconstruir com segurança a escala
anterior nem saber se o vínculo equipe/pipeline já existia. Nesse caso ele preserva
esses estados e inclui um aviso no resultado.

## Ajustes opcionais

Os perfis podem ser afinados sem editar código:

- `VIMOB_LOAD_LIFECYCLE_COUNT`
- `VIMOB_LOAD_CONCURRENCY`
- `VIMOB_LOAD_DASHBOARD_REQUESTS_PER_ENDPOINT`
- `VIMOB_LOAD_REQUEST_TIMEOUT_MS`
- `VIMOB_LOAD_AUTOMATION_DEADLINE_MS`

Todos aceitam apenas inteiros positivos. Comece pequeno, preserve os relatórios e só
aumente um eixo por vez.
