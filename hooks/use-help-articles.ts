import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { adminAPI } from '@/lib/api/admin';

export interface HelpArticle {
  id: string;
  category: string;
  title: string;
  content: string;
  video_url: string | null;
  image_url: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export function useHelpArticles() {
  const queryClient = useQueryClient();

  const { data: articles = [], isLoading } = useQuery({
    queryKey: ['help-articles'],
    queryFn: async () => {
      const items = await adminAPI.listTableRows('help_articles', 200) as unknown as HelpArticle[];
      return items.sort((a, b) => a.category.localeCompare(b.category) || a.display_order - b.display_order);
    },
  });

  const activeArticles = articles.filter((article) => article.is_active);

  const createArticle = useMutation({
    mutationFn: (article: Omit<HelpArticle, 'id' | 'created_at' | 'updated_at'>) =>
      adminAPI.createTableRow<HelpArticle>('help_articles', article),
    onSuccess: () => {
      toast.success('Artigo criado com sucesso!');
      queryClient.invalidateQueries({ queryKey: ['help-articles'] });
    },
    onError: (error) => {
      toast.error('Erro ao criar artigo: ' + error.message);
    },
  });

  const updateArticle = useMutation({
    mutationFn: ({ id, ...updates }: Partial<HelpArticle> & { id: string }) =>
      adminAPI.updateTableRow<HelpArticle>('help_articles', id, updates),
    onSuccess: () => {
      toast.success('Artigo atualizado!');
      queryClient.invalidateQueries({ queryKey: ['help-articles'] });
    },
    onError: (error) => {
      toast.error('Erro ao atualizar artigo: ' + error.message);
    },
  });

  const deleteArticle = useMutation({
    mutationFn: (id: string) => adminAPI.deleteTableRow('help_articles', id),
    onSuccess: () => {
      toast.success('Artigo excluído!');
      queryClient.invalidateQueries({ queryKey: ['help-articles'] });
    },
    onError: (error) => {
      toast.error('Erro ao excluir artigo: ' + error.message);
    },
  });

  const articlesByCategory = articles.reduce((acc, article) => {
    if (!acc[article.category]) {
      acc[article.category] = [];
    }
    acc[article.category].push(article);
    return acc;
  }, {} as Record<string, HelpArticle[]>);

  return {
    articles,
    activeArticles,
    articlesByCategory,
    isLoading,
    createArticle,
    updateArticle,
    deleteArticle,
  };
}
