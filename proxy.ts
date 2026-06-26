import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const sensitiveAuthParams = ['email', 'password', 'senha', 'pass', 'pwd']

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

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/login')) {
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

  // List of all protected routes within the (protected) group
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
  ];

  // Protected routes - require authentication
  const isProtectedRoute = protectedRoutes.some(route => request.nextUrl.pathname.startsWith(route));
  if (isProtectedRoute) {
    if (!user) {
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirectTo', getSafeRedirectPath(request))

      return NextResponse.redirect(loginUrl)
    }
  }

  // Public auth routes - redirect to dashboard if already logged in
  const publicAuthRoutes = ['/login', '/cadastro', '/reset-password', '/onboarding'];
  const isPublicAuthRoute = publicAuthRoutes.some(route => request.nextUrl.pathname.startsWith(route));
  if (isPublicAuthRoute) {
    if (user) {
      const { data: profile } = await supabase
        .from('users')
        .select('role')
        .eq('id', user.id)
        .maybeSingle()

      return NextResponse.redirect(new URL(profile?.role === 'super_admin' ? '/admin' : '/dashboard', request.url))
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
}
