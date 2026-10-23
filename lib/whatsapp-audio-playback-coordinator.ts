type PlayableAudio = { pause(): void };
let activeAudio: PlayableAudio | null = null;

/** Local tab coordination only; contains no message, tenant or user data. */
export function claimMessageAudio(audio: PlayableAudio) {
  const previous = activeAudio;
  activeAudio = audio;
  if (previous && previous !== audio) previous.pause();
}

export function releaseMessageAudio(audio: PlayableAudio) {
  if (activeAudio === audio) activeAudio = null;
}
