# Variantes dos banners da Home

O cadastro existente em `/admin/home-content` aceita desktop e mobile para tema
claro, mais desktop e mobile para tema escuro. O banner anterior permanece no
campo `imageUrl`; nenhum arquivo existente é migrado, apagado ou substituído
automaticamente. Público, período, ordenação e autorização continuam nos mesmos
handlers da Home.

## Contrato e compatibilidade

- `imageUrl` e `mobileImageUrl`: imagens existentes, também usadas como fallback
  quando não há arte escura.
- `darkImageUrl` e `darkMobileImageUrl`: variantes opcionais do tema escuro.
- `GET /v1/home/publications?include_mobile=true&include_dark=true`: opt-in aos
  campos adicionais. Sem flags a API mantém os nove campos do contrato original;
  `include_mobile=true` sozinho mantém o contrato mobile anterior.
- Upload e remoção continuam em `/image` e `/mobile-image`; as novas variantes
  usam `/dark-image` e `/dark-mobile-image`, todos sob
  `/v1/admin/home-publications/{id}`. São operações exclusivas de superadmin,
  autenticadas com sessão ativa, com os mesmos limites de 5 MiB e JPEG/PNG/WebP.
- O Storage continua em `site-images/platform/home/`; variantes escuras usam
  subdiretórios `dark/` e `dark/mobile/`. Caminhos internos nunca saem na API.

## Sequência para uma futura publicação autorizada

Este trabalho local não autoriza deploy, upload, alteração do banco remoto nem
publicação de banners.

1. Revisar o diff da branch e selecionar apenas este trabalho para a release.
   Conferir separadamente as outras mudanças que eventualmente estiverem na main.
2. Validar as migrations num banco descartável com a cadeia/baseline aprovada e
   executar `supabase/tests/home_publication_dark_images.test.sql` e
   `supabase/tests/home_publications_security.test.sql`.
3. Aplicar primeiro a migration
   `20261117174447_add_home_publication_dark_image_variants.sql`, seguindo o bloqueio
   e a reconciliação do ledger descritos em `supabase/README.md`. Não usar `db push`
   enquanto o bloqueio estiver ativo. Ela adiciona quatro colunas nullable, sem
   backfill, com `lock_timeout = 5s` e `statement_timeout = 30s`.
4. Publicar a API e só depois o frontend. A API antiga tolera as colunas novas;
   a API nova precisa delas até para listar banners existentes. Réplicas antigas
   e novas podem coexistir depois da migration. O frontend novo aceita respostas
   sem variantes dark; os endpoints dark só existem na API nova.
5. Conferir, com um banner de teste, as quatro combinações de tela e tema,
   incluindo troca de tema, fallback dos banners existentes, edição, remoção
   independente e repetição de upload interrompido. Conferir público e período.

