import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const protectedRoutes = [
  '/admin',
  '/dashboard',
  '/pipeline',
  '/crm',
  '/agenda',
  '/properties',
  '/automations',
  '/attention',
  '/settings',
  '/notifications',
  '/help',
  '/financeiro',
  '/gamificacao',
  '/suporte',
  '/select-organization',
]

const publicAuthRoutes = ['/login', '/cadastro', '/onboarding']

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

  return redirectResponse
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

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

          response = NextResponse.next({ request })

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

  // Protected routes - require authentication
  const isProtectedRoute = protectedRoutes.some(route => request.nextUrl.pathname.startsWith(route))
  if (isProtectedRoute) {
    if (!user) {
      return redirectWithSessionCookies(new URL('/login', request.url), response)
    }
  }

  // Public auth routes - redirect to dashboard if already logged in.
  // Keep /reset-password out of this list: Supabase recovery links create a
  // temporary session, and that session must be allowed to reach the reset page.
  const isPublicAuthRoute = publicAuthRoutes.some(route => request.nextUrl.pathname.startsWith(route))
  const isPasswordResetReturnToLogin =
    request.nextUrl.pathname.startsWith('/login') &&
    request.nextUrl.searchParams.get('passwordReset') === 'success'
  if (isPublicAuthRoute) {
    if (user && !isPasswordResetReturnToLogin) {
      return redirectWithSessionCookies(new URL('/dashboard', request.url), response)
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
