"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { whatsappCallsAPI } from "@/lib/api/whatsapp-calls";
import { assertWhatsAppCallMediaDestination } from "@/lib/whatsapp-call-media-destination";

type AudioBridge = {
  callId: string;
  stream: MediaStream;
  context: AudioContext;
  socket: WebSocket;
  input: AudioWorkletNode;
};

type PendingBridge = {
  stream?: MediaStream;
  context?: AudioContext;
  socket?: WebSocket;
  cancelOpen?: () => void;
};

function encodePCM(samples: Float32Array): ArrayBuffer {
  const result = new ArrayBuffer(samples.length * 2);
  const view = new DataView(result);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(index * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
  }
  return result;
}

function playPCM(context: AudioContext, packet: ArrayBuffer, nextTime: { current: number }) {
  if (packet.byteLength !== 1920) return;
  const view = new DataView(packet);
  const now = context.currentTime;
  if (nextTime.current > now + 0.36) return;
  const buffer = context.createBuffer(1, 960, 16000);
  const samples = buffer.getChannelData(0);
  for (let index = 0; index < 960; index += 1) {
    samples[index] = view.getInt16(index * 2, true) / 32768;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  if (nextTime.current < now) {
    nextTime.current = now + 0.09;
  }
  source.start(nextTime.current);
  nextTime.current += 0.06;
}

export function useWhatsAppCallAudio() {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const bridgeRef = useRef<AudioBridge | null>(null);
  const pendingRef = useRef<PendingBridge>({});
  const generationRef = useRef(0);
  const nextPlaybackTime = useRef(0);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    generationRef.current += 1;
    const bridge = bridgeRef.current;
    bridgeRef.current = null;
    const pending = pendingRef.current;
    pendingRef.current = {};
    pending.cancelOpen?.();
    pending.socket?.close();
    pending.stream?.getTracks().forEach((track) => track.stop());
    if (pending.context) void pending.context.close();
    if (bridge) {
      bridge.socket.onclose = null;
      bridge.socket.onerror = null;
      bridge.socket.close();
      bridge.input.port.onmessage = null;
      bridge.input.disconnect();
      bridge.stream.getTracks().forEach((track) => track.stop());
      void bridge.context.close();
    }
    nextPlaybackTime.current = 0;
    setStatus("disconnected");
  }, []);

  const connect = useCallback(async (callId: string) => {
    if (!organizationId) throw new Error("Organização indisponível");
    if (bridgeRef.current?.callId === callId && bridgeRef.current.socket.readyState === WebSocket.OPEN) return;
    stop();
    const generation = generationRef.current;
    const assertCurrent = () => {
      if (generation !== generationRef.current) throw new Error("Conexão de áudio cancelada");
    };
    setError(null);
    setStatus("connecting");

    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let socket: WebSocket | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      assertCurrent();
      pendingRef.current.stream = stream;
      context = new AudioContext();
      pendingRef.current.context = context;
      await context.audioWorklet.addModule("/audio-worklets/whatsapp-call-input.js");
      assertCurrent();
      await context.resume();
      assertCurrent();
      const input = new AudioWorkletNode(context, "whatsapp-call-input");
      const source = context.createMediaStreamSource(stream);
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(input).connect(silent).connect(context.destination);

      const ticket = await whatsappCallsAPI.mediaTicket(callId, organizationId);
      assertCurrent();
      assertWhatsAppCallMediaDestination(
        ticket.url,
        process.env.NEXT_PUBLIC_EVOLUTION_GO_CALL_MEDIA_HOST,
        process.env.NEXT_PUBLIC_EVOLUTION_GO_CALL_MEDIA_HOSTS,
      );
      socket = new WebSocket(ticket.url);
      pendingRef.current.socket = socket;
      socket.binaryType = "arraybuffer";
      await new Promise<void>((resolve, reject) => {
        const opening = socket!;
        const timeout = window.setTimeout(() => finish(new Error("Tempo esgotado ao conectar o áudio")), 10000);
        const finish = (error?: Error) => {
          window.clearTimeout(timeout);
          opening.removeEventListener("open", onOpen);
          opening.removeEventListener("error", onError);
          opening.removeEventListener("close", onClose);
          if (error) reject(error);
          else resolve();
        };
        const onOpen = () => finish();
        const onError = () => finish(new Error("Não foi possível conectar o áudio da ligação"));
        const onClose = () => finish(new Error("Ponte de áudio encerrada antes da conexão"));
        opening.addEventListener("open", onOpen);
        opening.addEventListener("error", onError);
        opening.addEventListener("close", onClose);
        pendingRef.current.cancelOpen = () => finish(new Error("Conexão de áudio cancelada"));
      });
      assertCurrent();

      const bridge: AudioBridge = { callId, stream, context, socket, input };
      bridgeRef.current = bridge;
      pendingRef.current = {};
      input.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (bridgeRef.current !== bridge || socket!.readyState !== WebSocket.OPEN) return;
        if (socket!.bufferedAmount > 1920 * 8) return;
        socket!.send(encodePCM(event.data));
      };
      socket.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        if (bridgeRef.current !== bridge || !(event.data instanceof ArrayBuffer)) return;
        playPCM(context!, event.data, nextPlaybackTime);
      };
      socket.onclose = () => {
        if (bridgeRef.current !== bridge) return;
        stop();
        setError("Áudio desconectado. Reconecte para continuar a ligação.");
      };
      socket.onerror = () => {
        if (bridgeRef.current !== bridge) return;
        setError("Falha na ponte de áudio da ligação");
      };
      setStatus("connected");
    } catch (cause) {
      socket?.close();
      stream?.getTracks().forEach((track) => track.stop());
      if (context) void context.close();
      if (generation !== generationRef.current) throw cause;
      pendingRef.current = {};
      setStatus("disconnected");
      const message = cause instanceof Error ? cause.message : "Não foi possível iniciar o áudio";
      setError(message);
      throw cause;
    }
  }, [organizationId, stop]);

  useEffect(() => {
    queueMicrotask(stop);
  }, [organizationId, stop]);

  useEffect(() => () => {
    generationRef.current += 1;
    const pending = pendingRef.current;
    pendingRef.current = {};
    pending.socket?.close();
    pending.stream?.getTracks().forEach((track) => track.stop());
    if (pending.context) void pending.context.close();
    const bridge = bridgeRef.current;
    bridgeRef.current = null;
    if (!bridge) return;
    bridge.socket.close();
    bridge.stream.getTracks().forEach((track) => track.stop());
    void bridge.context.close();
  }, []);

  return { connect, stop, status, error };
}
