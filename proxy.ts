import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
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
  ];

  // Protected routes - require authentication
  const isProtectedRoute = protectedRoutes.some(route => request.nextUrl.pathname.startsWith(route));
  if (isProtectedRoute) {
    if (!user) {
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // Public auth routes - redirect to dashboard if already logged in.
  // Keep /reset-password out of this list: Supabase recovery links create a
  // temporary session, and that session must be allowed to reach the reset page.
  const publicAuthRoutes = ['/login', '/cadastro', '/onboarding'];
  const isPublicAuthRoute = publicAuthRoutes.some(route => request.nextUrl.pathname.startsWith(route));
  const isPasswordResetReturnToLogin =
    request.nextUrl.pathname.startsWith('/login') &&
    request.nextUrl.searchParams.get('passwordReset') === 'success';
  if (isPublicAuthRoute) {
    if (user && !isPasswordResetReturnToLogin) {
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
