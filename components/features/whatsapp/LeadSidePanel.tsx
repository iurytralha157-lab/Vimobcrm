import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  User,
  Phone,
  Mail,
  MapPin,
  ArrowRight,
  History,
  Calendar,
  Plus,
  X
} from "lucide-react";
import Link from "next/link";
import { formatPhoneForDisplay } from "@/lib/phone-utils";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface Lead {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  cidade?: string | null;
  uf?: string | null;
  stage_id?: string | null;
  pipeline_id?: string | null;
  created_at?: string;
  tags?: Array<{
    tag: {
      id: string;
      name: string;
      color: string;
    };
  }>;
}

interface Stage {
  id: string;
  name: string;
  color?: string;
}

interface LeadSidePanelProps {
  lead: Lead | null;
  stages?: Stage[];
  onMoveStage?: (stageId: string) => void;
  onAddTag?: (tagId: string) => void;
  onRemoveTag?: (tagId: string) => void;
  availableTags?: Array<{ id: string; name: string; color: string }>;
  onClose?: () => void;
  className?: string;
}

export function LeadSidePanel({
  lead,
  stages = [],
  onMoveStage,
  onAddTag,
  onRemoveTag,
  availableTags = [],
  onClose,
  className
}: LeadSidePanelProps) {
  const [showTagSelector, setShowTagSelector] = useState(false);

  if (!lead) {
    return (
      <div className={cn("flex flex-col items-center justify-center p-6 text-muted-foreground", className)}>
        <User className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm font-medium">Nenhum lead selecionado</p>
        <p className="text-xs mt-1">Selecione uma conversa com lead vinculado</p>
      </div>
    );
  }

  const currentStage = stages.find(s => s.id === lead.stage_id);
  const leadTags = lead.tags || [];
  const leadTagIds = leadTags.map(lt => lt.tag.id);
  const unassignedTags = availableTags.filter(t => !leadTagIds.includes(t.id));

  return (
    <div className={cn("flex flex-col h-full bg-[var(--app-surface)]", className)}>
      {/* Header */}
      <div className="p-4 border-b border-white/[0.055]">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={undefined} />
              <AvatarFallback className="bg-primary text-primary-foreground text-lg font-semibold">
                {lead.name?.[0]?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h3 className="font-semibold text-base truncate">{lead.name}</h3>
              {lead.phone && (
                <p className="text-sm text-muted-foreground">
                  {formatPhoneForDisplay(lead.phone)}
                </p>
              )}
            </div>
          </div>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          {/* Contact Info */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Contato
            </h4>
            <div className="space-y-2">
              {lead.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{formatPhoneForDisplay(lead.phone)}</span>
                </div>
              )}
              {lead.email && (
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{lead.email}</span>
                </div>
              )}
              {(lead.cidade || lead.uf) && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{[lead.cidade, lead.uf].filter(Boolean).join(", ")}</span>
                </div>
              )}
            </div>
          </section>

          <Separator />

          {/* Pipeline Stage */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Estágio
            </h4>
            {currentStage ? (
              <Badge
                variant="secondary"
                className="text-sm"
                style={{ backgroundColor: currentStage.color ? `${currentStage.color}20` : undefined }}
              >
                {currentStage.name}
              </Badge>
            ) : (
              <p className="text-sm text-muted-foreground">Sem estágio</p>
            )}

            {/* Quick stage buttons */}
            {stages.length > 0 && onMoveStage && (
              <div className="flex flex-wrap gap-1.5 mt-3">
                {stages.slice(0, 4).map(stage => (
                  <Button
                    key={stage.id}
                    variant={stage.id === lead.stage_id ? "secondary" : "outline"}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => onMoveStage(stage.id)}
                    disabled={stage.id === lead.stage_id}
                  >
                    {stage.name}
                  </Button>
                ))}
              </div>
            )}
          </section>

          <Separator />

          {/* Tags */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Tags
              </h4>
              {unassignedTags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setShowTagSelector(!showTagSelector)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Adicionar
                </Button>
              )}
            </div>

            {/* Current tags */}
            <div className="flex flex-wrap gap-1.5">
              {leadTags.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sem tags</p>
              ) : (
                leadTags.map(lt => (
                  <Badge
                    key={lt.tag.id}
                    variant="secondary"
                    className="text-xs cursor-pointer hover:opacity-80 transition-opacity border-0"
                    style={{ backgroundColor: lt.tag.color, color: '#FFFFFF' }}
                    onClick={() => onRemoveTag?.(lt.tag.id)}
                  >
                    {lt.tag.name}
                    <X className="h-3 w-3 ml-1" />
                  </Badge>
                ))
              )}
            </div>

            {/* Tag selector */}
            {showTagSelector && unassignedTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 p-2 bg-white/[0.045] rounded-md">
                {unassignedTags.map(tag => (
                  <Badge
                    key={tag.id}
                    variant="outline"
                    className="text-xs cursor-pointer hover:bg-white/[0.055] transition-colors"
                    onClick={() => {
                      onAddTag?.(tag.id);
                      setShowTagSelector(false);
                    }}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {tag.name}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          <Separator />

          {/* Quick Actions */}
          <section>
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Ações Rápidas
            </h4>
            <div className="space-y-2">
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href={`/crm/pipelines?lead=${lead.id}`}>
                  <User className="h-4 w-4 mr-2" />
                  Ver Lead Completo
                  <ArrowRight className="h-4 w-4 ml-auto" />
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href={`/agenda?lead=${lead.id}`}>
                  <Calendar className="h-4 w-4 mr-2" />
                  Agendar Atividade
                </Link>
              </Button>
              <Button variant="outline" size="sm" className="w-full justify-start" asChild>
                <Link href={`/crm/pipelines?lead=${lead.id}&tab=history`}>
                  <History className="h-4 w-4 mr-2" />
                  Ver Histórico
                </Link>
              </Button>
            </div>
          </section>

          {/* Created date */}
          {lead.created_at && (
            <>
              <Separator />
              <div className="text-xs text-muted-foreground">
                Criado em {format(new Date(lead.created_at), "dd/MM/yyyy 'às' HH:mm")}
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
