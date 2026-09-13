'use client';

import { BookOpenText, Eye, Loader2, Plus } from 'lucide-react';

import { HELP_MODULES } from '@/components/features/help/help-modules';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { HelpArticle, HelpArticleStep } from '@/hooks/use-help-articles';
import { cn } from '@/lib/utils';

import { HelpArticlePreview } from './HelpArticlePreview';
import { HelpArticleStepEditor } from './HelpArticleStepEditor';
import {
  createEmptyStep,
  formToHelpArticleInput,
  VISIBILITY_OPTIONS,
  type HelpArticleForm,
} from './model';

type HelpArticleEditorDialogProps = {
  open: boolean;
  editingArticle: HelpArticle | null;
  form: HelpArticleForm;
  formError: string | null;
  isSaving: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  onTitleChange: (title: string) => void;
  onSlugChange: (slug: string) => void;
  onFormChange: <Key extends keyof HelpArticleForm>(
    key: Key,
    value: HelpArticleForm[Key],
  ) => void;
  onStepChange: (index: number, step: HelpArticleStep) => void;
  onStepMove: (index: number, direction: -1 | 1) => void;
  onStepDuplicate: (index: number) => void;
};

export function HelpArticleEditorDialog({
  open,
  editingArticle,
  form,
  formError,
  isSaving,
  onOpenChange,
  onSubmit,
  onTitleChange,
  onSlugChange,
  onFormChange,
  onStepChange,
  onStepMove,
  onStepDuplicate,
}: HelpArticleEditorDialogProps) {
  const livePreview = formToHelpArticleInput(form);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[94dvh] w-[calc(100vw-1rem)] max-w-[1240px] overflow-hidden rounded-[8px] p-0 shadow-none sm:w-[calc(100vw-2rem)] sm:max-w-[1240px]"
        aria-busy={isSaving}
      >
        <DialogHeader className="px-4 pb-3 pt-4 sm:px-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpenText className="h-4 w-4 text-primary" />
            {editingArticle ? 'Editar artigo' : 'Novo artigo'}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Configure o conteúdo, a audiência, os passos, os links e o estado de publicação do artigo.
          </DialogDescription>
        </DialogHeader>

        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <fieldset className="contents" disabled={isSaving}>
            <ScrollArea className="max-h-[calc(94dvh-132px)]">
              <div className="grid gap-4 px-4 pb-5 sm:px-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
                <div className="space-y-4">
                  <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Título</span>
                        <Input
                          value={form.title}
                          onChange={(event) => onTitleChange(event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                          placeholder="Como criar uma automação?"
                          required
                          minLength={4}
                          maxLength={180}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Slug</span>
                        <Input
                          value={form.slug}
                          onChange={(event) => onSlugChange(event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)] font-mono text-xs"
                          placeholder="como-criar-uma-automacao"
                          required
                          maxLength={180}
                          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                        />
                      </label>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Categoria</span>
                        <Input
                          value={form.category}
                          onChange={(event) => onFormChange('category', event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                          placeholder="Automações"
                          required
                          minLength={2}
                          maxLength={80}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Módulo relacionado</span>
                        <select
                          value={form.moduleKey}
                          onChange={(event) => onFormChange('moduleKey', event.target.value)}
                          className="h-10 w-full rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-3 text-sm outline-none focus:ring-2 focus:ring-primary/35"
                        >
                          {HELP_MODULES.map((module) => (
                            <option key={module.key} value={module.key}>
                              {module.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <label className="mt-3 block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Resumo para busca</span>
                      <Textarea
                        value={form.summary}
                        onChange={(event) => onFormChange('summary', event.target.value)}
                        className="min-h-20 resize-y border-0 bg-[var(--app-surface-solid)]"
                        placeholder="Explique em uma frase o que a pessoa aprenderá neste artigo."
                        required
                        maxLength={320}
                      />
                    </label>

                    <label className="mt-3 block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Introdução do artigo</span>
                      <Textarea
                        value={form.content}
                        onChange={(event) => onFormChange('content', event.target.value)}
                        className="min-h-32 resize-y border-0 bg-[var(--app-surface-solid)]"
                        placeholder="Contextualize o recurso, quando usar e o resultado esperado."
                        required
                        maxLength={20000}
                      />
                    </label>

                    <label className="mt-3 block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Palavras-chave</span>
                      <Input
                        value={form.searchKeywords}
                        onChange={(event) => onFormChange('searchKeywords', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        placeholder="automação, fluxo, gatilho, condição"
                      />
                      <span className="block text-[11px] text-muted-foreground">
                        Separe termos e sinônimos por vírgula.
                      </span>
                    </label>

                    <div className="mt-3 space-y-2">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">Quem pode acessar</p>
                        <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">
                          A audiência define em qual Central de Ajuda este artigo será publicado.
                        </p>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {VISIBILITY_OPTIONS.map((option) => {
                          const selected = form.visibility === option.value;
                          return (
                            <button
                              key={option.value}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => onFormChange('visibility', option.value)}
                              className={cn(
                                'rounded-[8px] p-3 text-left transition-colors',
                                selected
                                  ? 'bg-primary text-primary-foreground'
                                  : 'bg-[var(--app-surface-solid)] hover:bg-[var(--app-surface-hover)]',
                              )}
                            >
                              <span className="block text-xs font-medium">{option.label}</span>
                              <span className={cn(
                                'mt-1 block text-[11px] leading-4',
                                selected
                                  ? 'text-primary-foreground/80'
                                  : 'text-muted-foreground',
                              )}>
                                {option.description}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </section>

                  <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium">Passo a passo</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Cada passo pode ter print, marcador e link direto para o CRM.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="shrink-0 bg-[var(--app-surface-solid)]"
                        onClick={() => onFormChange('steps', [...form.steps, createEmptyStep()])}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Passo
                      </Button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {form.steps.length === 0 ? (
                        <button
                          type="button"
                          onClick={() => onFormChange('steps', [createEmptyStep()])}
                          className="flex min-h-24 w-full flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-4 text-center transition-colors hover:bg-[var(--app-surface-hover)]"
                        >
                          <Plus className="h-5 w-5 text-primary" />
                          <span className="mt-2 text-sm font-medium">Adicionar o primeiro passo</span>
                          <span className="mt-1 text-xs text-muted-foreground">
                            Use passos para explicar ações com clareza e incluir prints.
                          </span>
                        </button>
                      ) : (
                        form.steps.map((step, index) => (
                          <HelpArticleStepEditor
                            key={step.id}
                            step={step}
                            index={index}
                            total={form.steps.length}
                            onChange={(updatedStep) => onStepChange(index, updatedStep)}
                            onMove={(direction) => onStepMove(index, direction)}
                            onDuplicate={() => onStepDuplicate(index)}
                            onRemove={() => onFormChange(
                              'steps',
                              form.steps.filter((_, itemIndex) => itemIndex !== index),
                            )}
                          />
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
                    <h3 className="text-sm font-medium">Links e mídia</h3>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Botão principal</span>
                        <Input
                          value={form.actionLabel}
                          onChange={(event) => onFormChange('actionLabel', event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                          placeholder="Abrir Automações"
                          maxLength={80}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Destino principal</span>
                        <Input
                          value={form.routeHref}
                          onChange={(event) => onFormChange('routeHref', event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                          placeholder="/automations"
                          maxLength={240}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Imagem de capa</span>
                        <Input
                          value={form.imageUrl}
                          onChange={(event) => onFormChange('imageUrl', event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                          placeholder="/help/capas/exemplo.webp"
                          maxLength={500}
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Vídeo complementar</span>
                        <Input
                          value={form.videoUrl}
                          onChange={(event) => onFormChange('videoUrl', event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                          placeholder="/help/videos/exemplo.mp4"
                          maxLength={500}
                        />
                      </label>
                    </div>
                    <label className="mt-3 block space-y-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Artigos relacionados</span>
                      <Input
                        value={form.relatedSlugs}
                        onChange={(event) => onFormChange('relatedSlugs', event.target.value)}
                        className="border-0 bg-[var(--app-surface-solid)]"
                        placeholder="como-conectar-whatsapp, como-criar-um-lead"
                      />
                      <span className="block text-[11px] text-muted-foreground">
                        Informe os slugs separados por vírgula.
                      </span>
                    </label>
                  </section>

                  <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Tempo de leitura</span>
                        <Input
                          type="number"
                          min={1}
                          max={60}
                          step={1}
                          value={form.estimatedMinutes}
                          onChange={(event) => onFormChange('estimatedMinutes', event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                          required
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Ordem</span>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={form.displayOrder}
                          onChange={(event) => onFormChange('displayOrder', event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                          required
                        />
                      </label>
                      <label className="space-y-1.5">
                        <span className="text-xs font-medium text-muted-foreground">Última revisão</span>
                        <Input
                          type="date"
                          value={form.lastReviewedAt}
                          onChange={(event) => onFormChange('lastReviewedAt', event.target.value)}
                          className="border-0 bg-[var(--app-surface-solid)]"
                        />
                      </label>
                    </div>
                    <label className="mt-3 flex items-center justify-between gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3">
                      <span>
                        <span className="block text-sm font-medium">Publicar artigo</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Desative para manter como rascunho.
                        </span>
                      </span>
                      <Switch
                        checked={form.isActive}
                        onCheckedChange={(checked) => onFormChange('isActive', checked)}
                        aria-label="Publicar artigo"
                      />
                    </label>
                  </section>
                </div>

                <aside className="xl:sticky xl:top-0 xl:self-start">
                  <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4 text-primary" />
                        <h3 className="text-sm font-medium">Prévia do artigo</h3>
                      </div>
                      <Badge className={cn(
                        'rounded-[4px] border-0',
                        form.isActive
                          ? 'bg-success/10 text-success'
                          : 'bg-[var(--app-surface-solid)] text-muted-foreground',
                      )}>
                        {form.isActive ? 'Publicado' : 'Rascunho'}
                      </Badge>
                    </div>
                    <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4">
                      <HelpArticlePreview article={livePreview} />
                    </div>
                  </div>
                </aside>
              </div>
            </ScrollArea>
          </fieldset>

          {formError ? (
            <div
              className="mx-4 mb-3 rounded-[8px] bg-destructive/10 px-3 py-2 text-sm text-destructive sm:mx-5"
              role="alert"
            >
              {formError}
            </div>
          ) : null}

          <DialogFooter className="bg-[var(--app-surface-solid)] px-4 py-3 sm:px-5">
            <Button
              type="button"
              variant="ghost"
              className="bg-[var(--app-surface-soft)]"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={isSaving}
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {editingArticle ? 'Salvar alterações' : 'Criar artigo'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
