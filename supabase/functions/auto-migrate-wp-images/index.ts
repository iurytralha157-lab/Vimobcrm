import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Normalize text for fuzzy matching: remove accents, lowercase, strip special chars
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalize(text).split(' ').filter(t => t.length > 2));
}

function similarity(a: string, b: string): number {
  const tokensA = tokenize(a);
  const tokensB = tokenize(b);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let common = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) common++;
  }
  return common / Math.min(tokensA.size, tokensB.size);
}

async function fetchAllPropertyLinks(wpBaseUrl: string): Promise<{ url: string; text: string }[]> {
  const links: { url: string; text: string }[] = [];
  const seenUrls = new Set<string>();
  
  // Try multiple pages of /imoveis/
  for (let page = 1; page <= 5; page++) {
    const listUrl = page === 1 
      ? `${wpBaseUrl}/imoveis/` 
      : `${wpBaseUrl}/imoveis/page/${page}/`;
    
    console.log(`Fetching listing page: ${listUrl}`);
    try {
      const res = await fetch(listUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ViMobe-Importer/1.0)' },
      });
      if (!res.ok) {
        console.log(`Page ${page} returned ${res.status}, stopping pagination`);
        break;
      }
      const html = await res.text();
      
      // Extract links to individual property pages
      const linkRegex = /href="(https?:\/\/queroumimovel\.com\.br\/imoveis\/[^"]+)"/gi;
      let match;
      while ((match = linkRegex.exec(html)) !== null) {
        const url = match[1].replace(/\/$/, '');
        // Skip pagination and category links
        if (url.includes('/page/') || url.includes('/category/')) continue;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);
        
        // Extract link text from slug
        const slug = url.split('/imoveis/')[1] || '';
        links.push({ url: url + '/', text: slug.replace(/-/g, ' ') });
      }
      
      // Also try extracting with anchor text
      const anchorRegex = /<a[^>]*href="(https?:\/\/queroumimovel\.com\.br\/imoveis\/[^"]+)"[^>]*>([^<]*)</gi;
      while ((match = anchorRegex.exec(html)) !== null) {
        const url = match[1].replace(/\/$/, '');
        if (url.includes('/page/') || url.includes('/category/')) continue;
        if (!seenUrls.has(url)) {
          seenUrls.add(url);
          const slug = url.split('/imoveis/')[1] || '';
          links.push({ url: url + '/', text: slug.replace(/-/g, ' ') });
        }
      }
    } catch (e) {
      console.error(`Error fetching page ${page}:`, e);
      break;
    }
  }
  
  console.log(`Found ${links.length} property links on WP site`);
  return links;
}

async function scrapeImagesFromPage(url: string): Promise<{ mainImage: string | null; gallery: string[] }> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ViMobe-Importer/1.0)' },
    });
    if (!res.ok) {
      console.warn(`Page fetch failed: ${res.status} for ${url}`);
      return { mainImage: null, gallery: [] };
    }
    const html = await res.text();
    
    // Extract all image URLs from wp-content/uploads
    const imgRegex = /https?:\/\/queroumimovel\.com\.br\/wp-content\/uploads\/[^\s"'<>]+\.(jpe?g|png|webp)/gi;
    const allMatches = [...new Set(html.match(imgRegex) || [])];
    
    // Filter out thumbnails and logos
    const fullSizeImages = allMatches
      .filter(u => !u.match(/-\d+x\d+\.(jpe?g|png|webp)$/i))
      .filter(u => !u.includes('150x150'))
      .filter(u => !u.includes('Logotipo'))
      .filter(u => !u.includes('logo'))
      .filter(u => !u.includes('favicon'));
    
    const images = fullSizeImages.length > 0 
      ? fullSizeImages 
      : allMatches.filter(u => !u.includes('Logotipo') && !u.includes('logo'));
    
    const mainImage = images.length > 0 ? images[0] : null;
    const gallery = images.slice(1);
    
    console.log(`Scraped ${url}: found ${images.length} images`);
    return { mainImage, gallery };
  } catch (e) {
    console.error(`Error scraping ${url}:`, e);
    return { mainImage: null, gallery: [] };
  }
}

async function downloadImage(url: string): Promise<{ data: Uint8Array; contentType: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ViMobe-Importer/1.0)' },
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const arrayBuf = await res.arrayBuffer();
    return { data: new Uint8Array(arrayBuf), contentType };
  } catch {
    return null;
  }
}

