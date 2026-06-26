import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  MoreHorizontal,
  ArrowRight,
  Tag,
  UserPlus,
  Calendar,
  Archive,
  Trash2
} from "lucide-react";

interface Stage {
  id: string;
  name: string;
  color?: string;
}

interface TagItem {
  id: string;
  name: string;
  color: string;
}

interface QuickActionsProps {
  stages?: Stage[];
  availableTags?: TagItem[];
  currentStageId?: string | null;
  currentTagIds?: string[];
  onMoveStage?: (stageId: string) => void;
  onAddTag?: (tagId: string) => void;
  onRemoveTag?: (tagId: string) => void;
  onCreateLead?: () => void;
  onSchedule?: () => void;
  onArchive?: () => void;
  onDelete?: () => void;
  hasLead?: boolean;
}

export function QuickActions({
  stages = [],
  availableTags = [],
  currentStageId,
  currentTagIds = [],
  onMoveStage,
  onAddTag,
  onCreateLead,
  onSchedule,
  onArchive,
  onDelete,
  hasLead
}: QuickActionsProps) {
  const unassignedTags = availableTags.filter(t => !currentTagIds.includes(t.id));

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* Move to stage */}
        {hasLead && stages.length > 0 && onMoveStage && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <ArrowRight className="h-4 w-4 mr-2" />
              Mover para estágio
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {stages.map(stage => (
                <DropdownMenuItem
                  key={stage.id}
                  onClick={() => onMoveStage(stage.id)}
                  disabled={stage.id === currentStageId}
                >
                  <span
                    className="w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: stage.color || "#888" }}
                  />
                  {stage.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Add tag */}
        {hasLead && unassignedTags.length > 0 && onAddTag && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tag className="h-4 w-4 mr-2" />
              Adicionar tag
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {unassignedTags.map(tag => (
                <DropdownMenuItem
                  key={tag.id}
                  onClick={() => onAddTag(tag.id)}
                >
                  <span
                    className="w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: tag.color }}
                  />
                  {tag.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}

        {/* Create lead */}
        {!hasLead && onCreateLead && (
          <DropdownMenuItem onClick={onCreateLead}>
            <UserPlus className="h-4 w-4 mr-2" />
            Criar lead
          </DropdownMenuItem>
        )}

        {/* Schedule */}
        {onSchedule && (
          <DropdownMenuItem onClick={onSchedule}>
            <Calendar className="h-4 w-4 mr-2" />
            Agendar atividade
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        {/* Archive */}
        {onArchive && (
          <DropdownMenuItem onClick={onArchive}>
            <Archive className="h-4 w-4 mr-2" />
            Arquivar
          </DropdownMenuItem>
        )}

        {/* Delete */}
        {onDelete && (
          <DropdownMenuItem onClick={onDelete} className="text-destructive">
            <Trash2 className="h-4 w-4 mr-2" />
            Remover
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
