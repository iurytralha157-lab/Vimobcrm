import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Mic, Square, X, Send, Loader2, RefreshCw, Play, Pause } from "lucide-react";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { cn } from "@/lib/utils";
import { createClientId } from "@/lib/client-id";
import { getWhatsAppSendFailureStatus } from "@/lib/whatsapp-query-cache";
import { toast } from "@/hooks/use-toast";
import { claimMessageAudio, releaseMessageAudio } from "./message-bubble/audio-playback-coordinator";

export type AudioRecorderSendContext = { clientMessageId: string; contextKey: string };
export type AudioRecorderSendResult = boolean | void | {
  state: "queued" | "confirmed" | "unconfirmed" | "cancelled";
  clientMessageId?: string;
};
export interface AudioRecorderButtonProps {
  onSend: (base64: string, mimetype: string, context: AudioRecorderSendContext) => Promise<AudioRecorderSendResult>;
  contextKey: string;
  onActiveChange?: (active: boolean) => void;
  onResolveUnconfirmed?: (clientMessageId: string) => Promise<"pending" | "accepted" | "failed" | "cancelled">;
  disabled?: boolean;
  className?: string;
}
const MAX_RECORDING_SECONDS = 4 * 60;
const MAX_RECORDING_BYTES = 5 * 1024 * 1024;

