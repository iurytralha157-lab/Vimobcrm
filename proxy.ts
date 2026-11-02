import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_AUTHENTICATED_ROUTE } from '@/config/constants'
import {
  normalizeReleaseSha,
  VIMOB_RELEASE_HEADER,
} from '@/config/release'
import {
  getSafePostLoginPath,
  isProtectedAppPath,
} from '@/lib/auth/post-login-redirect'
import {
  getPasswordRecoveryRedirect,
  isPublicAuthRoute,
} from '@/lib/auth/password-recovery'

const RELEASE_SHA = normalizeReleaseSha(process.env.NEXT_PUBLIC_VIMOB_RELEASE_SHA)

function withReleaseIdentity(response: NextResponse) {
  response.headers.set(VIMOB_RELEASE_HEADER, RELEASE_SHA)
  return response
}

function createNextResponse(request: NextRequest) {
  return withReleaseIdentity(NextResponse.next({ request }))
}

function redirectWithSessionCookies(url: URL, sessionResponse: NextResponse) {
  const redirectResponse = NextResponse.redirect(url)

  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie)
  })

  sessionResponse.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') {
      redirectResponse.headers.set(key, value)
    }
  })

  return withReleaseIdentity(redirectResponse)
}

export async function proxy(request: NextRequest) {
  let response = createNextResponse(request)

  // Keep createServerClient and getClaims close together. Supabase SSR relies on
  // this response object to keep browser and server cookies in sync.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value)
          })

          response = createNextResponse(request)

          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })

          Object.entries(headers).forEach(([key, value]) => {
            response.headers.set(key, value)
          })
        },
      },
    }
  )

  // Refresh session
  const { data } = await supabase.auth.getClaims()
  const user = data?.claims
  const recoveryRedirect = getPasswordRecoveryRedirect(user, request.nextUrl.pathname)
  if (recoveryRedirect) {
    const recoveryURL = new URL('/reset-password', request.url)
    return redirectWithSessionCookies(recoveryURL, response)
  }

  // Protected routes - require authentication
  const isProtectedRoute = isProtectedAppPath(request.nextUrl.pathname)
  if (isProtectedRoute) {
    if (!user) {
      const loginURL = new URL('/login', request.url)
      loginURL.searchParams.set(
        'redirectTo',
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      )
      return redirectWithSessionCookies(loginURL, response)
    }
  }

  // Public auth routes - redirect to the authenticated landing page if already logged in.
  // Keep /reset-password out of this list: Supabase recovery links create a
  // temporary session, and that session must be allowed to reach the reset page.
  const publicAuthRoute = isPublicAuthRoute(request.nextUrl.pathname)
  const isPasswordResetReturnToLogin =
    request.nextUrl.pathname.startsWith('/login') &&
    request.nextUrl.searchParams.get('passwordReset') === 'success'
  if (publicAuthRoute) {
    if (user && !isPasswordResetReturnToLogin) {
      const destination = getSafePostLoginPath(
        request.nextUrl.searchParams.get('redirectTo'),
        DEFAULT_AUTHENTICATED_ROUTE,
      )
      return redirectWithSessionCookies(new URL(destination, request.url), response)
    }
  }

  return withReleaseIdentity(response)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|webm)$).*)',
  ],
}
