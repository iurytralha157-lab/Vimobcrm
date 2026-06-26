import { useState, useEffect } from "react";
import Image from "next/image";
import { useAuth } from "@/contexts/AuthContext";
import { useDealStatusChange } from "@/hooks/use-deal-status-change";
import { LostReasonDialog } from "@/components/features/leads/LostReasonDialog";
// force rebuild

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  User,
  ArrowRight,
  History,
  X,
  Loader2,
  Plus,
  Megaphone,
  Globe,
  Tag,
  CircleDot,
  ExternalLink,
  Building2,
  MessageSquareText,
  Search,
  ChevronRight,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { formatPhoneForDisplay } from "@/lib/phone-utils";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { useConversationLeadDetail } from "@/hooks/use-conversation-lead-detail";
import { useStages } from "@/hooks/use-stages";
import { useTags } from "@/hooks/use-tags";
import { useUpdateLead } from "@/hooks/use-leads";
import { useAddLeadTag, useRemoveLeadTag } from "@/hooks/use-leads";
import { useProperties } from "@/hooks/use-properties";
import type { Tables } from "@/integrations/supabase/types";

interface ConversationLeadPanelProps {
  leadId: string;
  onClose: () => void;
  className?: string;
  contactPicture?: string | null;
}

const DEAL_STATUS_OPTIONS = [
  { value: "open", label: "Aberto", color: "hsl(var(--primary))" },
  { value: "won", label: "Ganho", color: "#22c55e" },
  { value: "lost", label: "Perdido", color: "hsl(var(--destructive))" },
];

type LeadStageSummary = { id: string; name: string; color: string | null };
type LeadPipelineSummary = { id: string; name: string };
type LeadTagSummary = { id: string; name: string; color: string };
type LeadTagRelation = { tag: LeadTagSummary };
type LeadMetaSummary = Pick<
  Tables<"lead_meta">,
  | "ad_name"
  | "campaign_name"
  | "contact_notes"
  | "creative_url"
  | "creative_video_url"
  | "form_name"
  | "utm_campaign"
  | "utm_medium"
  | "utm_source"
>;
type ConversationLeadDetail = Pick<
  Tables<"leads">,
  | "created_at"
  | "deal_status"
  | "id"
  | "interest_property_id"
  | "name"
  | "phone"
  | "pipeline_id"
  | "property_id"
  | "source"
  | "stage_id"
  | "valor_interesse"
> &
  Partial<Pick<Tables<"leads">, "assigned_user_id" | "commission_percentage">> & {
    meta: LeadMetaSummary | null;
    pipeline: LeadPipelineSummary | null;
    stage: LeadStageSummary | null;
    tags: LeadTagRelation[] | null;
  };

type PropertyLeadUpdate = {
  id: string;
  property_id: string;
  valor_interesse?: number | null;
};

function maskCurrency(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const num = parseInt(digits, 10) / 100;
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseCurrencyToNumber(masked: string): number {
  if (!masked) return 0;
  const cleaned = masked.replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned) || 0;
}

