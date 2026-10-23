import { useImperativeHandle, useRef, useState, type ComponentProps } from "react";

import { AudioRecorderButton, type AudioRecorderButtonProps } from "@/components/features/whatsapp/AudioRecorderButton";
import { MessageBox } from "@/components/ui/message-box";
import { cn } from "@/lib/utils";
import { useQuickReplyComposer } from "@/hooks/whatsapp/use-quick-reply-composer";

type ScopedMessageBoxProps = Omit<ComponentProps<typeof MessageBox>, "rightActions" | "showRightActionsWhenEmpty"> & {
  audio: Omit<AudioRecorderButtonProps, "onActiveChange">;
  showAudio?: boolean;
};

/** The recorder remains mounted while text or an accepted send changes the input. */
export function ScopedMessageBox({ audio, showAudio = true, ...props }: ScopedMessageBoxProps) {
  const fieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  useImperativeHandle(props.inputRef, () => fieldRef.current as HTMLInputElement | HTMLTextAreaElement);
  const [activeContext, setActiveContext] = useState<string | null>(null);
  const active = activeContext === audio.contextKey;
  const quickReplies = useQuickReplyComposer({ contextKey: audio.contextKey, value: props.value,
    disabled: Boolean(props.disabled || props.isSending || active), onChange: props.onChange, fieldRef, containerRef });
  const idleVisible = !props.value.trim() && !props.isSending;
  return (
    <div ref={containerRef} className="relative min-w-0" onKeyDownCapture={quickReplies.onKeyDownCapture}
      onSelectCapture={event => quickReplies.captureSelection(event.target)} onClickCapture={event => quickReplies.captureSelection(event.target)}
      onKeyUpCapture={event => quickReplies.captureSelection(event.target)} onFocusCapture={event => quickReplies.captureSelection(event.target)}>
      {quickReplies.panel}
      <MessageBox {...props} compact={props.compact ?? true} inputRef={fieldRef} onChange={quickReplies.onChange}
        leftActions={<>{props.leftActions}{quickReplies.button}</>}
        className={cn("[&>button]:rounded-[6px] [&_textarea]:min-w-0 [&_input]:min-w-0 motion-reduce:[&_.animate-spin]:animate-none", props.compact !== false && "py-[5px]", props.className)}
        showRightActionsWhenEmpty={showAudio && !props.isSending}
        rightActions={showAudio ? <span aria-hidden="true" className="inline-block h-8 w-8" /> : undefined} />
      {showAudio && <div className={active
        ? "mt-2 flex min-w-0 justify-end"
        : idleVisible ? cn("absolute right-2", props.compact !== false ? "bottom-[5px]" : "bottom-2") : "hidden"}>
        <AudioRecorderButton {...audio}
          onActiveChange={(isActive) => setActiveContext(isActive ? audio.contextKey : null)} />
      </div>}
    </div>
  );
}
