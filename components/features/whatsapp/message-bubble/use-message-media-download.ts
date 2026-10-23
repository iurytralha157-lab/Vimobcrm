import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { downloadMessageMedia, type MessageMediaKind } from "../message-media";

export function useMessageMediaDownload(messageId: string, url: string | null,
  filename: string, kind: MessageMediaKind, onFailure?: () => void) {
  const identity = `${messageId}:${url || "unavailable"}`;
  const identityRef = useRef(identity);
  const generationRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ identity: string; loading: boolean; message: string | null; error: boolean }>({ identity, loading: false, message: null, error: false });
  useLayoutEffect(() => {
    identityRef.current = identity;
    generationRef.current += 1;
    controllerRef.current?.abort();
    return () => { generationRef.current += 1; controllerRef.current?.abort(); };
  }, [identity]);
  const current = state.identity === identity ? state : { identity, loading: false, message: null, error: false };
  const handleDownloadMedia = async (event?: MouseEvent) => {
    event?.stopPropagation();
    if (current.loading) return;
    if (!url) { setState({ identity, loading: false, message: "Link de mídia inválido ou indisponível.", error: true }); return; }
    const generation = ++generationRef.current;
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    const isCurrent = () => !controller.signal.aborted && generation === generationRef.current && identityRef.current === identity;
    setState({ identity, loading: true, message: null, error: false });
    try {
      const result = await downloadMessageMedia({ url, kind, filename, signal: controller.signal });
      if (isCurrent()) setState({ identity, loading: false, message: result === "opened"
        ? "Link aberto em outra aba. Confira se o download foi iniciado." : "Download iniciado.", error: false });
    } catch (error) {
      if (!isCurrent()) return;
      setState({ identity, loading: false, message: error instanceof Error ? error.message : "Não foi possível baixar esta mídia.", error: true });
      onFailure?.();
    }
  };
  const cancelDownload = () => {
    generationRef.current += 1;
    controllerRef.current?.abort();
    setState({ identity, loading: false, message: "Download cancelado.", error: false });
  };
  return { isDownloading: current.loading, downloadFeedback: current.message ? { message: current.message, error: current.error } : null, handleDownloadMedia, cancelDownload };
}
