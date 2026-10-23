# Contatos — correções da revisão de 13/10/2026

Estado: alterações locais no checkout principal `D:\Vimob\workspaces\vimob-crm`,
preservando os trabalhos em andamento. Nenhum deploy, push, commit, importação
real, conexão ao banco do projeto ou aplicação de migration foi feito nesta etapa.
HEAD de referência: `1539ac4aa0c3b10f5b38685bbaaf958b0a6413ee`.
O checkout compartilhado contém outras alterações; não é um candidato de release
limpo ou reproduzível apenas por este SHA.

## Pontos corrigidos

| Prioridade | Problema da revisão | Comportamento implementado |
| --- | --- | --- |
| P1 | Contato novo Ganho podia contornar reserva e comissão | Estado inicial aberto e transição comercial real na mesma transação; operação e atribuição efetiva autorizadas; reserva, atividade/outbox, gatilho financeiro existente e recibo concluídos antes do COMMIT. |
| P1 | Mutações secundárias podiam herdar outra sessão durante um await | Gesto captura organização, usuário e SID antes da espera. Cliente de API preserva a intenção; hooks cancelam o escopo antigo e bloqueiam callbacks tardios, incluindo atividades, tarefas, tags, primeira resposta, atribuição e movimentos. |
| P2 | Lista, CPF/RG e histórico mantinham dados negados | 403/404 eliminam ou ocultam o snapshot daquele recurso. Falhas transitórias continuam preservando dados válidos; perda da capacidade de perfil mascara dados imediatamente. |
| P2 | Histórico conservava URL direta de anexo depois da negação da origem | Histórico remove aliases de `file_url`, inclusive metadata legada aninhada; conserva ID/nome/tipo/tamanho. A URL autorizada pertence ao endpoint do anexo. Autorização e leitura do histórico compartilham uma transação READ ONLY REPEATABLE READ por chamada. |
| P2 | Strings XLSX como `="x"` mudavam ao reimportar | Texto, rich text, hyperlink e resultado textual de célula permanecem literais. Só a fórmula constante real é decodificada pelo caminho próprio; CSV mantém seu contrato anterior. |
| P2 | Exportação sobrevivia à mudança de SID | Escopo e transporte capturam SID/ator. A execução confere identidade antes/depois de cada página, inclusive a verificação final de versão, e não baixa nem apresenta sucesso/erro antigo após encerramento do escopo. Refresh no mesmo SID é permitido. |
| P2 | Upload inicial/recovery não exigia operação no contato salvo | Permissão global e `can_operate === true` são necessárias. Sem isso, os arquivos são preservados para recuperação e não são enviados. |
| P2 | Criação/distribuição publicava efeitos globais após logout | Respostas antigas não emitem eventos, nomes ou toasts em outro escopo. |
| P3 | Recovery da aba retinha arquivos após fim da sessão | Lifecycle global sob AuthProvider limpa identidades encerradas, inclusive em rotas públicas. Relatórios concluídos expiram em 30 minutos, com limite de três relatórios e 20 MiB de arquivos retidos; isso não limita linhas da importação. Execuções pendentes da mesma sessão não são removidas por esses limites. |

Também foram fechadas manifestações encontradas na revisão cruzada:

- A fila real de movimentos da Pipeline captura o gesto antes da espera;
  valida o escopo antes/depois do transporte, preservando ordenação e rollback.
- Edição direta captura a intenção na entrada da API; o cache de edição
  não publica uma resposta de outra sessão como atualização atual.
- Criação de atividade autoriza e grava na mesma transação, evitando uma
  transferência entre a checagem de permissão e o INSERT.
- O bloqueio do imóvel principal revalida sua visibilidade no próprio SELECT
  FOR UPDATE, antes do INSERT e da possível reserva.
- Fechar o hover de CPF/RG mascara localmente sem cancelar a consulta
  compartilhada do editor que acaba de abrir.
- Os grupos da paginação permitem quebra em telas estreitas.
- A fixture do visualizador usa PDF mínimo válido, mantendo a validação do app.

## Dependência comercial e compatibilidade