O schema não cria tabela, política, grant, índice ou caminho novo de acesso direto
à Data API. A tabela continua exclusiva da API e com RLS habilitado.
Referência: [migrations do Supabase](https://supabase.com/docs/guides/deployment/database-migrations).

## Reversão

Reverter frontend e API às imagens anteriores, preservando as colunas nullable e
os arquivos novos. A API anterior ignora os campos dark e os banners continuam
com desktop/mobile existentes. Não apagar as colunas durante a troca de réplicas;
uma remoção futura exige migration separada e backup dos URLs e arquivos, pois
seria destrutiva. Se a API antiga excluir uma publicação com variantes dark,
ela não limpa esses objetos; registrar os caminhos antes de autorizar exclusões
nesse intervalo para uma eventual limpeza posterior.

## Escopo do legado

`apps/api/internal/admin/home_publications.go` já ultrapassava 800 linhas. O
crescimento desta mudança se limita aos campos, seleção, scan, projeção e coleta
dos caminhos das novas imagens, necessários para manter um único contrato.
Dividir DTOs, handlers e repositório em uma tarefa própria evita uma refatoração
incidental neste ajuste de banners.

`apps/api/internal/app/routes.go` também já excedia 800 linhas e recebe somente
quatro registros das operações dark. Uma futura separação do registro de rotas
por domínio deve preservar os mesmos middlewares. O contrato OpenAPI central
cresce apenas com essas operações e seus campos; sua divisão em referências por
domínio pertence a uma tarefa própria, com validação das ferramentas consumidoras.

`components/features/admin/HomePublicationsContent.tsx` também já excedia 800
linhas. O estado e a renderização das imagens passaram a usar as quatro variantes
sem duplicar as seções de público, período ou ordenação. Uma futura evolução pode
extrair somente o estado e as ações de imagens para um hook em `hooks/home/`.

## Verificação local desta preparação

- `npm run typecheck`: aprovado.
- `npm run lint`: aprovado, sem erros; oito avisos em arquivos preexistentes
  fora do diff (WhatsApp, scripts de fila e testes de catálogo de imóveis).
  Os arquivos dos avisos foram conferidos sem diferenças em relação ao HEAD.
- `npm run validation:test`: 905 testes aprovados, sem falhas ou pulos.
- `node --experimental-strip-types --import ./scripts/tests/typescript-alias-hooks.mjs --test lib/home/publication-draft.test.ts lib/validation/home.test.ts components/features/home/home-screen.runtime.test.mjs`:
  38 testes aprovados, incluindo o carregamento da Home com suas duas consultas.
- `node --test components/features/home/home-banner-variants.runtime.test.mjs`:
  7 testes Chromium aprovados com CSS e componentes reais; quatro combinações,
  tema do sistema, troca de tema, breakpoint 767/768 px, proporção e altura.
  Cada combinação inicial solicitou apenas sua imagem correspondente.
- `node --test components/features/admin/home-publications/publication-editor.runtime.test.mjs`:
  2 testes Chromium aprovados para os quatro campos, remover/restaurar/cancelar
  e repetir o último upload após falha, preservando metadados e uploads salvos.
  Esse harness de interação usa CSS mínimo para o diálogo, sem validar o layout
  completo do painel administrativo.
- `go test ./apps/api/internal/admin ./apps/api/internal/app -count=1`: aprovado;
  integrações preexistentes sem opt-in/ambiente local foram puladas e não
  demonstram integração com banco.
- `node --test packages/contracts/openapi/*.test.mjs`: 65 testes aprovados.
- `node scripts/supabase/verify-migrations.mjs`: 287 migrations verificadas;
  somente a nova migration foi adicionada ao lock, sem alterar as anteriores.
- `git diff --check`: aprovado.

Não foram executados build de produção, pgTAP, migrations em banco, upload real
ou validação em produção. As artes dos testes são sintéticas; o cadastro não cria
automaticamente as quatro artes de uma campanha. Screenshots locais de QA ficam
em `outputs/home-banner-variants/` (ignorado pelo Git).

A implementação ficou sem commit ou push na branch local
`codex/home-banner-four-variants-20261117`, worktree
`D:/Vimob/worktrees/home-banner-four-variants-20261117`, baseada no HEAD
`13187c03ea7665612ce85cc141af27aeb66b4ad6`. A branch main e as alterações
preexistentes do checkout original foram preservadas.

## Revisão Ponytail

O diff completo foi revisado no frontend e no backend. Não foi encontrado defeito
novo concreto nessa revisão. Foram mantidos os campos opcionais, o opt-in do
contrato público, os endpoints existentes, as validações e o fluxo de checkpoint
e repetição de uploads. Uma refatoração geral do editor ou das rotas aumentaria o
escopo sem ser necessária para as quatro artes.

O ajuste aplicado remove quatro hooks intermediários do tema escuro. Upload e
remoção agora expõem diretamente seus dois hooks, com `mobile = false` por padrão
e `true` nas chamadas da variante celular. O editor e seus mocks foram atualizados;
endpoints, mensagens, invalidação de cache e comportamento foram preservados.
Após o ajuste, os dois testes de interação do editor e `npm run typecheck`
passaram novamente. `npm run lint` terminou com zero erros e os mesmos oito
avisos preexistentes fora do diff. `git diff --check` também passou.
