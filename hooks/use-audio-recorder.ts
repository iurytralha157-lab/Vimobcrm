import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface AudioRecorderState {
  contextKey: string;
  generation: number;
  isAcquiring: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  duration: number;
  audioBlob: Blob | null;
  base64: string | null;
  mimeType: string | null;
  error: string | null;
}
const emptyRecording = (contextKey: string, generation = 0): AudioRecorderState => ({
  contextKey, generation, isAcquiring: false, isRecording: false, isProcessing: false,
  duration: 0, audioBlob: null, base64: null, mimeType: null, error: null,
});
export function supportedRecordingMimeType(isSupported: (mime: string) => boolean): string | undefined {
  return ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4", "audio/webm"]
    .find((mime) => isSupported(mime));
}
/** Every acquisition and recorded blob belongs to the original composer identity. */
export function useAudioRecorder(contextKey: string) {
  const [currentScope, setCurrentScope] = useState({ contextKey, generation: 0 });
  if (currentScope.contextKey !== contextKey) setCurrentScope({ contextKey, generation: currentScope.generation + 1 });
  const [state, setState] = useState(() => emptyRecording(contextKey));
  const scopeRef = useRef(contextKey);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const acquisitionRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const readerRef = useRef<FileReader | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);

  const releaseResources = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const reader = readerRef.current;
    readerRef.current = null;
    if (reader) {
      reader.onloadend = null;
      reader.onerror = null;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state !== "inactive") recorder.stop();
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    acquisitionRef.current = null;
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = true;
    scopeRef.current = contextKey;
    generationRef.current += 1;
    releaseResources();
    const generation = generationRef.current;
    queueMicrotask(() => {
      if (mountedRef.current && generationRef.current === generation) setState(emptyRecording(contextKey, currentScope.generation));
    });
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      releaseResources();
    };
  }, [contextKey, currentScope.generation, releaseResources]);

  const cancelRecording = useCallback(() => {
    generationRef.current += 1;
    releaseResources();
    setState(emptyRecording(scopeRef.current, currentScope.generation));
  }, [currentScope.generation, releaseResources]);

  const startRecording = useCallback(async () => {
    if (!mountedRef.current || acquisitionRef.current !== null || recorderRef.current) return false;
    const generation = ++generationRef.current;
    const scopeGeneration = currentScope.generation;
    const originalScope = scopeRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation
      && scopeRef.current === originalScope;
    acquisitionRef.current = generation;
    setState({ ...emptyRecording(originalScope, scopeGeneration), isAcquiring: true });
    let acquiredStream: MediaStream | null = null;
    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 },
      });
      if (!isCurrent()) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return false;
      }
      const requestedMime = supportedRecordingMimeType((mime) => MediaRecorder.isTypeSupported(mime));
      // Let the browser choose its supported default if no known codec matches.
      const recorder = new MediaRecorder(acquiredStream, {
        ...(requestedMime ? { mimeType: requestedMime } : {}), audioBitsPerSecond: 128000,
      });
      streamRef.current = acquiredStream;
      recorderRef.current = recorder;
      const mimeType = recorder.mimeType || requestedMime || "application/octet-stream";
      const startedAt = Date.now();
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
        if (isCurrent() && event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        acquiredStream?.getTracks().forEach((track) => track.stop());
        if (recorderRef.current === recorder) recorderRef.current = null;
        if (streamRef.current === acquiredStream) streamRef.current = null;
        if (!isCurrent()) return;
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        setState((previous) => ({ ...previous, isRecording: false, isProcessing: true,
          duration: Math.floor((Date.now() - startedAt) / 1000) }));
        if (!chunks.length) {
          setState({ ...emptyRecording(originalScope, scopeGeneration), error: "A gravação ficou vazia. Grave novamente." });
          return;
        }
        const blob = new Blob(chunks, { type: mimeType });
        const reader = new FileReader();
        readerRef.current = reader;
        reader.onloadend = () => {
          if (!isCurrent() || readerRef.current !== reader) return;
          readerRef.current = null;
          const base64 = typeof reader.result === "string" ? reader.result.split(",")[1] : null;
          setState((previous) => ({ ...previous, isRecording: false, isProcessing: false,
            audioBlob: base64 ? blob : null, base64: base64 || null, mimeType,
            error: base64 ? null : "Não foi possível preparar o áudio. Grave novamente." }));
        };
        reader.onerror = () => {
          if (!isCurrent() || readerRef.current !== reader) return;
          readerRef.current = null;
          setState({ ...emptyRecording(originalScope, scopeGeneration), error: "Não foi possível preparar o áudio. Grave novamente." });
        };
        reader.readAsDataURL(blob);
      };
      recorder.onerror = () => {
        if (!isCurrent()) return;
        generationRef.current += 1;
        releaseResources();
        setState({ ...emptyRecording(originalScope, scopeGeneration),
          error: "Não foi possível concluir a gravação. Grave novamente." });
      };
      recorder.start(100);
      timerRef.current = window.setInterval(() => {
        if (isCurrent()) setState((previous) => ({ ...previous, duration: Math.floor((Date.now() - startedAt) / 1000) }));
      }, 250);
      setState({ ...emptyRecording(originalScope, scopeGeneration), isRecording: true, mimeType });
      return true;
    } catch (error) {
      acquiredStream?.getTracks().forEach((track) => track.stop());
      if (!isCurrent()) return false;
      releaseResources();
      setState(emptyRecording(originalScope, scopeGeneration));
      throw error;
    } finally {
      if (acquisitionRef.current === generation) acquisitionRef.current = null;
    }
  }, [currentScope.generation, releaseResources]);

  const stopRecording = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    setState((previous) => ({ ...previous, isRecording: false, isProcessing: true }));
    recorder.stop();
  }, []);

  const scopedState = state.contextKey === contextKey && state.generation === currentScope.generation ? state : emptyRecording(contextKey, currentScope.generation);
  useEffect(() => () => { generationRef.current += 1; releaseResources(); }, [releaseResources]);
  const formatDuration = useCallback((seconds: number) => {
    const duration = Math.max(0, Math.floor(seconds));
    return `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;
  }, []);
  return { ...scopedState, startRecording, stopRecording, cancelRecording,
    clearRecording: cancelRecording, formatDuration };
}
