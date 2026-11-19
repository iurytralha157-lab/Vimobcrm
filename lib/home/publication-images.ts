import type { HomePublicationCard } from '@/lib/api/home'

type PublicationImages = Pick<HomePublicationCard,
  'imageUrl' | 'mobileImageUrl' | 'darkImageUrl' | 'darkMobileImageUrl'>

export function getHomePublicationImages(publication: PublicationImages, theme?: string) {
  const { imageUrl, mobileImageUrl, darkImageUrl, darkMobileImageUrl } = publication
  const dark = theme === 'dark'
  const desktop = dark ? darkImageUrl || imageUrl : imageUrl
  const mobile = dark ? darkMobileImageUrl || mobileImageUrl : mobileImageUrl
  return {
    desktopImageUrl: desktop || mobile || darkImageUrl || darkMobileImageUrl || null,
    mobileImageUrl: mobile || desktop || darkMobileImageUrl || darkImageUrl || null,
  }
}
