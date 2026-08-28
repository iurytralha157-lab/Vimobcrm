# Central de Ajuda

O domínio `help` entrega documentação operacional determinística, sem geração por
IA. A mesma base alimenta:

- `/help` e `/help/[slug]`, públicas;
- `/suporte` e `/suporte/[slug]`, dentro do CRM;
- a busca da página `/inicio`;
- o editor do superadministrador em `/admin/help`.

## Dados e segurança

Os artigos ficam em `public.help_articles`. A API Go expõe catálogos e detalhes
separados por audiência:

- `/v1/public/help/*` aceita somente itens `public` ou `all`;
- `/v1/help/*` exige autenticação e aceita itens `authenticated` ou `all`;
- apenas artigos ativos entram em listagem, detalhe e busca.

Conteúdo textual é normalizado no backend. Links de ação devem apontar para rotas
internas e mídias devem usar `/help/` ou `/images/help/`. O frontend revalida o
contrato com Zod.

## Continuidade de leitura

O backend continua sendo a fonte principal. Para que uma versão antiga da API,
uma indisponibilidade temporária ou um rollout ainda incompleto não derrube toda
a Central, o frontend mantém dois snapshots validados e separados:

- `lib/help/help-content.public.snapshot.json` contem somente `public` e `all`
  e pode entrar no bundle cliente;
- `lib/help/help-content.authenticated.snapshot.json` contem somente
  `authenticated` e `all`, fica em modulo `server-only` e so e entregue por
  uma rota Next que valida a sessao Supabase.

O fallback só é usado para rota ausente, API indisponível ou erro de servidor.
Erros de autenticação e um `help_article_not_found` real não são mascarados. O
snapshot preserva a audiência: a página pública recebe apenas itens `public` ou
`all`; a area autenticada recebe apenas itens `authenticated` ou `all`.

Depois de revisar os artigos no banco de desenvolvimento, regenere o arquivo com:

```powershell
$env:HELP_SNAPSHOT_DATABASE_URL='postgresql://...'
node scripts/generate-help-content-snapshot.mjs
```

## Artigos visuais

Cada artigo pode ter resumo, conteúdo introdutório, passos, links diretos,
relacionados, tempo de leitura e data de revisão. Passos aceitam screenshots
locais com marcadores percentuais, legenda e texto alternativo. Isso mantém os
marcadores responsivos no desktop e no celular.

O editor permite rascunho/ativação, audiência, ordenação dos passos e prévia.
Comentários de clientes não fazem parte deste domínio.