function getExtFromUrl(url: string): string {
  const match = url.match(/\.(jpe?g|png|webp|gif)(\?|$)/i);
  return match ? match[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { organization_id, wp_base_url = 'https://queroumimovel.com.br', max_gallery = 15 } = await req.json();

    if (!organization_id) {
      return new Response(
        JSON.stringify({ error: 'organization_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Require an authenticated JWT and verify the caller is a super_admin
    // OR an admin of the target organization.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: callerProfile } = await supabase
      .from('users')
      .select('role, organization_id')
      .eq('id', caller.id)
      .single();
    const isSuper = callerProfile?.role === 'super_admin';
    const isOrgAdmin = callerProfile?.role === 'admin' && callerProfile?.organization_id === organization_id;
    if (!isSuper && !isOrgAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Fetch properties without images
    const { data: properties, error: fetchErr } = await supabase
      .from('properties')
      .select('id, title, code')
      .eq('organization_id', organization_id)
      .or('imagem_principal.is.null,imagem_principal.eq.')
      .order('title');

    if (fetchErr) throw fetchErr;
    console.log(`Found ${properties?.length || 0} properties without images`);

    if (!properties?.length) {
      return new Response(
        JSON.stringify({ success: true, message: 'No properties without images found', results: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. Crawl WP listing pages to get all property URLs
    const wpLinks = await fetchAllPropertyLinks(wp_base_url);

    if (wpLinks.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Could not find any property links on WordPress site' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Match each DB property to a WP URL using fuzzy matching
    const results: any[] = [];

    for (const prop of properties) {
      const title = prop.title || '';
      let bestMatch: { url: string; text: string; score: number } | null = null;

      for (const link of wpLinks) {
        const score = similarity(title, link.text);
        if (score > (bestMatch?.score || 0)) {
          bestMatch = { ...link, score };
        }
      }

      if (!bestMatch || bestMatch.score < 0.4) {
        console.log(`No match for "${title}" (best score: ${bestMatch?.score?.toFixed(2) || 'none'})`);
        results.push({
          property_id: prop.id,
          title,
          status: 'no_match',
          best_score: bestMatch?.score?.toFixed(2) || null,
          best_url: bestMatch?.url || null,
        });
        continue;
      }

      console.log(`Matched "${title}" -> ${bestMatch.url} (score: ${bestMatch.score.toFixed(2)})`);

      // 4. Scrape images from the matched WP page
      const { mainImage, gallery } = await scrapeImagesFromPage(bestMatch.url);

      if (!mainImage) {
        results.push({
          property_id: prop.id,
          title,
          status: 'no_images',
          matched_url: bestMatch.url,
          score: bestMatch.score.toFixed(2),
        });
        continue;
      }

      // 5. Download and upload main image
      let mainImageStorageUrl: string | null = null;
      const img = await downloadImage(mainImage);
      if (img) {
        const ext = getExtFromUrl(mainImage);
        const path = `orgs/${organization_id}/properties/${prop.id}/main.${ext}`;
        const { error } = await supabase.storage
          .from('properties')
          .upload(path, img.data, { contentType: img.contentType, upsert: true });
        if (!error) {
          const { data: urlData } = supabase.storage.from('properties').getPublicUrl(path);
          mainImageStorageUrl = urlData.publicUrl;
        } else {
          console.error(`Storage upload error (main): ${error.message}`);
        }
      }

      // 6. Download and upload gallery
      const galleryStorageUrls: string[] = [];
      const limitedGallery = gallery.slice(0, max_gallery);
      for (let i = 0; i < limitedGallery.length; i++) {
        const gImg = await downloadImage(limitedGallery[i]);
        if (!gImg) continue;
        const ext = getExtFromUrl(limitedGallery[i]);
        const path = `orgs/${organization_id}/properties/${prop.id}/gallery-${i}.${ext}`;
        const { error } = await supabase.storage
          .from('properties')
          .upload(path, gImg.data, { contentType: gImg.contentType, upsert: true });
        if (!error) {
          const { data: urlData } = supabase.storage.from('properties').getPublicUrl(path);
          galleryStorageUrls.push(urlData.publicUrl);
        }
        await new Promise(r => setTimeout(r, 100));
      }

      // 7. Update DB
      const updateData: any = {};
      if (mainImageStorageUrl) updateData.imagem_principal = mainImageStorageUrl;
      if (galleryStorageUrls.length > 0) updateData.fotos = galleryStorageUrls;

      if (Object.keys(updateData).length > 0) {
        const { error: updateError } = await supabase
          .from('properties')
          .update(updateData)
          .eq('id', prop.id);
        if (updateError) console.error(`DB update error: ${updateError.message}`);
      }

      results.push({
        property_id: prop.id,
        title,
        status: 'ok',
        matched_url: bestMatch.url,
        score: bestMatch.score.toFixed(2),
        main_image: mainImageStorageUrl ? 'uploaded' : 'failed',
        gallery_count: galleryStorageUrls.length,
        total_found: (mainImage ? 1 : 0) + gallery.length,
      });

      console.log(`Done: ${title} - main=${mainImageStorageUrl ? 'ok' : 'fail'}, gallery=${galleryStorageUrls.length}`);
    }

    return new Response(
      JSON.stringify({ success: true, total: properties.length, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
