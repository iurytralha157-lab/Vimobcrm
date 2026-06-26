import { useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";

type WhatsAppRealtimeMessage = {
  from_me?: boolean | null;
  created_at?: string | null;
};

export function useWhatsAppSound() {
  const { user, organization } = useAuth();
  const lastPlayedRef = useRef<number>(0);
  const notifyAfterRef = useRef<number>(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!user?.id || !organization?.id) return;
    notifyAfterRef.current = Date.now();

    const audio = new Audio("/sounds/whatsapp-pop.mp3");
    audio.volume = 0.4;
    audio.preload = "none";
    audioRef.current = audio;

    const isFreshRealtimeInsert = (createdAt?: string | null) => {
      if (!createdAt) return true;
      const createdTime = Date.parse(createdAt);
      if (Number.isNaN(createdTime)) return true;
      return createdTime >= notifyAfterRef.current - 5000;
    };

    const onMessageInsert = (event: Event) => {
      const message = (event as CustomEvent<WhatsAppRealtimeMessage>).detail;
      if (!message || message.from_me) return;
      if (!isFreshRealtimeInsert(message.created_at)) return;

      const now = Date.now();
      if (now - lastPlayedRef.current < 1500) return;
      lastPlayedRef.current = now;

      audioRef.current?.play().catch(() => {});
    };

    window.addEventListener("vimob:whatsapp-message-insert", onMessageInsert);

    return () => {
      window.removeEventListener("vimob:whatsapp-message-insert", onMessageInsert);
      audioRef.current = null;
    };
  }, [user?.id, organization?.id]);
}
