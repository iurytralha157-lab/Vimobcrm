"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

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

export function LoginHeroMedia({
  posterSizes = "(min-width: 1024px) 58vw, 1px",
  alwaysPlay = false,
}: {
  posterSizes?: string;
  alwaysPlay?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isVideoReady, setIsVideoReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const desktop = window.matchMedia(DESKTOP_QUERY);
    const reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
    const reducedData = window.matchMedia(REDUCED_DATA_QUERY);
    const connection = (navigator as NavigatorWithConnection).connection;

    const syncPlayback = () => {
      if (!alwaysPlay && !desktop.matches) {
        setIsVideoReady(false);
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
        alwaysPlay ||
        (!reducedMotion.matches && !reducedData.matches && !connection?.saveData);

      if (!canLoadVideo) {
        setIsVideoReady(false);
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

      if (!alwaysPlay && document.visibilityState === "hidden") {
        video.pause();
        return;
      }

      void video.play().catch(() => {
        // The poster remains visible when a browser blocks autoplay.
      });
    };

    if (!alwaysPlay) {
      desktop.addEventListener("change", syncPlayback);
      reducedMotion.addEventListener("change", syncPlayback);
      reducedData.addEventListener("change", syncPlayback);
      connection?.addEventListener("change", syncPlayback);
    }
    document.addEventListener("visibilitychange", syncPlayback);
    syncPlayback();

    return () => {
      if (!alwaysPlay) {
        desktop.removeEventListener("change", syncPlayback);
        reducedMotion.removeEventListener("change", syncPlayback);
        reducedData.removeEventListener("change", syncPlayback);
        connection?.removeEventListener("change", syncPlayback);
      }
      document.removeEventListener("visibilitychange", syncPlayback);

      video.pause();
      video.removeAttribute("src");
      video.removeAttribute("poster");
      video.load();
    };
  }, [alwaysPlay]);

  return (
    <>
      <Image
        src={POSTER_SOURCE}
        alt=""
        fill
        sizes={posterSizes}
        loading="eager"
        className="object-cover object-center"
      />
      <video
        ref={videoRef}
        preload="none"
        autoPlay
        muted
        loop
        playsInline
        onTimeUpdate={(event) => {
          if (!isVideoReady && event.currentTarget.currentTime >= 0.2) {
            setIsVideoReady(true);
          }
        }}
        onEnded={(event) => {
          const video = event.currentTarget;
          video.currentTime = 0;

          if (alwaysPlay || document.visibilityState !== "hidden") {
            void video.play().catch(() => {
              // The poster remains visible when a browser blocks replay.
            });
          }
        }}
        aria-hidden="true"
        tabIndex={-1}
        className={`absolute inset-0 h-full w-full rounded-[inherit] object-cover object-center transition-opacity duration-300 ${
          isVideoReady ? "opacity-100" : "opacity-0"
        }`}
      />
    </>
  );
}
