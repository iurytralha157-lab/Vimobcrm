import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const sensitiveAuthParams = ['email', 'password', 'senha', 'pass', 'pwd']
const protectedRoutes = [
  '/dashboard',
  '/pipeline',
  '/crm',
  '/agenda',
  '/properties',
  '/automations',
  '/settings',
  '/notifications',
  '/help',
  '/financeiro',
  '/select-organization',
  '/admin',
  '/gamificacao',
  '/docs',
]
const publicAuthRoutes = ['/login', '/cadastro', '/reset-password', '/onboarding']
const publicAssetPrefixes = [
  '/icons/',
  '/images/',
  '/manifest',
  '/sw.js',
  '/workbox-',
]

function stripSensitiveAuthParams(url: URL) {
  let changed = false

  sensitiveAuthParams.forEach((param) => {
    if (url.searchParams.has(param)) {
      url.searchParams.delete(param)
      changed = true
    }
  })

  return changed
}

function getSafeRedirectPath(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone()
  stripSensitiveAuthParams(redirectUrl)

  return `${redirectUrl.pathname}${redirectUrl.search}`
}

function startsWithAny(pathname: string, routes: string[]) {
  return routes.some((route) => pathname.startsWith(route))
}

function isPublicAssetPath(pathname: string) {
  if (publicAssetPrefixes.some((prefix) => pathname.startsWith(prefix))) return true
  return /\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|css|js|map|txt|xml|json|woff2?)$/i.test(pathname)
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  if (isPublicAssetPath(pathname)) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/login')) {
    const cleanLoginUrl = request.nextUrl.clone()

    if (stripSensitiveAuthParams(cleanLoginUrl)) {
      return NextResponse.redirect(cleanLoginUrl)
    }
  }

  const response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const isProtectedRoute = startsWithAny(pathname, protectedRoutes)
  const isPublicAuthRoute = startsWithAny(pathname, publicAuthRoutes)

  if (!isProtectedRoute && !isPublicAuthRoute) {
    return response
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    }
  )

  // Refresh session
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Protected routes - require authentication
  if (isProtectedRoute) {
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirectTo', getSafeRedirectPath(request))

      return NextResponse.redirect(loginUrl)
    }
  }

  // Public auth routes - redirect to dashboard if already logged in
  if (isPublicAuthRoute) {
    if (user) {
      return NextResponse.redirect(new URL('/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
}