export function ConversationLeadPanel({ leadId, onClose, className, contactPicture }: ConversationLeadPanelProps) {
  const { data: lead, isLoading } = useConversationLeadDetail(leadId);
  const { data: allStages } = useStages(lead?.pipeline_id || undefined);
  const { data: allTags } = useTags();
  const { data: properties } = useProperties();
  const updateLead = useUpdateLead();
  const addTag = useAddLeadTag();
  const removeTag = useRemoveLeadTag();
  const dealStatusChange = useDealStatusChange();
  const { profile, organization } = useAuth();

  const [valorLocal, setValorLocal] = useState("");
  const [propertyPickerOpen, setPropertyPickerOpen] = useState(false);
  const [propertySearch, setPropertySearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterPurpose, setFilterPurpose] = useState("");
  const [filterLocation, setFilterLocation] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [lostReasonDialogOpen, setLostReasonDialogOpen] = useState(false);

  // Sync local value state with lead data
  useEffect(() => {
    const nextValue = lead?.valor_interesse
      ? Number(lead.valor_interesse).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "";

    queueMicrotask(() => {
      setValorLocal(nextValue);
    });
  }, [lead?.valor_interesse]);

  if (isLoading) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!lead) return null;

  const detailLead = lead as ConversationLeadDetail;
  const leadTags = detailLead.tags || [];
  const leadTagIds = leadTags.map((lt) => lt.tag.id);
  const availableTagsToAdd = (allTags || []).filter((t) => !leadTagIds.includes(t.id));
  const stage = detailLead.stage;
  const pipeline = detailLead.pipeline;
  const meta = detailLead.meta;
  const dealStatus = detailLead.deal_status || "open";
  const currentPropertyId = detailLead.property_id || detailLead.interest_property_id || "";

  const handleStageChange = (newStageId: string) => {
    if (newStageId !== lead.stage_id) {
      updateLead.mutate({ id: leadId, stage_id: newStageId });
    }
  };

  const handleDealStatusChange = (newStatus: string) => {
    if (newStatus === dealStatus) return;

    if (newStatus === "lost") {
      setLostReasonDialogOpen(true);
      return;
    }

    dealStatusChange.mutate({
      leadId,
      newStatus: newStatus as "open" | "won" | "lost",
      organizationId: profile?.organization_id || organization?.id || "",
      organizationName: organization?.name || null,
      userId: detailLead.assigned_user_id ?? null,
      propertyId: detailLead.property_id || null,
      valorInteresse: lead.valor_interesse ?? null,
      commissionPercentage: detailLead.commission_percentage ?? null,
      leadName: lead.name || "Lead",
    });
  };

  const handleConfirmLostReason = async (reason: string) => {
    await dealStatusChange.mutateAsync({
      leadId,
      newStatus: "lost",
      organizationId: profile?.organization_id || organization?.id || "",
      organizationName: organization?.name || null,
      userId: detailLead.assigned_user_id ?? null,
      propertyId: detailLead.property_id || null,
      valorInteresse: lead.valor_interesse ?? null,
      commissionPercentage: detailLead.commission_percentage ?? null,
      leadName: lead.name || "Lead",
      lostReason: reason,
    });
    setLostReasonDialogOpen(false);
  };

  const handleAddTag = (tagId: string) => {
    addTag.mutate({ leadId, tagId });
  };

  const handleRemoveTag = (tagId: string) => {
    removeTag.mutate({ leadId, tagId });
  };

  const handleValorBlur = () => {
    const num = parseCurrencyToNumber(valorLocal);
    const currentNum = Number(lead.valor_interesse) || 0;
    if (num !== currentNum) {
      updateLead.mutate({ id: leadId, valor_interesse: num || null });
    }
  };

  const handleValorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValorLocal(maskCurrency(e.target.value));
  };

  const handlePropertyChange = (propertyId: string) => {
    const prop = (properties || []).find((p) => p.id === propertyId);
    const updates: PropertyLeadUpdate = { id: leadId, property_id: propertyId };
    if (prop?.preco) {
      updates.valor_interesse = prop.preco;
      setValorLocal(Number(prop.preco).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    }
    updateLead.mutate(updates);
  };

  // Campaign/source info
  const hasCampaignInfo =
    meta?.campaign_name || meta?.ad_name || meta?.form_name || meta?.utm_source || meta?.utm_campaign;
  const creativeVideoUrl = meta?.creative_video_url || undefined;
  const creativeImageUrl = meta?.creative_url || undefined;
  const creativeUrl = creativeVideoUrl || creativeImageUrl;

  return (
    <div className={cn("flex flex-col h-full bg-[var(--app-surface)] rounded-2xl overflow-hidden", className)}>
      {/* Header */}
      <div className="p-4 border-b border-white/[0.055]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="h-11 w-11 shrink-0">
              <AvatarImage src={contactPicture || undefined} />
              <AvatarFallback className="bg-primary text-primary-foreground text-base font-semibold">
                {lead.name?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm truncate">{lead.name}</h3>
              {lead.phone && <p className="text-xs text-muted-foreground">{formatPhoneForDisplay(lead.phone)}</p>}
            </div>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Deal Status */}
          <section>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Status</h4>
            <Select value={dealStatus} onValueChange={handleDealStatusChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DEAL_STATUS_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      <CircleDot className="h-3 w-3" style={{ color: opt.color }} />
                      {opt.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </section>

          <Separator />

          {/* Pipeline / Stage - Editable */}
          <section>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Estágio</h4>
            {pipeline && <p className="text-xs text-muted-foreground mb-1.5">{pipeline.name}</p>}
            {allStages && allStages.length > 0 ? (
              <Select value={lead.stage_id || ""} onValueChange={handleStageChange}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecionar estágio" />
                </SelectTrigger>
                <SelectContent>
                  {allStages.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: s.color || "#6b7280" }}
                        />
                        {s.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : stage ? (
              <Badge
                variant="secondary"
                className="text-xs"
                style={
                  stage.color
                    ? {
                        backgroundColor: `${stage.color}20`,
                        color: stage.color,
                        borderColor: stage.color,
                      }
                    : undefined
                }
              >
                {stage.name}
              </Badge>
            ) : (
              <p className="text-xs text-muted-foreground">Sem estágio</p>
            )}
          </section>

          <Separator />

          {/* Tags - Editable */}
          <section>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Tags</h4>
            <div className="flex flex-wrap gap-1.5">
              {leadTags.map((lt) => (
                <Badge
                  key={lt.tag.id}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-5 cursor-pointer group/tag hover:opacity-80 border-0"
                  style={{
                    backgroundColor: lt.tag.color,
                    color: "#FFFFFF",
                  }}
                  onClick={() => handleRemoveTag(lt.tag.id)}
                  title="Clique para remover"
                >
                  {lt.tag.name}
                  <X className="h-2.5 w-2.5 ml-1 opacity-0 group-hover/tag:opacity-100 transition-opacity" />
                </Badge>
              ))}

              {/* Add tag button */}
              {availableTagsToAdd.length > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="h-5 px-1.5 rounded-md border border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary hover:text-primary transition-colors flex items-center gap-1">
                      <Plus className="h-2.5 w-2.5" />
                      <span className="text-[10px]">Tag</span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-48 overflow-auto">
                    {availableTagsToAdd.map((tag) => (
                      <DropdownMenuItem
                        key={tag.id}
                        onClick={() => handleAddTag(tag.id)}
                        className="flex items-center gap-2 text-xs"
                      >
                        <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                        {tag.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {leadTags.length === 0 && availableTagsToAdd.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhuma tag</p>
            )}
          </section>

          <Separator />

          {/* Property Selector */}
          <section>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Imóvel de Interesse
            </h4>
            <Button
              variant="outline"
              className="w-full h-8 text-xs justify-between px-3"
              onClick={() => {
                setPropertySearch("");
                setPropertyPickerOpen(true);
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">
                  {currentPropertyId
                    ? (() => {
                        const p = (properties || []).find((p) => p.id === currentPropertyId);
                        if (!p) return "Selecionar imóvel";
                        const code = p.code || "";
                        const title = p.title || "Sem título";
                        const full = code ? `${code} - ${title}` : title;
                        return full.length > code.length + 13 ? full.slice(0, code.length + 13) + "..." : full;
                      })()
                    : "Nenhum"}
                </span>
              </div>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            </Button>

            <Dialog open={propertyPickerOpen} onOpenChange={setPropertyPickerOpen}>
              <DialogContent className="w-[95%] max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden">
                <div className="flex items-center gap-3 p-4 pr-12 pb-3 border-b border-white/[0.055]">
                  <DialogTitle className="text-sm font-semibold whitespace-nowrap">Selecionar Imóvel</DialogTitle>
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Buscar por código ou nome..."
                      className="h-8 text-xs pl-8"
                      value={propertySearch}
                      onChange={(e) => setPropertySearch(e.target.value)}
                    />
                  </div>
                  <Button
                    variant={showFilters ? "secondary" : "ghost"}
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => setShowFilters(!showFilters)}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {/* Collapsible Filters */}
                {showFilters && (
                  <div className="flex flex-wrap items-center gap-3 px-4 pt-4 pb-3 border-b border-white/[0.055]">
                    <select
                      className="h-9 text-xs rounded-md border border-white/[0.055] bg-background px-3 flex-1 min-w-[140px]"
                      value={filterType}
                      onChange={(e) => setFilterType(e.target.value)}
                    >
                      <option value="">Todos os tipos</option>
                      {[...new Set((properties || []).map((p) => p.tipo_de_imovel).filter(Boolean))].sort().map((t) => (
                        <option key={t} value={t!}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <select
                      className="h-9 text-xs rounded-md border border-white/[0.055] bg-background px-3 flex-1 min-w-[140px]"
                      value={filterPurpose}
                      onChange={(e) => setFilterPurpose(e.target.value)}
                    >
                      <option value="">Todas finalidades</option>
                      {[...new Set((properties || []).map((p) => p.tipo_de_negocio).filter(Boolean))]
                        .sort()
                        .map((t) => (
                          <option key={t} value={t!}>
                            {t}
                          </option>
                        ))}
                    </select>
                    <select
                      className="h-9 text-xs rounded-md border border-white/[0.055] bg-background px-3 flex-1 min-w-[140px]"
                      value={filterLocation}
                      onChange={(e) => setFilterLocation(e.target.value)}
                    >
                      <option value="">Todas localizações</option>
                      {[
                        ...new Set(
                          (properties || [])
                            .map((p) => [p.bairro, p.cidade].filter(Boolean).join(", "))
                            .filter((v) => v),
                        ),
                      ]
                        .sort()
                        .map((loc) => (
                          <option key={loc} value={loc}>
                            {loc}
                          </option>
                        ))}
                    </select>
                  </div>
                )}
                <div className="flex-1 overflow-y-auto px-4 pb-4">
                  <div className="grid grid-cols-3 gap-2">
                    {(properties || [])
                      .filter((p) => {
                        const s = propertySearch.toLowerCase();
                        if (
                          s &&
                          !(
                            (p.code || "").toLowerCase().includes(s) ||
                            (p.title || "").toLowerCase().includes(s) ||
                            (p.bairro || "").toLowerCase().includes(s)
                          )
                        )
                          return false;
                        if (filterType && p.tipo_de_imovel !== filterType) return false;
                        if (filterPurpose && p.tipo_de_negocio !== filterPurpose) return false;
                        if (filterLocation) {
                          const loc = [p.bairro, p.cidade].filter(Boolean).join(", ");
                          if (loc !== filterLocation) return false;
                        }
                        return true;
                      })
                      .map((p) => (
                        <button
                          key={p.id}
                          className={cn(
                            "flex flex-col rounded-xl border overflow-hidden text-left transition-all hover:ring-2 hover:ring-primary/50",
                            currentPropertyId === p.id && "ring-2 ring-primary",
                          )}
                          onClick={() => {
                            handlePropertyChange(p.id);
                            setPropertyPickerOpen(false);
                          }}
                        >
                          <div className="aspect-[4/3] bg-white/[0.045] relative">
                            {p.imagem_principal ? (
                              <Image
                                src={p.imagem_principal}
                                alt={p.title || "Imóvel"}
                                fill
                                sizes="33vw"
                                className="object-cover"
                                unoptimized
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center">
                                <Building2 className="h-6 w-6 text-muted-foreground/40" />
                              </div>
                            )}
                            {p.code && (
                              <Badge className="absolute top-1.5 left-1.5 text-[9px] px-1.5 py-0 h-4 bg-[#ff482a] text-white backdrop-blur-sm border-0">
                                {p.code}
                              </Badge>
                            )}
                          </div>
                          <div className="p-2 space-y-0.5">
                            <p className="text-[11px] font-medium truncate">{p.title || "Sem título"}</p>
                            {p.bairro && (
                              <p className="text-[10px] text-muted-foreground truncate">
                                {p.bairro}
                                {p.cidade ? `, ${p.cidade}` : ""}
                              </p>
                            )}
                            {p.preco && (
                              <p className="text-[11px] font-semibold text-primary">
                                {new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
                                  Number(p.preco),
                                )}
                              </p>
                            )}
                          </div>
                        </button>
                      ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </section>

          <Separator />

          {/* Editable Value */}
          <section>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Valor de Interesse
            </h4>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium">R$</span>
              <Input
                className="h-8 text-xs"
                placeholder="0,00"
                value={valorLocal}
                onChange={handleValorChange}
                onBlur={handleValorBlur}
              />
            </div>
          </section>

          <Separator />

          {/* Campaign / Source Info */}
          <section>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Origem</h4>
            <div className="space-y-2">
              {lead.source && (
                <div className="flex items-center gap-2 text-xs">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="capitalize">{lead.source}</span>
                </div>
              )}

              {hasCampaignInfo && (
                <div className="rounded-md bg-white/[0.045] p-2.5 space-y-1.5">
                  {meta.campaign_name && (
                    <div className="flex items-start gap-2 text-xs">
                      <Megaphone className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground">Campanha</p>
                        <p className="truncate font-medium">{meta.campaign_name}</p>
                      </div>
                    </div>
                  )}
                  {meta.ad_name && (
                    <div className="flex items-start gap-2 text-xs">
                      <Tag className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-[10px] text-muted-foreground">Anúncio</p>
                        <p className="truncate font-medium">{meta.ad_name}</p>
                      </div>
                    </div>
                  )}
                  {creativeUrl && (
                    <div className="space-y-1.5">
                      {creativeVideoUrl ? (
                        <video
                          src={creativeVideoUrl}
                          controls
                          preload="metadata"
                          className="w-full rounded max-h-[140px] bg-black"
                          poster={creativeImageUrl}
                        />
                      ) : creativeImageUrl ? (
                        <Image
                          src={creativeImageUrl}
                          alt="Criativo"
                          width={320}
                          height={140}
                          className="w-full rounded max-h-[140px] object-cover cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(creativeImageUrl, "_blank")}
                          unoptimized
                        />
                      ) : null}
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full h-7 text-[11px] gap-1.5"
                        onClick={() => window.open(creativeUrl, "_blank")}
                      >
                        <ExternalLink className="h-3 w-3" />
                        Ver Criativo
                      </Button>
                    </div>
                  )}
                  {meta.form_name && (
                    <div className="text-xs text-muted-foreground">
                      Formulário: <span className="text-foreground">{meta.form_name}</span>
                    </div>
                  )}
                  {meta.utm_source && !meta.campaign_name && (
                    <div className="text-xs text-muted-foreground">
                      UTM:{" "}
                      <span className="text-foreground">
                        {meta.utm_source}
                        {meta.utm_medium ? ` / ${meta.utm_medium}` : ""}
                      </span>
                    </div>
                  )}
                  {meta.utm_campaign && !meta.campaign_name && (
                    <div className="text-xs text-muted-foreground">
                      Campanha UTM: <span className="text-foreground">{meta.utm_campaign}</span>
                    </div>
                  )}
                </div>
              )}

              {!lead.source && !hasCampaignInfo && (
                <p className="text-xs text-muted-foreground">Sem informação de origem</p>
              )}
            </div>
          </section>

          {/* Contact Notes */}
          {meta?.contact_notes && (
            <>
              <Separator />
              <section>
                <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Observações do Contato
                </h4>
                <div className="rounded-md bg-white/[0.045] p-2.5">
                  <div className="flex items-start gap-2 text-xs">
                    <MessageSquareText className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <p className="text-foreground whitespace-pre-wrap">{meta.contact_notes}</p>
                  </div>
                </div>
              </section>
            </>
          )}

          <Separator />

          {/* Quick Actions */}
          <section>
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Ações</h4>
            <div className="space-y-1.5">
              <Button variant="outline" size="sm" className="w-full justify-start h-8 text-xs !rounded-xl" asChild>
                <Link href={`/crm/pipelines?lead=${lead.id}`}>
                  <User className="h-3.5 w-3.5 mr-2" />
                  Ver Lead Completo
                  <ArrowRight className="h-3.5 w-3.5 ml-auto" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start h-8 text-xs !rounded-xl" asChild>
                <Link href={`/crm/pipelines?lead=${lead.id}&tab=history`}>
                  <History className="h-3.5 w-3.5 mr-2" />
                  Ver Histórico
                </Link>
              </Button>
            </div>
          </section>

          {/* Created date */}
          {lead.created_at && (
            <>
              <Separator />
              <div className="text-[11px] text-muted-foreground">
                Criado em {format(new Date(lead.created_at), "dd/MM/yyyy 'às' HH:mm")}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
      <LostReasonDialog
        open={lostReasonDialogOpen}
        onOpenChange={setLostReasonDialogOpen}
        onConfirm={handleConfirmLostReason}
        leadName={lead.name}
        loading={dealStatusChange.isPending}
      />
    </div>
  );
}