Migration nova, **preparada e não aplicada**:
`20261013033112_defer_new_lead_stage_status_until_commercial_transition.sql`.
SHA256: `145cc65c6031941beb80de0b7d19239509b72c7c9f3673d18d49b63600379cac`.

Ela adiciona um guard privado, restrito a papéis backend, que adia somente a
automação de status do novo contato até a transição comercial. Preserva a
automação de responsável, a importação histórica silenciosa e o comportamento
das APIs antigas. A correção exige a migration e o novo backend em todas as
réplicas; aplicar SQL sozinho não corrige as réplicas antigas.

Sem o guard, ganho explícito retorna 503 `lead_creation_workflow_unavailable`
antes da gravação do contato. O cliente reconhece esse erro específico como
falha confirmada para repetição **manual** com a mesma chave após a disponibilidade
ser corrigida. Timeout/resultado desconhecido continua sem retry automático.
Reentrada existente com `lead_import` mantém sua política, inclusive a
preservação de ganho sem exigir a permissão de operar um novo ganho.

O prelock serializa criações que apontam o mesmo imóvel comercial principal,
inclusive criações abertas. Não reserva nesse momento; evita upgrade concorrente
de locks da FK. Esse custo não foi medido sob carga. As referências de interesse
em metadata mantêm suas validações individuais; não há garantia de snapshot
retido sobre todas elas.

Contrato, ordem de ativação futura e cenários PostgreSQL necessários:
[`contact-new-won-creation-local-2026-10-13.md`](contact-new-won-creation-local-2026-10-13.md).
O OpenAPI documenta o 503 e a transição comercial na criação.

## Validação local

Os testes usam dados sintéticos, funções reais de cliente/hook/diálogo com
transporte controlado, QueryClient real e fixtures/mock Go. A prova de código
e de ordem transacional não equivale a executar os gatilhos financeiros em
PostgreSQL.

| Verificação | Resultado e limite |
| --- | --- |
| Frontend de sessão/permissão/negação/cache e produtores | 86/86 aprovados, zero skips: 67 novos + 19 existentes. Revisão independente repetiu o subconjunto final de 24 testes e confirmou hashes; não somar reruns. |
| Regressões dirigidas do root | 66 testes aprovados nas execuções focadas de exportação/CSV, importação/recovery, sessão/modelo, resultado e visualizador PDF; não somar à tentativa geral incompleta. |
| Go de criação Ganho/recibo/reentrada | 24 testes principais de leads + um teste HTTP com 16 cenários aprovados. Todos incluídos na suíte Go abaixo. |
| Go de histórico/anexos/atividade | 35 testes principais aprovados, incluídos na suíte Go abaixo. |
| Suíte Go completa `leads`/`httpserver`/`app` | `leads`: 520 testes principais passaram e 31 foram pulados por falta de DB/configuração. `httpserver`: 17 passaram. `app`: 49 passaram e um falhou no contrato WhatsApp descrito abaixo. Contando subtestes, são 1.296 eventos pass, um fail e 69 skip; não somar eventos aos testes principais. |
| OpenAPI | YAML carregado e três testes de recibo/distribuição aprovados. |
| Source lock de migrations | Aprovado, 220 migrations não vazias. Hash da migration própria conferido; nenhuma aplicação SQL. |
| `git diff --check` dirigido e manifesto frontend | Aprovados; zero drift nos arquivos congelados. QueryProvider igual ao snapshot de entrada desta etapa. |
| Typecheck/lint gerais | Cada comando atingiu o limite de 180 segundos sem diagnóstico; inconclusivos. A primeira checagem de tipos focada passou em 142 segundos, antes dos últimos hunks de sessão. Resultado final dirigido registrado abaixo. |
| Tentativa Node geral de Contatos | Duas tentativas atingiram 300 segundos; a segunda limitou a concorrência a dois arquivos. Os resultados parciais aprovados não tornam a suíte geral aprovada. |

