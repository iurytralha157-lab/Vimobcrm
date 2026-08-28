"use client";

import { useEffect, useRef } from "react";

const VIDEO_SOURCE = "/videos/login-hero.mp4";
const POSTER_SOURCE = "/images/login-hero-poster.jpg";
const DESKTOP_QUERY = "(min-width: 1024px)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
const REDUCED_DATA_QUERY = "(prefers-reduced-data: reduce)";

type NavigatorWithConnection = Navigator & {
  connection?: EventTarget & {
    saveData?: boolean;
  };
};

export function LoginHeroMedia() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const desktop = window.matchMedia(DESKTOP_QUERY);
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const reducedData = window.matchMedia(REDUCED_DATA_QUERY);
    const connection = (navigator as NavigatorWithConnection).connection;

    const syncPlayback = () => {
      if (!desktop.matches) {
        video.pause();
        video.removeAttribute("poster");
        if (video.hasAttribute("src")) {
          video.removeAttribute("src");
          video.load();
        }
        return;
      }

      if (video.getAttribute("poster") !== POSTER_SOURCE) {
        video.setAttribute("poster", POSTER_SOURCE);
      }

      const canLoadVideo =
        !reducedMotion.matches && !reducedData.matches && !connection?.saveData;

      if (!canLoadVideo) {
        video.pause();
        if (video.hasAttribute("src")) {
          video.removeAttribute("src");
          video.load();
        }
        return;
      }

      if (video.getAttribute("src") !== VIDEO_SOURCE) {
        video.src = VIDEO_SOURCE;
        video.load();
      }

      if (document.visibilityState === "hidden") {
        video.pause();
        return;
      }

      void video.play().catch(() => {
        // The poster remains visible when a browser blocks autoplay.
      });
    };

    desktop.addEventListener("change", syncPlayback);
    reducedMotion.addEventListener("change", syncPlayback);
    reducedData.addEventListener("change", syncPlayback);
    connection?.addEventListener("change", syncPlayback);
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();

    return () => {
      desktop.removeEventListener("change", syncPlayback);
      reducedMotion.removeEventListener("change", syncPlayback);
      reducedData.removeEventListener("change", syncPlayback);
      connection?.removeEventListener("change", syncPlayback);
      document.removeEventListener("visibilitychange", syncPlayback);

      video.pause();
      video.removeAttribute("src");
      video.removeAttribute("poster");
      video.load();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      preload="none"
      autoPlay
      muted
      loop
      playsInline
      onEnded={(event) => {
        const video = event.currentTarget;
        video.currentTime = 0;

        if (document.visibilityState !== "hidden") {
          void video.play().catch(() => {
            // The poster remains visible when a browser blocks replay.
          });
        }
      }}
      aria-hidden="true"
      tabIndex={-1}
      className="absolute inset-0 h-full w-full rounded-[inherit] object-cover object-center"
    />
  );
}
