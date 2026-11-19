# Primeiro lote de organização da arquitetura — 18/11/2026

## Alvo e limite

Alteração local no checkout principal, baseada em
`05ff562c4dc4824b7b17ea2fb6c7bda1628b01fb`. Este lote usa Ponytail e Taskmaster
para separar responsabilidades existentes e preservar os contratos de API e Web.
Não muda schema, consultas, autorização, configuração ou CI. O preparo de
publicação acrescenta o patch de dependências descrito abaixo. Não há deploy
nem operação no banco de produção como parte deste preparo; publicação de
código e imagens é distinta da atualização dos serviços.

Os mapas gerais estão em [ARCHITECTURE.md](../../ARCHITECTURE.md) e
[QUICK_REFERENCE.md](../../QUICK_REFERENCE.md). As contagens desses mapas
identificadas como baseline continuam sendo um retrato do commit acima.

## Conjunto alterado

- **Leads na API:** `repository_read.go` reúne leitura e projeção SQL;
  `repository_scan.go` reúne scanners e conversores. Os arquivos têm 222 e 296
  linhas e continuam no pacote `leads`. `repository.go` cai de 5.576 para 5.081
  linhas. Transações, mutações e efeitos permanecem nos caminhos anteriores.
  Veja o [README do domínio](../../apps/api/internal/leads/README.md).
- **Validação no Web:** as declarações de `auxiliary.ts` passam aos módulos
  donos dos contratos. A fachada fica com 146 linhas e mantém os 113 exports
  públicos. `index.ts` e `common.ts` permanecem intactos. O único ajuste em
  teste troca o caminho do fonte de feedback para o módulo dono, mantendo as
  asserções. Veja o [mapa de validação](../../lib/validation/README.md).
- **Documentação:** mapas do repositório e contratos OpenAPI corrigidos para o
  estado inspecionado. Inventários gerados atualizados somente nos digests de
  origem; contagens, IDs estáveis e superfícies permanecem iguais.
- **Correção do bloqueio de build:** `next` e `eslint-config-next` atualizados
  de 16.4.3 para 16.4.6, com o lockfile correspondente. Somente a raiz e as 12
  entradas da família Next mudam no lock. Não há atualização de React ou de
  dependências alheias ao patch. O plano operacional fica no
  [runbook de preparação do release](architecture-release-2026-11-18.md).

## Evidência de preservação

As comparações usam os fontes anteriores obtidos diretamente do commit base,
sem alterar o checkout para reconstruir a versão anterior.

- Go: 165 declarações comparadas por AST normalizada; consultas, assinaturas e
  corpos mantidos. O hash de declarações antes e depois é
  `a772a82ca460acbce27f3e6d04b2ee8a1854badbff60fea88b7b5601e86854b6`.
- TypeScript: 151 declarações preservadas, com inicializadores, tipos e 130
  referências internas conferidos. As variantes de `optionalUUID` continuam
  distintas. Primitivos compartilhados preservam a mesma instância.
- Namespace público: 113 exports da fachada e 1.213 símbolos do índice global
  preservados. Na saída CommonJS usada pela suíte, os 113 valores da fachada
  e 956 valores do índice global foram importados e comparados; a identidade
  dos valores da fachada coincide com a do módulo dono.
- Os verificadores de equivalência têm autochecagem que rejeita uma alteração
  deliberada de literal. Eles são evidência desta extração, não um novo gate
  ou uma promessa geral de equivalência para alterações futuras.

## Verificações locais

