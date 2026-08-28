import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  const url = new URL(req.url)
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    
    // Handle OAuth callback (GET request from Google)
    if (req.method === 'GET') {
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state') // Contains user_id and return_url
      const error = url.searchParams.get('error')
      
      console.log('OAuth callback received:', { code: !!code, state, error })
      
      if (error) {
        console.error('OAuth error from Google:', error)
        return new Response(
          generateErrorPage('Erro na autenticação: ' + error),
          { headers: { 'Content-Type': 'text/html' } }
        )
      }
      
      if (!code || !state) {
        return new Response(
          generateErrorPage('Parâmetros inválidos'),
          { headers: { 'Content-Type': 'text/html' } }
        )
      }
      
      // Parse state (format: userId|returnUrl)
      const [userId, returnUrl] = state.split('|')
      
      if (!userId) {
        return new Response(
          generateErrorPage('Estado inválido'),
          { headers: { 'Content-Type': 'text/html' } }
        )
      }
      
      // Exchange code for tokens
      const callbackUrl = `${SUPABASE_URL}/functions/v1/google-calendar-auth`
      
      console.log('Exchanging code for tokens...')
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: callbackUrl,
        }),
      })

      const tokens = await tokenResponse.json()
      console.log('Token response:', { error: tokens.error, hasAccessToken: !!tokens.access_token })

      if (tokens.error) {
        console.error('Token exchange error:', tokens)
        return new Response(
          generateErrorPage('Erro ao trocar código: ' + (tokens.error_description || tokens.error)),
          { headers: { 'Content-Type': 'text/html' } }
        )
      }

      // Save tokens to database
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      
      const { error: upsertError } = await supabaseAdmin
        .from('google_calendar_tokens')
        .upsert({
          user_id: userId,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at: expiresAt,
          calendar_id: 'primary',
        }, { onConflict: 'user_id' })

      if (upsertError) {
        console.error('Error saving tokens:', upsertError)
        return new Response(
          generateErrorPage('Erro ao salvar tokens: ' + upsertError.message),
          { headers: { 'Content-Type': 'text/html' } }
        )
      }
      
      console.log('Tokens saved successfully for user:', userId)
      
      // Redirect back to the app
      const redirectTo = returnUrl || 'https://vimob.vettercompany.com.br/crm/agenda'
      return new Response(
        generateSuccessPage(redirectTo),
        { headers: { 'Content-Type': 'text/html' } }
      )
    }
    
    // Handle POST requests (from frontend)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token)
    
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const body = await req.json()
    const { action, returnUrl } = body

    if (action === 'connect') {
      // Generate OAuth URL for Google Calendar
      const scopes = [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
      ].join(' ')

      // Use the edge function URL directly as callback (no /callback suffix)
      const callbackUrl = `${SUPABASE_URL}/functions/v1/google-calendar-auth`
      
      // Encode user_id and return URL in state parameter
      const state = `${user.id}|${returnUrl || ''}`
      
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID)
      authUrl.searchParams.set('redirect_uri', callbackUrl)
      authUrl.searchParams.set('response_type', 'code')
      authUrl.searchParams.set('scope', scopes)
      authUrl.searchParams.set('access_type', 'offline')
      authUrl.searchParams.set('prompt', 'consent')
      authUrl.searchParams.set('state', state)

      console.log('Generated auth URL with callback:', callbackUrl)

      return new Response(
        JSON.stringify({ authUrl: authUrl.toString() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (action === 'refresh') {
      // Get user's refresh token
      const { data: tokenData, error: tokenError } = await supabaseAdmin
        .from('google_calendar_tokens')
        .select('refresh_token')
        .eq('user_id', user.id)
        .single()

      if (tokenError || !tokenData) {
        return new Response(
          JSON.stringify({ error: 'No Google Calendar connected' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Refresh the access token
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: tokenData.refresh_token,
          grant_type: 'refresh_token',
        }),
      })

      const tokens = await tokenResponse.json()

      if (tokens.error) {
        return new Response(
          JSON.stringify({ error: tokens.error_description || tokens.error }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Update access token in database
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString()
      
      await supabaseAdmin
        .from('google_calendar_tokens')
        .update({
          access_token: tokens.access_token,
          expires_at: expiresAt,
        })
        .eq('user_id', user.id)

      return new Response(
        JSON.stringify({ access_token: tokens.access_token }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: unknown) {
    console.error('Error:', error)
    const message = error instanceof Error ? error.message : 'Unknown error'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})

function generateSuccessPage(redirectUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Conectado!</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
    }
    .success-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 { margin: 0 0 0.5rem; }
    p { opacity: 0.9; margin: 0 0 1.5rem; }
    .redirect-text { font-size: 0.875rem; opacity: 0.7; }
  </style>
</head>
<body>
  <div class="container">
    <div class="success-icon">✅</div>
    <h1>Google Calendar Conectado!</h1>
    <p>Sua conta foi vinculada com sucesso.</p>
    <p class="redirect-text">Redirecionando...</p>
  </div>
  <script>
    setTimeout(() => {
      window.location.href = '${redirectUrl}';
    }, 1500);
  </script>
</body>
</html>
  `
}

function generateErrorPage(message: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Erro</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background: linear-gradient(135deg, #e53e3e 0%, #c53030 100%);
      color: white;
    }
    .container {
      text-align: center;
      padding: 2rem;
      background: rgba(255,255,255,0.1);
      border-radius: 16px;
      backdrop-filter: blur(10px);
      max-width: 400px;
    }
    .error-icon {
      font-size: 4rem;
      margin-bottom: 1rem;
    }
    h1 { margin: 0 0 0.5rem; }
    p { opacity: 0.9; margin: 0 0 1.5rem; word-break: break-word; }
    button {
      background: white;
      color: #c53030;
      border: none;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-size: 1rem;
      cursor: pointer;
      font-weight: 600;
    }
    button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <div class="container">
    <div class="error-icon">❌</div>
    <h1>Erro na Conexão</h1>
    <p>${message}</p>
    <button onclick="window.close()">Fechar</button>
  </div>
</body>
</html>
  `
}
