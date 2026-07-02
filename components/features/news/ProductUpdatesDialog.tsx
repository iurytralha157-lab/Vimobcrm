"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  CalendarDays,
  CheckCircle2,
  FileText,
  Gavel,
  LayoutDashboard,
  MessageSquare,
  PanelsTopLeft,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type UpdateCategory = "legal" | "improvement" | "stability";

type ProductUpdate = {
  id: string;
  title: string;
  subtitle: string;
  category: UpdateCategory;
  version: string;
  publishedAt: string;
  icon: typeof Sparkles;
  summary: string;
  details: string[];
  href?: string;
};

type ProductUpdatesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const STORAGE_KEY = "vimob_archived_product_updates";

const CATEGORY_LABELS: Record<UpdateCategory, string> = {
  legal: "Legal",
  improvement: "Melhoria",
  stability: "Estabilidade",
};

const CATEGORY_CLASSES: Record<UpdateCategory, string> = {
  legal: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  improvement: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  stability: "bg-sky-500/12 text-sky-700 dark:text-sky-300",
};

const PRODUCT_UPDATES: ProductUpdate[] = [
  {
    id: "privacy-policy-2026-06",
    title: "Política de Privacidade",
    subtitle: "Documento legal atualizado",
    category: "legal",
    version: "v1.0",
    publishedAt: "19/06/2026",
    icon: ShieldCheck,
    summary: "Publicamos a política de privacidade do Vimob com as regras de tratamento de dados e LGPD.",
    details: [
      "Explicamos quais dados podem ser tratados pela plataforma.",
      "Detalhamos finalidades de uso, integrações autorizadas e suporte técnico.",
      "O documento fica disponível para consulta pública quando houver nova publicação.",
    ],
    href: "/politica-de-privacidade",
  },
  {
    id: "terms-of-use-2026-06",
    title: "Termos de Uso",
    subtitle: "Regras de uso da plataforma",
    category: "legal",
    version: "v1.0",
    publishedAt: "19/06/2026",
    icon: Gavel,
    summary: "Os termos de uso foram publicados para deixar claro o escopo de uso, responsabilidades e condições da plataforma.",
    details: [
      "Incluímos licenciamento, responsabilidades do usuário e uso correto dos módulos.",
      "Também adicionamos regras de disponibilidade, terceiros e alterações futuras.",
      "Sempre que houver nova versão, ela poderá aparecer nesta área de novidades.",
    ],
    href: "/termos-de-uso",
  },
  {
    id: "stability-conversations-2026-07",
    title: "Estabilização do sistema",
    subtitle: "Conversas, notificações e integrações",
    category: "stability",
    version: "v2.2.1",
    publishedAt: "02/07/2026",
    icon: MessageSquare,
    summary: "Melhoramos a estabilidade operacional para deixar o atendimento mais previsível no uso diário.",
    details: [
      "Ajustes de estabilidade nas conversas e no monitoramento de sessões WhatsApp.",
      "Notificações passam a nascer pelo backend, reduzindo fluxos paralelos no frontend.",
      "A integração Meta segue mais alinhada com o backend e com os registros do banco.",
    ],
  },
  {
    id: "dashboard-won-lost-popovers-2026-07",
    title: "Dashboard mais detalhado",
    subtitle: "Ganho, perdido e leitura rápida",
    category: "improvement",
    version: "v2.2.1",
    publishedAt: "02/07/2026",
    icon: LayoutDashboard,
    summary: "O dashboard ganhou detalhes rápidos para entender melhor leads ganhos e perdidos.",
    details: [
      "Novos pop-ups ajudam a investigar oportunidades ganhas e perdidas.",
      "A visualização ficou mais direta para leitura de performance comercial.",
      "A tela mantém o foco em indicadores que ajudam o time a agir rápido.",
    ],
  },
  {
    id: "pipeline-lead-card-2026-07",
    title: "Nova pipeline e card do lead",
    subtitle: "Mais contexto no CRM",
    category: "improvement",
    version: "v2.2.1",
    publishedAt: "02/07/2026",
    icon: PanelsTopLeft,
    summary: "A pipeline e o card do lead foram refinados para organizar melhor a rotina do time comercial.",
    details: [
      "Cards com mais contexto para tomada de decisão sem abrir várias telas.",
      "A pipeline fica mais clara para acompanhar etapa, status e responsável.",
      "A experiência foi ajustada para reduzir atrito no acompanhamento diário.",
    ],
  },
  {
    id: "lead-distribution-backend-2026-07",
    title: "Distribuição e entrada de leads",
    subtitle: "Mais controle no backend",
    category: "stability",
    version: "v2.2.1",
    publishedAt: "02/07/2026",
    icon: CheckCircle2,
    summary: "Avançamos na centralização dos fluxos de leads para deixar a operação mais consistente.",
    details: [
      "Novos leads e reentradas passam por regras mais firmes no backend.",
      "O histórico e as notificações ficam mais próximos da origem real do evento.",
      "A base está preparada para testes de entrada de leads com mais rastreabilidade.",
    ],
  },
];