| Comando ou conferência | Resultado |
| --- | --- |
| `npm run typecheck` | Passou |
| `npm run lint` | Passou; 9 avisos preexistentes, nenhum erro |
| `npm run validation:test` | 905 testes passaram; nenhum pulo |
| `npm run validation:auth-admin` | 307 testes passaram; nenhum pulo, incluindo proxy com NextRequest/NextResponse reais |
| Testes runtime focados da extração | 23 passaram; nenhum pulo |
| `go test -json ./apps/api/... ./packages/auth/... ./packages/db/...` | 57 pacotes passaram; 4 sem testes; 9.723 eventos de teste/subteste aprovados e 601 pulados; nenhuma falha |
| Build da API para Linux ARM64, CGO desativado | Passou; binário apenas para verificação local |
| `npm run build` (Web), Next 16.4.6 | Passou com código 0; 88 páginas estáticas e saída standalone geradas |
| Smoke HTTP do build Web em modo produção, somente loopback | 16 verificações passaram: GET/HEAD, headers, redirect sem sessão, payloads inválidos e limites dos BFFs |
| Smoke de navegador com backend sintético | 4/4 passaram na repetição; primeira tentativa expirou na inicialização, antes dos cenários |
| `npm run audit:check` | Passou após regeneração dos digests; 4 testes passaram |
| `node scripts/security/check-release-audit.mjs` | Passou; gate atual verifica achados altos e críticos |
| `git diff --check` | Passou |
| `npm audit --json` | 7 achados moderados no devtoolchain; nenhum alto/crítico e nenhum finding de Next |
| `npm audit --omit=dev --json` | Nenhum achado nas dependências de produção |

Como histórico, o primeiro `npm run build` compilou o Web e gerou as 88 páginas estáticas,
mas terminou com código 1 por `SecurityFatalError` emitido pelo Next 16.4.3.
A repetição do mesmo comando também compilou, verificou os tipos e gerou as
88 páginas, terminando novamente com código 1 pelo mesmo alerta. Esses dois
resultados pertencem à versão 16.4.3. Após o patch, o build completo 16.4.6
passou com código 0. Não houve supressão do alerta ou alteração de cache de
autorização de retry.

O alerta foi confirmado nos avisos oficiais
[GHSA-mfr8-8qww-v76h](https://github.com/vercel/next.js/security/advisories/GHSA-mfr8-8qww-v76h)
e [GHSA-vc7v-qv4w-wrv8](https://github.com/vercel/next.js/security/advisories/GHSA-vc7v-qv4w-wrv8).
Ambos incluem a versão instalada e indicam correção em 16.4.5. A auditoria npm
consultada ofereceu 16.4.6, versão instalada e validada neste preparo. Isso
corrige a versão da dependência; a extração não demonstra exploração nem
ausência dela em produção.

O smoke de navegador usa o runner existente, sem alterações de timeout ou
asserções. A primeira tentativa parou no startup de 120 segundos, com o
filesystem lento e Turbopack esperando estabilização dos arquivos. Após o
build, a repetição passou nos quatro cenários: login, destino com query,
seleção de organização e rejeição de redirect externo. Processos próprios e
navegador foram encerrados. O smoke HTTP usa dados sintéticos, não autentica
usuários reais e não envia payload válido para o backend.

Logs, fontes anteriores e verificadores desta execução ficam fora do Git em
`D:\Vimob\outputs\architecture-refactor-20261118`. Não são uma cópia operacional
do projeto nem um checkout adicional.

## Limites e continuação

Os 601 pulos Go incluem integrações que exigem PostgreSQL descartável,
atestação de fixture ou opt-in explícito. Esses testes não foram aprovados por
esta execução. Não foram executados a suíte E2E completa com banco, testes SQL
locais ou validação funcional da nova versão em produção. As imagens Linux/ARM64
e os gates adicionais pertencem à CI do commit final, registrada separadamente.
Build e comparação estrutural não provam
o estado atual dos serviços, filas ou migrações de produção.

O grande repositório de Leads ainda precisa de recortes de mutações com seus
limites transacionais. Arquivos grandes de UI e hooks na raiz continuam como
trabalho futuro; esta entrega não declara encerrada a revisão de arquitetura.

## Reversão do lote

Confira primeiro o diff para preservar qualquer trabalho posterior. Reverta
as declarações Go como um conjunto: recupere `repository.go` da baseline e
retire os dois arquivos extraídos juntos. A reversão parcial deixa funções
duplicadas ou ausentes.

Na validação, reverta juntos a fachada, os quatro módulos existentes que
receberam contratos, o caminho do teste e os novos módulos extraídos. Preserve
`index.ts` e `common.ts`. Regenere os inventários e repita typecheck, lint,
testes de validação e os testes Go afetados. Não há migração ou alteração
remota a desfazer. Se o conjunto for publicado em um commit futuro, prefira
reverter esse commit completo e validar a reversão.
