import { MessageSquare, Send } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ScheduleComment } from "@/hooks/use-schedule-comments";
import { cn } from "@/lib/utils";
import { agendaFieldClass } from "@/components/features/schedule/event-sheet/config";
import { AgendaRow } from "@/components/features/schedule/event-sheet/EventSheetPrimitives";
import { formatScheduleTimestamp } from "@/components/features/schedule/event-sheet/model";

export function EventNotesAndComments({
  locked,
  isMasked,
  isExisting,
  description,
  comments,
  commentText,
  canManageSchedule,
  isAdding,
  onDescriptionChange,
  onCommentChange,
  onSendComment,
}: {
  locked: boolean;
  isMasked: boolean;
  isExisting: boolean;
  description: string;
  comments: readonly ScheduleComment[];
  commentText: string;
  canManageSchedule: boolean;
  isAdding: boolean;
  onDescriptionChange: (value: string) => void;
  onCommentChange: (value: string) => void;
  onSendComment: () => void;
}) {
  return (
    <>
      <AgendaRow
        dataTour="agenda-event-notes"
        icon={<MessageSquare size={19} />}
        label="Observações"
      >
        {locked ? (
          <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
            {description || (isMasked ? "Informação privada" : "Sem descrição")}
          </p>
        ) : (
          <Textarea
            aria-label="Observações"
            value={description}
            onChange={(event) => onDescriptionChange(event.target.value)}
            placeholder="Adicione observações"
            rows={4}
            className={cn(
              "min-h-[112px] resize-none px-3 py-3 text-[12px] font-light sm:min-h-[132px]",
              agendaFieldClass,
            )}
          />
        )}
      </AgendaRow>

      {isExisting && (
        <AgendaRow icon={<MessageSquare size={19} />}>
          <div className="space-y-3">
            {isMasked ? (
              <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                Comentários privados
              </p>
            ) : (
              <>
                {comments.length === 0 && (
                  <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">
                    Nenhum comentário
                  </p>
                )}
                {comments.map((comment) => (
                  <div key={comment.id} className="flex gap-2">
                    <Avatar className="h-6 w-6 shrink-0">
                      <AvatarImage
                        src={comment.user?.avatar_url || undefined}
                        alt={comment.user?.name || "Usuário"}
                      />
                      <AvatarFallback className="bg-primary/12 text-[10px] font-light text-primary">
                        {(comment.user?.name || "U")
                          .split(" ")
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join("")}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 text-[10px] text-[var(--app-text-tertiary)]">
                        <span className="font-light text-[var(--app-text-primary)]">
                          {comment.user?.name || "Usuário"}
                        </span>
                        {" · "}
                        {formatScheduleTimestamp(comment.created_at)}
                      </div>
                      <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-1.5 text-[12px] font-light leading-[18px] text-[var(--app-text-primary)]">
                        {comment.content}
                      </div>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={commentText}
                    onChange={(event) => onCommentChange(event.target.value)}
                    onKeyDown={(event) =>
                      event.key === "Enter" && onSendComment()
                    }
                    placeholder="Comentário..."
                    className={cn(
                      "h-9 text-[12px] font-light",
                      agendaFieldClass,
                    )}
                    disabled={!canManageSchedule || isAdding}
                  />
                  <Button
                    size="icon"
                    onClick={onSendComment}
                    disabled={
                      !canManageSchedule || isAdding || !commentText.trim()
                    }
                    className="h-9 w-9 shrink-0 rounded-[6px] border-0 bg-primary text-primary-foreground shadow-none hover:bg-primary/90 hover:text-primary-foreground"
                    aria-label="Enviar comentário"
                  >
                    <Send size={13} />
                  </Button>
                </div>
              </>
            )}
          </div>
        </AgendaRow>
      )}
    </>
  );
}
