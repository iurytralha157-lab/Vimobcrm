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

const FileUploadIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 337 337" className="w-full h-full">
    <circle strokeWidth="20" stroke="currentColor" fill="none" r="158.5" cy="168.5" cx="168.5" />
    <path strokeLinecap="round" strokeWidth="25" stroke="currentColor" d="M167.759 79V259" />
    <path strokeLinecap="round" strokeWidth="25" stroke="currentColor" d="M79 167.138H259" />
  </svg>
);

const SendIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 664 663" className="w-full h-full">
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
      <div ref={ref} className={cn("message-box", compact && "message-box--compact", className)}>
        {leftActions && (
          <div className="message-box__left-actions">
            {leftActions}
          </div>
        )}

        {multiline ? (
          <textarea
            ref={inputRef as React.Ref<HTMLTextAreaElement>}
            required
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="message-box__input message-box__textarea"
            rows={1}
            autoComplete="off"
          />
        ) : (
          <input
            ref={inputRef as React.Ref<HTMLInputElement>}
            required
            placeholder={placeholder}
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            className="message-box__input"
            autoComplete="off"
          />
        )}

        {showSendButton ? (
          <button
            className="message-box__send"
            onClick={onSend}
            disabled={!value.trim() || disabled || isSending}
            type="button"
          >
            {isSending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <SendIcon />
            )}
          </button>
        ) : (
          <div className="message-box__right-actions">
            {rightActions}
          </div>
        )}
      </div>
    );
  }
);

MessageBox.displayName = "MessageBox";

export { FileUploadIcon, SendIcon };
