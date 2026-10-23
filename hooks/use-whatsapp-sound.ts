import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { createWhatsAppSoundGate } from "@/lib/whatsapp-sound-message";

type WebkitAudioWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export function useWhatsAppSound() {
  const { activeOrganization, user } = useAuth();
  const audioContextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!user?.id || !activeOrganization.organizationId) return;
    const soundGate = createWhatsAppSoundGate(activeOrganization.organizationId, user.id, Date.now());

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
      const now = Date.now();
      if (!soundGate((event as CustomEvent<unknown>).detail, now)) return;

      playPopSound();
    };

    window.addEventListener("vimob:whatsapp-message-insert", onMessageInsert);
    window.addEventListener("vimob:whatsapp-message-changed", onMessageInsert);

    return () => {
      window.removeEventListener("vimob:whatsapp-message-insert", onMessageInsert);
      window.removeEventListener("vimob:whatsapp-message-changed", onMessageInsert);
    };
  }, [user?.id, activeOrganization.organizationId]);
}