export function ProductUpdatesDialog({ open, onOpenChange }: ProductUpdatesDialogProps) {
  const [archivedIds, setArchivedIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"news" | "archived">("news");
  const [selectedId, setSelectedId] = useState(PRODUCT_UPDATES[0]?.id || "");

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (cancelled) return;

      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            setArchivedIds(parsed.filter((item) => typeof item === "string"));
          }
        }
      } catch {
        setArchivedIds([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [open]);

  const archivedSet = useMemo(() => new Set(archivedIds), [archivedIds]);
  const news = useMemo(() => PRODUCT_UPDATES.filter((item) => !archivedSet.has(item.id)), [archivedSet]);
  const archived = useMemo(() => PRODUCT_UPDATES.filter((item) => archivedSet.has(item.id)), [archivedSet]);
  const visibleItems = activeTab === "archived" ? archived : news;
  const selected = visibleItems.find((item) => item.id === selectedId) || visibleItems[0] || PRODUCT_UPDATES[0];

  useEffect(() => {
    if (!open) return;
    const items = activeTab === "archived" ? archived : news;
    if (items.some((item) => item.id === selectedId)) return;

    const nextSelectedId = items[0]?.id || PRODUCT_UPDATES[0]?.id || "";
    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) setSelectedId(nextSelectedId);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, archived, news, open, selectedId]);

  const persistArchived = (ids: string[]) => {
    setArchivedIds(ids);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  };

  const archiveSelected = () => {
    if (!selected) return;
    if (archivedSet.has(selected.id)) {
      persistArchived(archivedIds.filter((id) => id !== selected.id));
      setActiveTab("news");
      return;
    }
    persistArchived([...archivedIds, selected.id]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[min(760px,calc(100dvh-32px))] max-w-[960px] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:rounded-[14px]">
        <DialogHeader className="border-b border-[var(--app-border)] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-[#FF4529]" />
            Novidades
          </DialogTitle>
          <DialogDescription className="sr-only">
            Atualizações recentes, documentos legais e melhorias do Vimob CRM.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "news" | "archived")} className="flex min-h-0 flex-1 flex-col">
          <div className="border-b border-[var(--app-border)] px-5">
            <TabsList className="h-12 rounded-none bg-transparent p-0">
              <TabsTrigger
                value="news"
                className="h-12 rounded-none border-b-2 border-transparent bg-transparent px-1 text-sm font-medium shadow-none data-[state=active]:border-[#FF4529] data-[state=active]:bg-transparent data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none"
              >
                Novidades
                <span className="ml-2 rounded-full bg-[var(--app-surface-soft)] px-2 py-0.5 text-xs text-[var(--app-text-secondary)]">
                  {news.length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="archived"
                className="ml-6 h-12 rounded-none border-b-2 border-transparent bg-transparent px-1 text-sm font-medium shadow-none data-[state=active]:border-[#FF4529] data-[state=active]:bg-transparent data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none"
              >
                Arquivado
                <span className="ml-2 rounded-full bg-[var(--app-surface-soft)] px-2 py-0.5 text-xs text-[var(--app-text-secondary)]">
                  {archived.length}
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="news" className="m-0 min-h-0 flex-1">
            <UpdatesPanel items={news} selected={selected} onSelect={setSelectedId} onArchive={archiveSelected} archived={false} />
          </TabsContent>
          <TabsContent value="archived" className="m-0 min-h-0 flex-1">
            <UpdatesPanel items={archived} selected={selected} onSelect={setSelectedId} onArchive={archiveSelected} archived />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function UpdatesPanel({
  archived,
  items,
  onArchive,
  onSelect,
  selected,
}: {
  archived: boolean;
  items: ProductUpdate[];
  selected: ProductUpdate | undefined;
  onArchive: () => void;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm space-y-2">
          <Archive className="mx-auto h-8 w-8 text-[var(--app-text-tertiary)]" />
          <h3 className="text-sm font-semibold">{archived ? "Nada arquivado" : "Tudo arquivado"}</h3>
          <p className="text-sm text-muted-foreground">
            {archived ? "Quando você arquivar uma novidade, ela aparece aqui." : "Você pode restaurar itens pela aba Arquivado."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[220px_minmax(0,1fr)] md:grid-rows-none md:grid-cols-[320px_1fr]">
      <aside className="min-h-0 border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] md:border-b-0 md:border-r">
        <div className="h-full overflow-y-auto p-3">
          <div className="space-y-2">
            {items.map((item) => (
              <UpdateListItem
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                onSelect={() => onSelect(item.id)}
              />
            ))}
          </div>
        </div>
      </aside>

      <section className="min-h-0 overflow-y-auto">
        {selected ? (
          <UpdateDetail archived={archived} item={selected} onArchive={onArchive} />
        ) : null}
      </section>
    </div>
  );
}

function UpdateListItem({ item, onSelect, selected }: { item: ProductUpdate; onSelect: () => void; selected: boolean }) {
  const Icon = item.icon;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full gap-3 rounded-[8px] border border-transparent p-3 text-left transition-colors",
        selected
          ? "border-[#FF4529]/35 bg-[var(--app-surface-solid)]"
          : "hover:bg-[var(--app-surface-hover)]",
      )}
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-[#FF4529]/12 text-[#FF4529]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-[var(--app-text-primary)]">{item.title}</span>
        <span className="mt-0.5 block truncate text-xs text-[var(--app-text-secondary)]">{item.subtitle}</span>
        <span className="mt-2 flex items-center justify-between gap-2">
          <Badge className={cn("border-0 px-2 py-0 text-[10px]", CATEGORY_CLASSES[item.category])}>
            {CATEGORY_LABELS[item.category]}
          </Badge>
          <span className="truncate text-[10px] text-[var(--app-text-tertiary)]">{item.version}</span>
        </span>
      </span>
    </button>
  );
}

function UpdateDetail({ archived, item, onArchive }: { archived: boolean; item: ProductUpdate; onArchive: () => void }) {
  const Icon = item.icon;

  return (
    <article className="space-y-6 p-5 md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="mb-3 flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-[#FF4529]/12 text-[#FF4529]">
              <Icon className="h-4 w-4" />
            </span>
            <Badge className={cn("border-0", CATEGORY_CLASSES[item.category])}>{CATEGORY_LABELS[item.category]}</Badge>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-[var(--app-text-primary)]">{item.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[var(--app-text-secondary)]">
            <span>{item.version}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--app-text-tertiary)]" />
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" />
              Publicado em {item.publishedAt}
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)]"
          onClick={onArchive}
        >
          {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {archived ? "Restaurar" : "Arquivar"}
        </Button>
      </div>

      <p className="text-sm leading-7 text-[var(--app-text-secondary)]">{item.summary}</p>

      <div className="space-y-3">
        {item.details.map((detail) => (
          <div key={detail} className="flex gap-3 text-sm leading-6 text-[var(--app-text-secondary)]">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
            <span>{detail}</span>
          </div>
        ))}
      </div>

      {item.href ? (
        <Button asChild className="h-10 rounded-[8px] bg-[#FF4529] text-white hover:bg-[#FF4529]/90">
          <a href={item.href} target="_blank" rel="noreferrer">
            <FileText className="h-4 w-4" />
            Ver documento
          </a>
        </Button>
      ) : null}
    </article>
  );
}
