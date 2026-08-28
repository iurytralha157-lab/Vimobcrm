import type { Metadata } from 'next'

import { PublicHelpArticleScreen } from '@/components/features/help'

export const metadata: Metadata = {
  title: 'Guia do Vimob | Central de Ajuda',
  description: 'Passo a passo de uso da plataforma Vimob.',
}

type PublicHelpArticlePageProps = {
  params: Promise<{ slug: string }>
}

export default async function PublicHelpArticlePage({
  params,
}: PublicHelpArticlePageProps) {
  const { slug } = await params
  return <PublicHelpArticleScreen slug={slug} />
}
