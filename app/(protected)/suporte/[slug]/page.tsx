import { HelpArticleScreen } from '@/components/features/help'

type SupportArticlePageProps = {
  params: Promise<{ slug: string }>
}

export default async function SupportArticlePage({
  params,
}: SupportArticlePageProps) {
  const { slug } = await params
  return <HelpArticleScreen slug={slug} />
}
