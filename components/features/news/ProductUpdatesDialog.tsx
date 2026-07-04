"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  FileText,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type UpdateCategory = "legal" | "improvement" | "stability";

type ProductUpdate = {
  id: string;
  title: string;
  subtitle: string;
  preview: string;
  category: UpdateCategory;
  version: string;
  publishedAt: string;
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
  legal: "bg-amber-500 text-white",
  improvement: "bg-emerald-500 text-white",
  stability: "bg-sky-500 text-white",
};

const PRODUCT_UPDATES: ProductUpdate[] = [
  {
    id: "privacy-policy-2026-06",
    title: "Política de Privacidade",
    subtitle: "Nova publicação disponível",
    preview: "Consulta rápida sobre LGPD, dados tratados, segurança e direitos dos usuários.",
    category: "legal",
    version: "v1.0",
    publishedAt: "19/06/2026",
    summary: "Publicamos a Política de Privacidade do Vimob CRM para deixar mais claro como dados de clientes, leads, usuários e integrações são tratados na plataforma.",
    details: [
      "O documento explica quais informações podem ser usadas para operação do CRM, suporte, segurança e funcionamento das integrações.",
      "Também descreve direitos relacionados a acesso, correção e exclusão de dados pessoais.",
      "Sempre que houver uma nova publicação, ela poderá aparecer nesta área para consulta do time.",
    ],
    href: "/politica-de-privacidade",
  },
  {
    id: "terms-of-use-2026-06",
    title: "Termos de Uso",
    subtitle: "Regras e responsabilidades",
    preview: "Condições de uso, responsabilidades da conta e regras de funcionamento do Vimob CRM.",
    category: "legal",
    version: "v1.0",
    publishedAt: "19/06/2026",
    summary: "Os Termos de Uso foram publicados para organizar as condições de uso do Vimob CRM, os limites da plataforma e as responsabilidades de cada usuário.",
    details: [
      "A publicação cobre uso correto dos módulos, credenciais, integrações e informações cadastradas no sistema.",
      "Também detalha regras de disponibilidade, serviços de terceiros e atualizações futuras.",
      "O objetivo é manter uma referência simples para administradores e equipes consultarem quando necessário.",
    ],
    href: "/termos-de-uso",
  },
  {
    id: "stability-conversations-2026-07",
    title: "Estabilidade do sistema",
    subtitle: "Carregamento, conversas e notificações",
    preview: "Melhorias para reduzir travamentos, lentidão e telas sem informação durante o uso.",
    category: "stability",
    version: "v2.2.1",
    publishedAt: "02/07/2026",
    summary: "Fizemos uma rodada de estabilização para deixar o uso diário mais previsível, principalmente em telas com muitos leads, conversas e atualizações em tempo real.",
    details: [
      "As telas de atendimento e CRM receberam ajustes para carregar melhor e evitar a sensação de página travada.",
      "As notificações ficaram mais consistentes para avisar eventos importantes, como novos leads, ganhos, perdas e interações.",
      "Também melhoramos a forma como o sistema se recupera quando uma requisição demora mais do que o esperado.",
    ],
  },
  {
    id: "dashboard-won-lost-popovers-2026-07",
    title: "Dashboard mais detalhado",
    subtitle: "Ganhos, perdidos e leitura rápida",
    preview: "Indicadores com mais contexto para entender resultados sem sair do painel.",
    category: "improvement",
    version: "v2.2.1",
    publishedAt: "02/07/2026",
    summary: "O dashboard ganhou detalhes rápidos para ajudar gestores e corretores a entenderem melhor os resultados sem precisar abrir várias telas.",
    details: [
      "Os indicadores de ganhos e perdas agora podem trazer uma leitura mais clara do que aconteceu no período.",
      "A visualização foi ajustada para facilitar a leitura de performance comercial e gargalos do atendimento.",
      "A ideia é permitir uma decisão mais rápida sobre acompanhamento, retomada e prioridades do time.",
    ],
  },
  {
    id: "pipeline-lead-card-2026-07",
    title: "Nova pipeline e card do lead",
    subtitle: "Atendimento e histórico juntos",
    preview: "Card do lead com dados, histórico, mensagens e contexto comercial na mesma tela.",
    category: "improvement",
    version: "v2.2.1",
    publishedAt: "02/07/2026",
    summary: "A pipeline e o card do lead foram redesenhados para concentrar as informações mais importantes do atendimento em uma experiência mais direta.",
    details: [
      "Agora o card do lead reúne dados do contato, etapa, responsável, feedbacks, documentos e histórico em um único fluxo.",
      "O histórico do lead passa a conviver com registros de mensagens e mudanças importantes, reduzindo a necessidade de trocar de tela.",
      "Também adicionamos mais contexto para leads vindos do Meta, incluindo perguntas de formulário e criativos quando disponíveis.",
    ],
  },
  {
    id: "lead-distribution-backend-2026-07",
    title: "Entrada e distribuição de leads",
    subtitle: "Mais consistência no atendimento",
    preview: "Fluxos de chegada, redistribuição e registro de leads mais organizados.",
    category: "stability",
    version: "v2.2.1",
    publishedAt: "02/07/2026",
    summary: "A entrada e a distribuição de leads receberam ajustes para tornar a operação mais confiável, principalmente em equipes com várias origens de atendimento.",
    details: [
      "Leads novos ficam mais preparados para aparecer rapidamente nas telas certas do CRM.",
      "A distribuição foi refinada para dar mais clareza sobre origem, responsável e próximo passo.",
      "O histórico também passa a registrar melhor eventos importantes para ajudar na auditoria do atendimento.",
    ],
  },
  {
    id: "meta-creative-history-2026-07",
    title: "Meta com criativos no histórico",
    subtitle: "Campanhas, formulários e contexto",
    preview: "Leads de formulário podem trazer perguntas, respostas e criativo do anúncio no histórico.",
    category: "improvement",
    version: "v2.2.1",
    publishedAt: "03/07/2026",
    summary: "A integração com Meta foi aprimorada para trazer mais contexto comercial sobre os leads recebidos por campanhas.",
    details: [
      "Quando a informação estiver disponível, o histórico do lead pode exibir perguntas e respostas enviadas no formulário.",
      "Também passamos a preparar o card para mostrar o criativo do anúncio, como imagem, vídeo ou link do material.",
      "Isso ajuda o time a entender melhor o interesse do lead antes de iniciar ou continuar o atendimento.",
    ],
  },
  {
    id: "google-agenda-hub-2026-07",
    title: "Agenda integrada ao Google",
    subtitle: "Compromissos conectados ao Hub",
    preview: "Reuniões, visitas e compromissos com integração mais clara entre Vimob e Google Agenda.",
    category: "improvement",
    version: "v2.2.1",
    publishedAt: "03/07/2026",
    summary: "A agenda foi ajustada para funcionar de forma mais integrada ao Hub e ao Google Agenda, facilitando a rotina de visitas e compromissos.",
    details: [
      "Compromissos podem ser organizados no Vimob com mais contexto sobre lead, corretor e horário.",
      "A integração com Google Agenda ajuda a manter a rotina sincronizada quando a conta está conectada.",
      "O objetivo é reduzir esquecimentos e deixar o acompanhamento comercial mais previsível para a equipe.",
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
      <DialogContent className="grid h-[min(640px,calc(100dvh-32px))] w-[min(840px,calc(100vw-32px))] max-w-none grid-rows-[minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:rounded-[14px] [&>button]:top-4">
        <DialogTitle className="sr-only">Novidades</DialogTitle>
        <DialogDescription className="sr-only">
          Atualizações recentes, documentos legais e melhorias do Vimob CRM.
        </DialogDescription>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "news" | "archived")} className="flex h-full min-h-0 flex-col">
          <div className="flex min-h-[52px] items-center border-b border-[var(--app-border)] px-5 pr-14">
            <TabsList className="h-auto rounded-[8px] bg-[var(--app-surface)] p-1">
              <TabsTrigger
                value="news"
                className="h-9 rounded-[7px] px-3 text-sm font-light text-muted-foreground shadow-none data-[state=active]:bg-[var(--app-background)] data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Novidades
                <span className="ml-2 rounded-full bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] font-extralight text-[var(--app-text-secondary)]">
                  {news.length}
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="archived"
                className="h-9 rounded-[7px] px-3 text-sm font-light text-muted-foreground shadow-none data-[state=active]:bg-[var(--app-background)] data-[state=active]:text-foreground data-[state=active]:shadow-sm"
              >
                Arquivado
                <span className="ml-2 rounded-full bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] font-extralight text-[var(--app-text-secondary)]">
                  {archived.length}
                </span>
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="news" className="m-0 min-h-0 flex-1 overflow-hidden">
            <UpdatesPanel items={news} selected={selected} onSelect={setSelectedId} onArchive={archiveSelected} archived={false} />
          </TabsContent>
          <TabsContent value="archived" className="m-0 min-h-0 flex-1 overflow-hidden">
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
          <h3 className="text-sm font-light">{archived ? "Nada arquivado" : "Tudo arquivado"}</h3>
          <p className="text-sm font-extralight text-muted-foreground">
            {archived ? "Quando você arquivar uma novidade, ela aparece aqui." : "Você pode restaurar itens pela aba Arquivado."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 md:grid-cols-[300px_minmax(0,1fr)]">
      <aside className="min-h-0 border-b border-[var(--app-border)] bg-[var(--app-surface-muted)] md:border-b-0 md:border-r">
        <div className="scrollbar-thin h-full overflow-y-auto p-3">
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

      <section className="scrollbar-thin min-h-0 overflow-y-auto">
        {selected ? (
          <UpdateDetail archived={archived} item={selected} onArchive={onArchive} />
        ) : null}
      </section>
    </div>
  );
}

