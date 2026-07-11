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
    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const fieldRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

    React.useImperativeHandle(inputRef, () => fieldRef.current as HTMLInputElement | HTMLTextAreaElement);

    const resizeTextarea = React.useCallback((element: HTMLTextAreaElement | null) => {
      if (!element) return;
      element.style.height = "auto";
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
    }, []);

    const setTextareaRef = React.useCallback((element: HTMLTextAreaElement | null) => {
      textareaRef.current = element;
      fieldRef.current = element;
    }, []);

    const setInputElementRef = React.useCallback((element: HTMLInputElement | null) => {
      fieldRef.current = element;
    }, []);

    React.useLayoutEffect(() => {
      if (multiline) resizeTextarea(textareaRef.current);
    }, [multiline, resizeTextarea, value]);

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
          "flex min-h-[46px] w-full items-center gap-2 rounded-[8px] bg-[var(--app-surface-hover)] px-2 py-2 text-sm text-[var(--app-text-primary)] shadow-none outline-none transition-[background-color,min-height] duration-200 focus-within:bg-[var(--app-surface-hover)] focus-within:outline-none",
          compact && "min-h-[42px] px-2 py-1.5",
          disabled && "!bg-[var(--app-surface-hover)] !text-[var(--app-text-tertiary)]",
          className
        )}
      >
        {leftActions && (
          <div className="flex h-8 shrink-0 items-center gap-1 [&_button]:inline-flex [&_button]:h-8 [&_button]:w-8 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-[6px] [&_button]:text-[var(--app-text-tertiary)] [&_button]:transition-colors [&_button]:hover:bg-[var(--app-surface-muted)] [&_button]:hover:text-[var(--app-text-primary)] [&_button]:disabled:pointer-events-none [&_button]:disabled:opacity-45">
            {leftActions}
          </div>
        )}

        {multiline ? (
          <textarea
            ref={setTextareaRef}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              resizeTextarea(e.target);
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className={cn(
              "min-h-8 max-h-32 flex-1 resize-none overflow-y-auto !bg-transparent px-1 py-1.5 text-[13px] font-light leading-5 text-current outline-none [scrollbar-width:none] [-ms-overflow-style:none] placeholder:text-[11px] placeholder:leading-5 placeholder:text-[var(--app-text-tertiary)] disabled:cursor-not-allowed disabled:text-current disabled:opacity-100 [&::-webkit-scrollbar]:hidden",
              compact && "min-h-8 py-1.5 text-xs leading-5 placeholder:text-[10.5px]",
              disabled && "overflow-hidden"
            )}
            rows={1}
            autoComplete="off"
          />
        ) : (
          <input
            ref={setInputElementRef}
            placeholder={placeholder}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className={cn(
              "h-8 flex-1 !bg-transparent px-1 text-[13px] font-light leading-8 text-current outline-none placeholder:text-[11px] placeholder:text-[var(--app-text-tertiary)] disabled:cursor-not-allowed disabled:text-current disabled:opacity-100",
              compact && "h-8 text-xs placeholder:text-[10.5px]"
            )}
            autoComplete="off"
          />
        )}

        {showSendButton ? (
          <button
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-[#FF4529] text-white transition-colors hover:bg-[#ff5a42] disabled:pointer-events-none disabled:opacity-40",
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
          <div className="flex h-8 shrink-0 items-center gap-1 [&_button]:inline-flex [&_button]:h-8 [&_button]:w-8 [&_button]:items-center [&_button]:justify-center [&_button]:rounded-[6px] [&_button]:text-[var(--app-text-tertiary)] [&_button]:transition-colors [&_button]:hover:bg-[var(--app-surface-muted)] [&_button]:hover:text-[var(--app-text-primary)] [&_button]:disabled:pointer-events-none [&_button]:disabled:opacity-45">
            {rightActions}
          </div>
        )}
      </div>
    );
  }
);

MessageBox.displayName = "MessageBox";

export { FileUploadIcon, SendIcon };
