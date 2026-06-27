import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

type WhatsAppRealtimeMessage = {
  from_me?: boolean | null;
  created_at?: string | null;
};

type WebkitAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export function useWhatsAppSound() {
  const { user, organization } = useAuth();
  const lastPlayedRef = useRef<number>(0);
  const notifyAfterRef = useRef<number>(0);
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!user?.id || !organization?.id) return;
    notifyAfterRef.current = Date.now();

    const isFreshRealtimeInsert = (createdAt?: string | null) => {
      if (!createdAt) return true;
      const createdTime = Date.parse(createdAt);
      if (Number.isNaN(createdTime)) return true;
      return createdTime >= notifyAfterRef.current - 5000;
    };

    const playPopSound = () => {
      try {
        const AudioContextConstructor = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
        if (!AudioContextConstructor) return;

        const audioContext = audioContextRef.current ?? new AudioContextConstructor();
        audioContextRef.current = audioContext;

        if (audioContext.state === "suspended") {
          void audioContext.resume();
        }

        const now = audioContext.currentTime;
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.type = "triangle";
        oscillator.frequency.setValueAtTime(760, now);
        oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.12);

        gainNode.gain.setValueAtTime(0.0001, now);
        gainNode.gain.linearRampToValueAtTime(0.035, now + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.18);
      } catch {
        // Audio is optional.
      }
    };

    const onMessageInsert = (event: Event) => {
      const message = (event as CustomEvent<WhatsAppRealtimeMessage>).detail;
      if (!message || message.from_me) return;
      if (!isFreshRealtimeInsert(message.created_at)) return;

      const now = Date.now();
      if (now - lastPlayedRef.current < 1500) return;
      lastPlayedRef.current = now;

      playPopSound();
    };

    window.addEventListener("vimob:whatsapp-message-insert", onMessageInsert);

    return () => {
      window.removeEventListener("vimob:whatsapp-message-insert", onMessageInsert);
    };
  }, [user?.id, organization?.id]);
}