function UpdateListItem({ item, onSelect, selected }: { item: ProductUpdate; onSelect: () => void; selected: boolean }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full rounded-[8px] border border-transparent p-3 text-left transition-colors",
        selected
          ? "border-[#FF4529]/35 bg-[var(--app-surface-solid)]"
          : "hover:bg-[var(--app-surface-hover)]",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-light text-[var(--app-text-primary)]">{item.title}</span>
          <Badge className={cn("shrink-0 border-0 px-2 py-0 text-[10px] font-extralight", CATEGORY_CLASSES[item.category])}>
            {CATEGORY_LABELS[item.category]}
          </Badge>
        </span>
        <span className="mt-1 block truncate text-xs font-extralight text-[var(--app-text-secondary)]">{item.subtitle}</span>
      </span>
    </button>
  );
}

function UpdateDetail({ archived, item, onArchive }: { archived: boolean; item: ProductUpdate; onArchive: () => void }) {
  return (
    <article className="space-y-5 p-5 font-extralight md:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="text-2xl font-light tracking-normal text-[var(--app-text-primary)]">{item.title}</h2>
            <Badge className={cn("border-0 px-2 py-0.5 text-[10px] font-extralight", CATEGORY_CLASSES[item.category])}>
              {CATEGORY_LABELS[item.category]}
            </Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-extralight text-[var(--app-text-secondary)]">
            <span>{item.version}</span>
            <span className="h-1 w-1 rounded-full bg-[var(--app-text-tertiary)]" />
            <span>Publicado em {item.publishedAt}</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-9 shrink-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] text-sm font-light"
          onClick={onArchive}
        >
          {archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
          {archived ? "Restaurar" : "Arquivar"}
        </Button>
      </div>

      <p className="text-sm font-extralight leading-7 text-[var(--app-text-secondary)]">{item.summary}</p>

      <div className="space-y-3">
        {item.details.map((detail) => (
          <p key={detail} className="text-sm font-extralight leading-6 text-[var(--app-text-secondary)]">
            {detail}
          </p>
        ))}
      </div>

      {item.href ? (
        <Button asChild className="h-10 rounded-[8px] bg-[#FF4529] font-light text-white hover:bg-[#FF4529]/90">
          <a href={item.href} target="_blank" rel="noreferrer">
            <FileText className="h-4 w-4" />
            Ver documento
          </a>
        </Button>
      ) : null}
    </article>
  );
}