export function AudioRecorderButton({ onSend, contextKey, onActiveChange,
  onResolveUnconfirmed, disabled, className }: AudioRecorderButtonProps) {
  const recording = useAudioRecorder(contextKey);
  const [currentScope, setCurrentScope] = useState({ contextKey, generation: 0 });
  if (currentScope.contextKey !== contextKey) setCurrentScope({ contextKey, generation: currentScope.generation + 1 });
  const { isAcquiring, isRecording, isProcessing, duration, base64, audioBlob, mimeType,
    startRecording, stopRecording, cancelRecording, clearRecording, formatDuration } = recording;
  const [delivery, setDelivery] = useState<{ contextKey: string; generation: number; clientMessageId: string; state: "sending" | "unconfirmed" | "checking" } | null>(null);
  const deliveryRef = useRef(delivery);
  const generationRef = useRef(0);
  const currentContextRef = useRef(contextKey);
  const activeCallbackRef = useRef(onActiveChange);
  const previewRef = useRef<HTMLAudioElement>(null);
  const [previewUrl, setPreviewUrl] = useState<{ blob: Blob; url: string } | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const currentDelivery = delivery?.contextKey === contextKey && delivery.generation === currentScope.generation ? delivery : null;
  const isSending = currentDelivery?.state === "sending";
  const isUnconfirmed = currentDelivery?.state === "unconfirmed" || currentDelivery?.state === "checking";
  const active = isAcquiring || isRecording || isProcessing || Boolean(base64) || Boolean(currentDelivery);

  useLayoutEffect(() => {
    currentContextRef.current = contextKey;
    deliveryRef.current = null;
    generationRef.current += 1;
    const generation = generationRef.current;
    queueMicrotask(() => { if (generationRef.current === generation) setDelivery(null); });
    return () => { generationRef.current += 1; };
  }, [contextKey]);
  useLayoutEffect(() => { activeCallbackRef.current = onActiveChange; }, [onActiveChange]);
  useEffect(() => {
    activeCallbackRef.current?.(active);
    return () => { activeCallbackRef.current?.(false); };
  }, [active]);
  useEffect(() => {
    if (!isRecording || duration < MAX_RECORDING_SECONDS) return;
    stopRecording();
    toast({ title: "Limite da gravação atingido", description: "O áudio foi encerrado em 4 minutos para permitir o envio." });
  }, [duration, isRecording, stopRecording]);
  useEffect(() => {
    if (disabled && (isAcquiring || isRecording || isProcessing)) cancelRecording();
  }, [cancelRecording, disabled, isAcquiring, isProcessing, isRecording]);
  useEffect(() => {
    if (!audioBlob) return;
    const url = URL.createObjectURL(audioBlob);
    let cancelled = false;
    // The object belongs to this exact blob; old previews are never reused.
    queueMicrotask(() => { if (!cancelled) setPreviewUrl({ blob: audioBlob, url }); });
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [audioBlob]);
  useLayoutEffect(() => {
    const audio = previewRef.current;
    return () => { if (audio) { audio.pause(); releaseMessageAudio(audio); } };
  }, [contextKey, previewUrl?.url]);

  const handleStartRecording = async () => {
    if (disabled || deliveryRef.current?.contextKey === contextKey) return;
    try { await startRecording(); }
    catch {
      toast({ title: "Erro ao gravar áudio", description: "Verifique se o microfone está disponível e permitido.", variant: "destructive" });
    }
  };
  const handleDiscard = () => {
    generationRef.current += 1;
    deliveryRef.current = null;
    setDelivery(null);
    previewRef.current?.pause();
    setIsPreviewPlaying(false);
    clearRecording();
  };
  const handleSendAudio = async () => {
    if (!base64 || disabled || recording.contextKey !== contextKey
      || deliveryRef.current?.contextKey === contextKey) return;
    if ((audioBlob?.size || 0) > MAX_RECORDING_BYTES) {
      toast({ title: "Áudio muito grande", description: "Grave um áudio menor para enviar pelo WhatsApp.", variant: "destructive" });
      return;
    }
    const generation = generationRef.current;
    const originalContext = contextKey;
    const request: NonNullable<typeof delivery> = { contextKey, generation: currentScope.generation, clientMessageId: createClientId("message"), state: "sending" };
    const isCurrent = () => generation === generationRef.current && currentContextRef.current === originalContext;
    deliveryRef.current = request;
    setDelivery(request);
    previewRef.current?.pause();
    try {
      const result = await onSend(base64, mimeType || audioBlob?.type || "audio/webm",
        { clientMessageId: request.clientMessageId, contextKey: originalContext });
      if (!isCurrent()) return;
      if (typeof result === "object" && result?.state === "unconfirmed") {
        const pending = { ...request, clientMessageId: result.clientMessageId || request.clientMessageId, state: "unconfirmed" as const };
        deliveryRef.current = pending;
        setDelivery(pending);
        return;
      }
      deliveryRef.current = null;
      setDelivery(null);
      if (result !== false && !(typeof result === "object" && result?.state === "cancelled")) clearRecording();
    } catch (error) {
      if (!isCurrent()) return;
      if (getWhatsAppSendFailureStatus(error) === "confirming") {
        const pending = { ...request, state: "unconfirmed" as const };
        deliveryRef.current = pending;
        setDelivery(pending);
        toast({ title: "Confirmando envio do áudio", description: "Confira o envio antes de tentar novamente." });
      } else {
        deliveryRef.current = null;
        setDelivery(null);
        toast({ title: "Áudio não enviado", description: "A gravação foi preservada. Confira a conexão antes de tentar novamente.", variant: "destructive" });
      }
    }
  };
  const checkDelivery = async () => {
    if (!currentDelivery || !onResolveUnconfirmed || currentDelivery.state === "checking") return;
    const generation = generationRef.current;
    const request = { ...currentDelivery, state: "checking" as const };
    deliveryRef.current = request;
    setDelivery(request);
    try {
      const result = await onResolveUnconfirmed(request.clientMessageId);
      if (generation !== generationRef.current || currentContextRef.current !== request.contextKey) return;
      if (result === "accepted" || result === "failed" || result === "cancelled") {
        deliveryRef.current = null;
        setDelivery(null);
        if (result === "accepted" || result === "cancelled") clearRecording();
        else toast({ title: "Falha de envio confirmada", description: "Você pode enviar a gravação como uma nova mensagem." });
        return;
      }
    } catch { /* An unavailable read never authorizes another send. */ }
    if (generation === generationRef.current && currentContextRef.current === request.contextKey) {
      const pending = { ...request, state: "unconfirmed" as const };
      deliveryRef.current = pending;
      setDelivery(pending);
    }
  };
  const previewAudio = async () => {
    const audio = previewRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    const generation = generationRef.current;
    const originalContext = currentContextRef.current;
    const isCurrent = () => generationRef.current === generation && currentContextRef.current === originalContext
      && previewRef.current === audio;
    try { claimMessageAudio(audio); await audio.play(); if (!isCurrent()) { audio.pause(); releaseMessageAudio(audio); } }
    catch {
      releaseMessageAudio(audio);
      if (!isCurrent()) { audio.pause(); return; }
      toast({ title: "Prévia indisponível", description: "Este navegador não conseguiu reproduzir a gravação." });
    }
  };

  if (isAcquiring || isProcessing) return (
    <div className={cn("flex items-center gap-2", className)} role="status" aria-live="polite">
      <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      <span className="text-xs">{isAcquiring ? "Aguardando microfone" : "Preparando áudio"}</span>
      <Button variant="ghost" size="icon" onClick={cancelRecording} aria-label="Cancelar gravação"><X className="h-4 w-4" /></Button>
    </div>
  );
  if (isRecording) return (
    <div className={cn("flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1.5", className)}>
      <span className="text-sm text-destructive" role="timer" aria-label="Duração da gravação">{formatDuration(duration)}</span>
      <Button variant="ghost" size="icon" onClick={cancelRecording} aria-label="Cancelar gravação"><X className="h-4 w-4" /></Button>
      <Button size="icon" onClick={stopRecording} aria-label="Parar gravação"><Square className="h-3 w-3 fill-current" /></Button>
    </div>
  );
  if (base64 || isUnconfirmed) return (
    <div className={cn("flex max-w-full flex-wrap items-center gap-2 rounded-lg bg-primary/10 px-2 py-1.5", className)}>
      <span className="text-xs text-primary" role="status">{isUnconfirmed ? "Áudio aguardando confirmação. Não reenvie." : "Áudio gravado"}</span>
      {audioBlob && previewUrl?.blob === audioBlob && (
        <>
          <audio ref={previewRef} src={previewUrl.url} onPlay={(event) => { claimMessageAudio(event.currentTarget); setIsPreviewPlaying(true); }} onPause={(event) => { releaseMessageAudio(event.currentTarget); setIsPreviewPlaying(false); }} onEnded={(event) => { releaseMessageAudio(event.currentTarget); setIsPreviewPlaying(false); }} />
          <Button variant="ghost" size="icon" onClick={() => void previewAudio()} aria-label={isPreviewPlaying ? "Pausar prévia do áudio" : "Ouvir áudio gravado"}>
            {isPreviewPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          </Button>
        </>
      )}
      <Button variant="ghost" size="icon" onClick={handleDiscard} disabled={isSending} aria-label="Descartar áudio gravado"><X className="h-4 w-4" /></Button>
      {isUnconfirmed ? onResolveUnconfirmed && (
        <Button variant="ghost" size="icon" onClick={() => void checkDelivery()} disabled={currentDelivery?.state === "checking"} aria-label="Verificar confirmação do áudio">
          {currentDelivery?.state === "checking" ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      ) : (
        <Button size="icon" onClick={() => void handleSendAudio()} disabled={isSending || disabled} aria-label="Enviar áudio gravado">
          {isSending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Send className="h-4 w-4" />}
        </Button>
      )}
    </div>
  );
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className={cn("h-8 w-8 shrink-0", className)} onClick={() => void handleStartRecording()} disabled={disabled} title="Gravar áudio" aria-label="Gravar áudio"><Mic className="h-4 w-4" /></Button>
      {recording.error && <span role="alert" className="text-xs text-destructive">{recording.error}</span>}
    </div>
  );
}
