import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import { claimMessageAudio, releaseMessageAudio } from "@/lib/whatsapp-audio-playback-coordinator";

type Position = { time: number; rate: number; volume: number; muted: boolean; resume: boolean; url: string };
type Owner = { identity: string; available: boolean };
type Source = { owner: Owner; generation: number; url: string | null };
type Runtime = { owner: Owner; active: boolean; latest: string | null; bound: string | null;
  wantsPlay: boolean; restore: Position | null; ticket: number; element: HTMLMediaElement | null };

/** Keep decoded playback through a token rotation, never through an ACL/route change. */
export function useMessagePlaybackSource(identity: string, url: string | null,
  mediaRef: RefObject<HTMLMediaElement | null>) {
  const available = Boolean(url);
  const owner = useMemo<Owner>(() => ({ identity, available }), [identity, available]);
  const [source, setSource] = useState<Source>({ owner, generation: 0, url });
  const currentSource = source.owner === owner ? source : { owner, generation: source.generation + 1, url };
  if (source.owner !== owner) setSource(currentSource);
  const runtimeRef = useRef<Runtime>({ owner, active: false, latest: url, bound: url,
    wantsPlay: false, restore: null, ticket: 0, element: null });
  useLayoutEffect(() => {
    if (runtimeRef.current.owner !== owner || !runtimeRef.current.active) {
      runtimeRef.current = { owner, active: true, latest: url, bound: currentSource.url,
        wantsPlay: false, restore: null, ticket: 0, element: mediaRef.current };
    }
    runtimeRef.current.latest = url;
    runtimeRef.current.element = mediaRef.current;
  });
  useLayoutEffect(() => {
    const runtime = runtimeRef.current;
    return () => {
      runtime.active = false; runtime.ticket++; runtime.restore = null;
      const element = runtime.element;
      if (element) { element.pause(); releaseMessageAudio(element); }
    };
  }, [owner, mediaRef]);
  const isCurrent = useCallback((element: HTMLMediaElement) => runtimeRef.current.active
    && runtimeRef.current.owner === owner && owner.available && mediaRef.current === element,
  [mediaRef, owner]);
  const adoptLatest = useCallback((element: HTMLMediaElement, resume: boolean) => {
    const runtime = runtimeRef.current;
    if (!isCurrent(element) || !runtime.latest || runtime.latest === runtime.bound) return false;
    const nextURL = runtime.latest;
    runtime.restore = { time: runtime.restore?.time ?? (Number.isFinite(element.currentTime) ? element.currentTime : 0),
      rate: runtime.restore?.rate ?? element.playbackRate, volume: runtime.restore?.volume ?? element.volume,
      muted: runtime.restore?.muted ?? element.muted, resume, url: nextURL };
    runtime.bound = nextURL; runtime.ticket++;
    setSource(previous => previous.owner === owner ? { ...previous, url: nextURL } : previous);
    return true;
  }, [isCurrent, owner]);
  useEffect(() => {
    const element = mediaRef.current;
    if (element && isCurrent(element) && element.paused) adoptLatest(element, runtimeRef.current.restore?.resume ?? false);
  }, [adoptLatest, isCurrent, mediaRef, url]);
  const onPlay = useCallback((element: HTMLMediaElement) => {
    if (!isCurrent(element)) { element.pause(); return; }
    runtimeRef.current.wantsPlay = true;
    claimMessageAudio(element);
  }, [isCurrent]);
  const onPause = useCallback((element: HTMLMediaElement) => {
    releaseMessageAudio(element);
    if (!isCurrent(element)) return;
    // A network error can emit pause before error; retain that play intent once.
    if (element.error) return;
    runtimeRef.current.wantsPlay = false;
    runtimeRef.current.ticket++;
    adoptLatest(element, false);
  }, [adoptLatest, isCurrent]);
  const onEnded = useCallback((element: HTMLMediaElement) => {
    if (!isCurrent(element)) return;
    runtimeRef.current.wantsPlay = false;
    runtimeRef.current.ticket++;
    releaseMessageAudio(element);
    adoptLatest(element, false);
  }, [adoptLatest, isCurrent]);
  const recoverRotatedSource = useCallback((element: HTMLMediaElement) => {
    if (!isCurrent(element)) return false;
    return adoptLatest(element, runtimeRef.current.wantsPlay);
  }, [adoptLatest, isCurrent]);
  const stop = useCallback((element: HTMLMediaElement) => {
    if (isCurrent(element)) {
      runtimeRef.current.wantsPlay = false;
      runtimeRef.current.restore = null;
      runtimeRef.current.ticket++;
    }
    element.pause(); releaseMessageAudio(element);
  }, [isCurrent]);
  const onLoadedMetadata = useCallback(async (element: HTMLMediaElement): Promise<"restored" | "resume_failed" | null> => {
    const runtime = runtimeRef.current;
    const position = runtime.restore;
    if (!isCurrent(element) || !position || position.url !== runtime.bound) return null;
    runtime.restore = null;
    const ticket = ++runtime.ticket;
    try {
      element.playbackRate = position.rate;
      element.volume = position.volume;
      element.muted = position.muted;
      const end = Number.isFinite(element.duration) && element.duration >= 0 ? element.duration : position.time;
      element.currentTime = Math.min(Math.max(0, position.time), end);
      if (!position.resume) return "restored";
      claimMessageAudio(element);
      await element.play();
      if (!isCurrent(element) || runtimeRef.current !== runtime || runtime.ticket !== ticket || !runtime.wantsPlay) {
        element.pause(); releaseMessageAudio(element); return null;
      }
      return "restored";
    } catch {
      releaseMessageAudio(element);
      if (!isCurrent(element) || runtimeRef.current !== runtime || runtime.ticket !== ticket) return null;
      runtime.wantsPlay = false;
      return "resume_failed";
    }
  }, [isCurrent]);
  const nativeEvents = (onRestoreFailure: () => void) => ({
    onLoadedMetadata(event: SyntheticEvent<HTMLMediaElement>) {
      const element = event.currentTarget;
      void onLoadedMetadata(element).then(result => {
        if (result === "resume_failed" && isCurrent(element)) { stop(element); onRestoreFailure(); }
      });
    },
    onPlay: (event: SyntheticEvent<HTMLMediaElement>) => onPlay(event.currentTarget),
    onPause: (event: SyntheticEvent<HTMLMediaElement>) => onPause(event.currentTarget),
    onEnded: (event: SyntheticEvent<HTMLMediaElement>) => onEnded(event.currentTarget),
  });
  return { url: currentSource.url, generation: currentSource.generation, isCurrent,
    onPlay, onPause, onEnded, onLoadedMetadata, recoverRotatedSource, stop, nativeEvents };
}
