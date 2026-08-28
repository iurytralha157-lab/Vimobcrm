import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import pg from 'pg'

const { Client } = pg
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicOutputPath = resolve(
  repositoryRoot,
  'lib/help/help-content.public.snapshot.json',
)
const authenticatedOutputPath = resolve(
  repositoryRoot,
  'lib/help/help-content.authenticated.snapshot.json',
)
const databaseUrl = process.env.HELP_SNAPSHOT_DATABASE_URL

if (!databaseUrl) {
  throw new Error(
    'Defina HELP_SNAPSHOT_DATABASE_URL com uma conexão de desenvolvimento antes de gerar o snapshot.',
  )
}

const client = new Client({ connectionString: databaseUrl })

try {
  await client.connect()
  const { rows } = await client.query(`
    select
      id::text as "id",
      slug,
      category,
      module_key as "moduleKey",
      title,
      summary,
      route_href as "routeHref",
      action_label as "actionLabel",
      estimated_minutes as "estimatedMinutes",
      display_order as "displayOrder",
      updated_at as "updatedAt",
      content,
      search_keywords as "searchKeywords",
      steps,
      related_slugs as "relatedSlugs",
      image_url as "imageUrl",
      video_url as "videoUrl",
      last_reviewed_at as "lastReviewedAt",
      visibility
    from public.help_articles
    where is_active = true
    order by category, display_order, title, id
  `)

  const articles = rows.map((article) => ({
    ...article,
    updatedAt: article.updatedAt.toISOString(),
    lastReviewedAt: article.lastReviewedAt?.toISOString() ?? null,
  }))
  const publicArticles = articles.filter((article) => (
    article.visibility === 'public' || article.visibility === 'all'
  ))
  const authenticatedArticles = articles.filter((article) => (
    article.visibility === 'authenticated' || article.visibility === 'all'
  ))
  const publicSlugs = new Set(publicArticles.map((article) => article.slug))
  const authenticatedSlugs = new Set(
    authenticatedArticles.map((article) => article.slug),
  )
  const sanitizeRelationships = (article, visibleSlugs) => ({
    ...article,
    relatedSlugs: article.relatedSlugs.filter((slug) => visibleSlugs.has(slug)),
  })
  const publicSnapshot = publicArticles.map((article) => (
    sanitizeRelationships(article, publicSlugs)
  ))
  const authenticatedSnapshot = authenticatedArticles.map((article) => (
    sanitizeRelationships(article, authenticatedSlugs)
  ))

  await mkdir(dirname(publicOutputPath), { recursive: true })
  await Promise.all([
    writeFile(
      publicOutputPath,
      `${JSON.stringify(publicSnapshot, null, 2)}\n`,
      'utf8',
    ),
    writeFile(
      authenticatedOutputPath,
      `${JSON.stringify(authenticatedSnapshot, null, 2)}\n`,
      'utf8',
    ),
  ])
  process.stdout.write(
    [
      'Snapshots da Central de Ajuda gerados:',
      `${publicArticles.length} publicos e`,
      `${authenticatedArticles.length} autenticados.\n`,
    ].join(' '),
  )
} finally {
  await client.end()
}
