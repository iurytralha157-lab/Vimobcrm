type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

let context: AudioContext | null = null;
const readyListeners = new Set<() => void>();
const preferenceEvent = 'vimob:new-lead-sound-preference';
const preferencePrefix = 'vimob:new-lead-sound:muted:v1:';
const temporaryPreferences = new Map<string, boolean>();

export function isNewLeadAudioReady(): boolean {
  return context?.state === 'running';
}

export function subscribeNewLeadAudio(listener: () => void) {
  readyListeners.add(listener);
  return () => { readyListeners.delete(listener); };
}

/** Call from an interaction; rejected or blocked audio never blocks the CRM. */
export async function activateNewLeadAudio(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!context || context.state === 'closed') {
      const Constructor = window.AudioContext || (window as AudioWindow).webkitAudioContext;
      if (!Constructor) return false;
      context = new Constructor();
      context.onstatechange = () => readyListeners.forEach((listener) => listener());
    }
    const audio = context;
    if (audio.state !== 'running') {
      await Promise.race([
        audio.resume(),
        new Promise<void>((resolve) => { timeout = setTimeout(resolve, 1500); }),
      ]);
    }
    readyListeners.forEach((listener) => listener());
    return isNewLeadAudioReady();
  } catch {
    return false;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Play two notes and acknowledge completion in the current audio context. */
export async function playNewLeadAudio(): Promise<boolean> {
  const audio = context;
  if (!audio || audio.state !== 'running') return false;

  return new Promise((resolve) => {
    const start = audio.currentTime;
    const frequencies = [880, 1046.5];
    const nodes: AudioNode[] = [];
    const finish = (played: boolean) => {
      clearTimeout(deadline);
      for (const node of nodes.splice(0)) node.disconnect();
      resolve(played);
    };
    // A suspended context may never finish its scheduled notes. Disconnect
    // their output so an interrupted test does not sound after a later resume.
    const deadline = setTimeout(() => finish(false), 1500);

    try {
      for (const [index, frequency] of frequencies.entries()) {
        const oscillator = audio.createOscillator();
        nodes.push(oscillator);
        const gain = audio.createGain();
        nodes.push(gain);
        const at = start + index * 0.17;
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.linearRampToValueAtTime(0.18, at + 0.015);
        gain.gain.setValueAtTime(0.18, at + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.22);
        oscillator.connect(gain);
        gain.connect(audio.destination);
        if (index === frequencies.length - 1) {
          oscillator.onended = () => finish(context === audio && audio.state === 'running');
        }
        oscillator.start(at);
        oscillator.stop(at + 0.24);
      }
    } catch {
      finish(false);
    }
  });
}

export function isNewLeadSoundMuted(userId: string): boolean {
  if (!userId || typeof window === 'undefined') return true;
  if (temporaryPreferences.has(userId)) return temporaryPreferences.get(userId)!;
  try {
    const stored = window.localStorage.getItem(preferencePrefix + userId);
    return stored !== null && stored !== 'false';
  } catch {
    // Storage-denied tabs stay quiet until explicitly enabled in that tab.
    return true;
  }
}

export function setNewLeadSoundMuted(userId: string, muted: boolean): void {
  if (!userId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(preferencePrefix + userId, String(muted));
    temporaryPreferences.delete(userId);
  } catch {
    temporaryPreferences.set(userId, muted);
  }
  window.dispatchEvent(new Event(preferenceEvent));
}

export function subscribeNewLeadSoundPreference(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(preferencePrefix)) return;
    temporaryPreferences.clear();
    listener();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(preferenceEvent, listener);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(preferenceEvent, listener);
  };
}
