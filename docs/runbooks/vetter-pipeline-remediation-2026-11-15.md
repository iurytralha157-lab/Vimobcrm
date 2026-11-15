# Pipeline: ajustes F01, F05 e F07

Base `279d4053`, branch `codex/vetter-audit-remediation-20261115`.
Esta entrega prepara código e testes locais; não registra implantação.

## Causas e mudanças

- F01: a consulta compartilhada de dependências tentava ler
  `automation_nodes.config`; a coluna canônica é `node_config`, conforme a
  baseline de 22/07. Corrigida a projeção do nó legado, preservando o formato
  JSON `config` consumido pelo restante do guard. A fixture e seu INSERT agora
  usam a coluna física real. Nenhum contrato de schema foi modificado.
- F05: o menu Configurar pipeline oferece Renomear pipeline aos usuários que
  já podem gerenciar o funil. O diálogo usa a API e o schema existentes, captura
  o nome e a revisão ao abrir e conserva a intenção de acesso do comando.
  A mutation de atualização reutiliza o helper já usado pelas demais mutations
  CRUD, incluindo invalidação do cache da organização e proteção de callbacks.
  Não há permissão nova nem mudança de autorização no servidor.
- F07: somente `pipeline_stages_changed` transforma a confirmação em conflito
  de revisão. Bloqueios por histórico, automação ou roteamento preservam a
  mensagem da API e não passam a afirmar que outra sessão editou a coluna.

Chamadores conferidos para F01: arquivamento em `stage_archive_policy.go`,
exclusão de etapa e exclusão do funil por `repository.go`. A consulta mantém
os filtros de organização, versões ativas, execuções pendentes e estágios-alvo.
F05 alcança Toolbar, diálogo, mutation compartilhada e cliente/validação já
existentes. F07 alcança o callback de exclusão de `StagesEditorDialog`.

## Reprodução e verificações

1. Corrigir somente a fixture para espelhar `node_config` reproduziu
   `SQLSTATE 42703` em todos os 20 cenários PostgreSQL do guard antes do ajuste.
2. Após corrigir a consulta, o pacote Go de pipeline passou em PostgreSQL 17.11
   descartável, com `VIMOB_RUN_STAGE_ARCHIVE_DB_TESTS=LOCAL_WRITE_TEST` e conexão
   administrativa explícita em loopback. A rodada registrou 289 resultados de
   testes/subtestes aprovados, sem testes pulados. Não comprova RLS do schema
   completo Supabase nem operação em produção.
3. Dois harnesses de repositório descartável descartavam a senha ao montar o
   pool de teste. Passam a preservar usuário/senha da conexão já validada,
   mantendo o alvo loopback e o banco aleatório próprio. Não se habilitou trust.
4. A regressão de confirmação usa callbacks e mutations reais. Os seis casos
   passaram: revisão antiga de coluna/automação e quatro causas de dependência.
   O harness da automação recebeu os dois valores de contexto que o código
   atual exige; os asserts originais foram preservados.
5. O runner canônico executou sete arquivos afetados, com 208 testes aprovados,
   zero falhas e zero pulos. A suíte de menu/diálogo de renomeio passou45/45,
   incluindo a revisão final de restauração de permissão. A captura do diálogo
   foi conferida. Typecheck completo passou; lint completo teve zero erros e
   oito avisos em arquivos não alterados.

Comandos locais, sem produção:

```powershell
go test -json ./apps/api/internal/pipelines -count=1
node --experimental-strip-types --test components/features/pipelines/pipeline-screen/delete-confirmation-retirement.test.mjs
npm run typecheck
npm run lint
```

O conjunto de sete arquivos e seus argumentos `--file` está no registro
`PIPELINE_COLUMNS_FILES` de
`D:/Vimob/outputs/vetter-remediation-20261115/pipeline-runtime.log`, seguido do
resultado `PIPELINE_COLUMNS_RESULT`. O runner foi executado com concorrência2.
O comando sem filtros `npm run test:pipeline-columns` amplia para toda a suíte;
não se declara aqui aprovação dessa execução integral.

Os testes de banco só executam com as variáveis opt-in descritas no próprio
harness. Não salvar a URL com senha nem herdar um alvo remoto. Cada fixture
cria e remove apenas seu banco aleatório em um cluster exclusivo de testes.

## Implantação, canário e reversão

Antes de publicar, registrar o SHA efetivo de Web/API, rever os gates e o diff.
Esta correção não exige migration. Após publicar API e Web correspondentes,
executar em Vetter co. os canários RET04/RET05 e o renomeio de um funil sintético.
Conferir resposta, revisão, cache após reabrir e operação por perfil autorizado.
Os conflitos esperados devem permanecer HTTP 409 com a causa correta, sem exclusão
de histórico nem alteração de fluxo vinculado.

Reverter a release Web/API anterior se necessário, sem executar reversão de
schema ou apagar dados. A versão antiga da API volta a ter o erro de F01;
evitar arquivar/excluir etapas até a versão corrigida ser restaurada. Um nome
sintético alterado pode ser restaurado pela mesma ação e revisão atual.
