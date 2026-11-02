export const LOGIN_HERO_MESSAGE_ENDINGS = [
  'controle.',
  'organização.',
  'acompanhamento.',
  'processo.',
] as const

type AnimationMediaQuery = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>
type AnimationDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

type LoginHeroAnimationBrowser = {
  matchMedia: (query: string) => AnimationMediaQuery
  document: AnimationDocument
  setTimeout: (callback: () => void, delay: number) => number
  clearTimeout: (timer: number) => void
}

// The hero remains mounted for responsive layout. Its typing work should only
// run while the desktop panel is actually visible and motion is allowed.
export function startLoginHeroMessageAnimation(
  onChange: (ending: string) => void,
  browser: LoginHeroAnimationBrowser,
) {
  const desktop = browser.matchMedia('(min-width: 1024px)')
  const reducedMotion = browser.matchMedia('(prefers-reduced-motion: reduce)')
  let wordIndex = 0
  let displayedEnding: string = LOGIN_HERO_MESSAGE_ENDINGS[0]
  let isDeleting = false
  let timer: number | undefined
  let timerGeneration = 0
  let disposed = false

  const canAnimate = () =>
    !disposed && desktop.matches && !reducedMotion.matches && browser.document.visibilityState === 'visible'

  const cancelTimer = () => {
    timerGeneration += 1
    if (timer !== undefined) browser.clearTimeout(timer)
    timer = undefined
  }

  const showEnding = (ending: string) => {
    if (displayedEnding === ending) return
    displayedEnding = ending
    onChange(ending)
  }

  const scheduleStep = () => {
    if (!canAnimate()) return

    const currentEnding = LOGIN_HERO_MESSAGE_ENDINGS[wordIndex]
    const delay = isDeleting
      ? displayedEnding.length > 0 ? 42 : 240
      : displayedEnding === currentEnding ? 2100 : 72

    const scheduledGeneration = timerGeneration
    timer = browser.setTimeout(() => {
      // A queued callback can outlive a visibility change or effect cleanup.
      if (scheduledGeneration !== timerGeneration || !canAnimate()) return
      timer = undefined

      if (isDeleting && displayedEnding.length > 0) {
        showEnding(displayedEnding.slice(0, -1))
      } else if (isDeleting) {
        wordIndex = (wordIndex + 1) % LOGIN_HERO_MESSAGE_ENDINGS.length
        isDeleting = false
      } else if (displayedEnding === currentEnding) {
        isDeleting = true
      } else {
        showEnding(currentEnding.slice(0, displayedEnding.length + 1))
      }

      scheduleStep()
    }, delay)
  }

  const synchronize = () => {
    cancelTimer()
    if (disposed) return
    if (reducedMotion.matches) {
      wordIndex = 0
      isDeleting = false
      showEnding(LOGIN_HERO_MESSAGE_ENDINGS[0])
    }
    scheduleStep()
  }

  desktop.addEventListener('change', synchronize)
  reducedMotion.addEventListener('change', synchronize)
  browser.document.addEventListener('visibilitychange', synchronize)
  synchronize()

  return () => {
    disposed = true
    cancelTimer()
    desktop.removeEventListener('change', synchronize)
    reducedMotion.removeEventListener('change', synchronize)
    browser.document.removeEventListener('visibilitychange', synchronize)
  }
}
