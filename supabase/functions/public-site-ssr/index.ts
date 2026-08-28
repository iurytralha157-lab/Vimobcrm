import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Bot/crawler user agents that need SSR meta tags
const BOT_USER_AGENTS = [
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'linkedinbot',
  'whatsapp',
  'telegrambot',
  'slackbot',
  'discordbot',
  'googlebot',
  'bingbot',
  'yandexbot',
  'baiduspider',
  'duckduckbot',
  'pinterestbot',
  'applebot',
  'embedly',
  'quora link preview',
  'outbrain',
  'vkshare',
  'w3c_validator',
  'redditbot',
  'rogerbot',
  'showyoubot',
  'skypeuripreview',
  'nuzzel',
  'tumblr',
  'bitlybot',
  'developers.google.com',
];

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_USER_AGENTS.some(bot => ua.includes(bot));
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function buildHtml(site: any, orgName: string, requestUrl: string): string {
  const title = escapeHtml(site.seo_title || site.site_title || orgName || 'Site Imobiliário');
  const description = escapeHtml(site.seo_description || site.site_description || `${orgName} - Imóveis`);
  const image = site.logo_url || site.favicon_url || site.about_image_url || site.hero_image_url || '';
  const favicon = site.favicon_url || site.logo_url || '';
  const siteName = escapeHtml(site.site_title || orgName || 'Site Imobiliário');
  const keywords = site.seo_keywords ? `<meta name="keywords" content="${escapeHtml(site.seo_keywords)}">` : '';
  const canonicalUrl = requestUrl;

  // GTM injection
  let gtmHead = '';
  let gtmBody = '';
  if (site.gtm_id) {
    const gtmId = escapeHtml(site.gtm_id);
    gtmHead = `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmId}');</script>
<!-- End Google Tag Manager -->`;
    gtmBody = `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`;
  }

  // Custom scripts
  const headScripts = site.head_scripts || '';
  const bodyScripts = site.body_scripts || '';

  // Meta Pixel
  let metaPixel = '';
  if (site.meta_pixel_id) {
    metaPixel = `<!-- Meta Pixel -->
<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${escapeHtml(site.meta_pixel_id)}');fbq('track','PageView');</script>
<!-- End Meta Pixel -->`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <title>${title}</title>
  <meta name="description" content="${description}">
  ${keywords}
  
  <!-- Open Graph -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="${siteName}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}">` : ''}
  
  <!-- Twitter -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  ${image ? `<meta name="twitter:image" content="${escapeHtml(image)}">` : ''}
  
  <!-- Canonical -->
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  
  ${favicon ? `<link rel="icon" type="image/png" href="${escapeHtml(favicon)}">` : ''}
  
  ${gtmHead}
  ${metaPixel}
  ${headScripts}
</head>
<body>
  ${gtmBody}
  ${bodyScripts}
  <div id="root">
    <h1>${siteName}</h1>
    <p>${description}</p>
  </div>
  <script>
    // Redirect real users (non-bots) to the SPA
    window.location.href = "${escapeHtml(canonicalUrl)}";
  </script>
</body>
</html>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const domain = url.searchParams.get('domain') || '';
    const path = url.searchParams.get('path') || '/';
    const userAgent = req.headers.get('user-agent') || '';
    const requestUrl = url.searchParams.get('url') || `https://${domain}${path}`;

    if (!domain) {
      return new Response('Domain is required', { status: 400, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const cleanDomain = domain.toLowerCase().trim().replace(/^www\./, '');

    // Look up site by custom_domain or subdomain
    let siteData: any = null;
    let orgName = '';

    // Try custom domain
    const { data: domainMatch } = await supabase
      .from('organization_sites')
      .select('*, organizations(name)')
      .or(`custom_domain.eq.${domain.toLowerCase().trim()},custom_domain.eq.${cleanDomain},custom_domain.eq.www.${cleanDomain},subdomain.eq.${cleanDomain}`)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    if (domainMatch) {
      siteData = domainMatch;
      orgName = (domainMatch.organizations as any)?.name || '';
    }

    if (!siteData) {
      return new Response('Site not found', { status: 404, headers: corsHeaders });
    }

    const html = buildHtml(siteData, orgName, requestUrl);

    return new Response(html, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=600',
      },
    });
  } catch (error) {
    console.error('SSR Error:', error);
    return new Response('Internal server error', { status: 500, headers: corsHeaders });
  }
});