Logs preservados em `D:\Vimob\_safety\contacts-review-fixes-20261013`:
`final-go.log`, `final-contracts.log`, `final-contacts.log`,
`contacts-initial-parallel-timeout.log`, `typecheck.log`, `lint.log`,
`final-types.log` e `final-lint.log`. O supervisor registra prazos e encerra
somente os processos criados por ele. Variáveis de opt-in/URL de integração
foram removidas apenas do processo Go; não houve conexão a DB do projeto.

A falha externa à correção é
`TestNotificationDispatchWorkerIncludesBoundedWhatsAppWaitingSubqueue`, em
`apps/api/internal/app/notification_worker_contract_test.go:87`: o contrato
espera um guard de protocolo compatível nos arquivos de push WhatsApp. Esses
arquivos pertencem a alterações concorrentes e não receberam edição desta etapa.
Esse gate continua impedindo declarar a suíte geral aprovada.

Gates dirigidos finais: typecheck e lint atingiram 420 segundos sem diagnóstico,
ficando inconclusivos. O typecheck focado anterior aprovado não comprova os
últimos hunks de SID/cache. Nenhuma configuração de lint/TypeScript foi alterada
para contornar o resultado. Os checks gerais permanecem pendentes para uma
árvore reproduzível antes de homologação/release.

Comandos de referência, no checkout principal:

```powershell
node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test hooks/leads/lead-secondary-mutations.runtime.test.mjs hooks/leads/lead-definitive-denial.runtime.test.mjs hooks/leads/lead-update-session.runtime.test.mjs lib/api/lead-secondary-identity.runtime.test.mjs components/features/leads/lead-upload-permission.runtime.test.mjs hooks/lead-history/pagination-query.runtime.test.mjs components/features/leads/lead-attachment-recovery.runtime.test.mjs components/features/leads/lead-distribution-session.runtime.test.mjs components/features/pipelines/pipeline-move-session.runtime.test.mjs
node --test packages/contracts/openapi/lead-create-receipt-contract.test.mjs packages/contracts/openapi/lead-import-distribution-contract.test.mjs
node scripts/supabase/verify-migrations.mjs
npm run typecheck
npm run lint
# No diretório apps/api, com variáveis de integração desabilitadas no processo:
go test ./internal/leads ./internal/httpserver ./internal/app -json -count=1 -timeout=180s
```

As 66 regressões dirigidas do root usam estes arquivos (o PDF tem harness offline
próprio; os demais usam `--experimental-strip-types` e o alias loader acima):

```text
components/features/contacts/parse-contacts-csv.test.ts
lib/contact-export-file-output.test.mjs
lib/contact-export-integration.test.mjs
components/features/contacts/contact-import-handlers.runtime.test.ts
components/features/contacts/contact-import-recovery.test.ts
hooks/leads/use-import-leads.runtime.test.ts
components/features/contacts/contact-export-session.runtime.test.ts
components/features/contacts/contacts-screen/model.test.ts
hooks/leads/use-contact-import-recovery-session.runtime.test.ts
components/features/contacts/contact-import-result.test.ts
components/features/leads/lead-detail/lead-draft-outcome.offline-dom.test.mjs
```

O visualizador PDF também foi testado em Chromium headless offline, com todas
as requisições externas bloqueadas. Isso não comprova Safari/Mac, dispositivos
físicos, Excel/Numbers, fluxo autenticado em homologação ou produção.

## Preservação e reversão

Comparar os hunks próprios com os snapshots antes de qualquer reversão:

- `D:\Vimob\_safety\contacts-review-fixes-20261013` — arquivos do root e logs.
- `D:\Vimob\_safety\contacts-post-review-20261013\frontend-2026-10-13T03-22-17-819Z` — frontend.
- `D:\Vimob\_safety\contacts-review-20261013\backend-history` — histórico backend.

Reverter somente os trechos desta etapa; não restaurar arquivos completos,
resetar o checkout compartilhado nem reescrever migrations antigas. O
QueryProvider não recebeu alteração desta etapa. Primitivas de UI, gestão
de distribuição e outros consumidores mantêm suas alterações concorrentes.

Para homologação posterior: SQL real em banco descartável autorizado, todos
os gates gerais aprovados em árvore reproduzível e validação visual nos
dispositivos solicitados. Nada disso autoriza deploy ou acesso à produção.
