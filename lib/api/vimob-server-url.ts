const DEFAULT_VIMOB_API_URL = 'http://localhost:8081'

type VimobAPIEnvironment = {
  VIMOB_API_URL?: string
  NEXT_PUBLIC_VIMOB_API_URL?: string
}

const DEFAULT_VIMOB_API_ENVIRONMENT: VimobAPIEnvironment = {
  VIMOB_API_URL: process.env.VIMOB_API_URL,
  NEXT_PUBLIC_VIMOB_API_URL: process.env.NEXT_PUBLIC_VIMOB_API_URL,
}

export function getVimobServerAPIBaseURL(
  environment: VimobAPIEnvironment = DEFAULT_VIMOB_API_ENVIRONMENT,
) {
  return (
    environment.VIMOB_API_URL ||
    environment.NEXT_PUBLIC_VIMOB_API_URL ||
    DEFAULT_VIMOB_API_URL
  ).replace(/\/+$/, '')
}
