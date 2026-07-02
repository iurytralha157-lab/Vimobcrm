import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

interface MessageBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  disabled?: boolean;
  isSending?: boolean;
  /** Left-side action buttons (file upload, automation trigger, etc.) */
  leftActions?: React.ReactNode;
  /** Right-side extra actions (audio recorder shown when no text) */
  rightActions?: React.ReactNode;
  /** If true, shows rightActions instead of send button when value is empty */
  showRightActionsWhenEmpty?: boolean;
  /** Use textarea for multiline (default: false for single-line input) */
  multiline?: boolean;
  /** Ref for the input/textarea element */
  inputRef?: React.Ref<HTMLInputElement | HTMLTextAreaElement>;
  className?: string;
  compact?: boolean;
}

const FileUploadIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 337 337" className={cn("h-5 w-5", className)}>
    <circle strokeWidth="20" stroke="currentColor" fill="none" r="158.5" cy="168.5" cx="168.5" />
    <path strokeLinecap="round" strokeWidth="25" stroke="currentColor" d="M167.759 79V259" />
    <path strokeLinecap="round" strokeWidth="25" stroke="currentColor" d="M79 167.138H259" />
  </svg>
);

const SendIcon = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 664 663" className={cn("h-5 w-5", className)}>
    <path
      strokeLinejoin="round"
      strokeLinecap="round"
      strokeWidth="33.67"
      stroke="currentColor"
      d="M646.293 331.888L17.7538 17.6187L155.245 331.888M646.293 331.888L17.753 646.157L155.245 331.888M646.293 331.888L318.735 330.228L155.245 331.888"
    />
  </svg>
);

export const MessageBox = React.forwardRef<HTMLDivElement, MessageBoxProps>(
  (
    {
      value,
      onChange,
      onSend,
      onKeyDown,
      placeholder = "Message...",
      disabled = false,
      isSending = false,
      leftActions,
      rightActions,
      showRightActionsWhenEmpty = false,
      multiline = false,
      inputRef,
      className,
      compact = false,
    },
    ref
  ) => {
    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (onKeyDown) {
        onKeyDown(e);
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (value.trim() && !disabled && !isSending) {
          onSend();
        }
      }
    };

    const showSendButton = value.trim() || !showRightActionsWhenEmpty || !rightActions;

    return (
      <div
        ref={ref}
        className={cn(
          "flex min-h-[48px] w-full items-end gap-2 rounded-[8px] bg-[rgb(15_23_42/0.065)] px-2 py-2 text-sm shadow-none transition-colors focus-within:bg-[rgb(15_23_42/0.085)]",
          "dark:bg-[#242424] dark:focus-within:bg-[#292929]",
          compact && "min-h-[40px] px-1.5 py-1.5",
          disabled && "opacity-70",
          className
        )}
      >
        {leftActions && (
          <div className="flex h-9 shrink-0 items-center gap-1 [&_button]:inline-flex [&_button]:h-9 [&_button]:w-9 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-[6px] [&_button]:text-muted-foreground [&_button]:transition-colors [&_button]:hover:bg-white/5 [&_button]:disabled:pointer-events-none [&_button]:disabled:opacity-40">
            {leftActions}
          </div>
        )}

        {multiline ? (
          <textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className={cn(
              "min-h-8 max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm font-light leading-5 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
              compact && "py-1 text-xs"
            )}
            rows={1}
            autoComplete="off"
          />
        ) : (
          <input
            ref={inputRef as React.Ref<HTMLInputElement>}
            placeholder={placeholder}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className={cn(
              "h-8 flex-1 bg-transparent px-1 text-sm font-light text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
              compact && "text-xs"
            )}
            autoComplete="off"
          />
        )}

        {showSendButton ? (
          <button
            className={cn(
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-45",
              compact && "h-8 w-8"
            )}
            onClick={onSend}
            disabled={!value.trim() || disabled || isSending}
            type="button"
          >
            {isSending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendIcon className="h-4 w-4" />
            )}
          </button>
        ) : (
          <div className="flex h-9 shrink-0 items-center gap-1 [&_button]:inline-flex [&_button]:h-9 [&_button]:w-9 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-[6px] [&_button]:text-muted-foreground [&_button]:transition-colors [&_button]:hover:bg-white/5 [&_button]:disabled:pointer-events-none [&_button]:disabled:opacity-40">
            {rightActions}
          </div>
        )}
      </div>
    );
  }
);

MessageBox.displayName = "MessageBox";

export { FileUploadIcon, SendIcon };
