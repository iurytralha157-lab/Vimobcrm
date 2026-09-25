alter table public.organization_sites
  add column if not exists footer_logo_url text;

comment on column public.organization_sites.footer_logo_url is
  'Optional logo used in the public site footer; falls back to logo_url when null.';

-- Keep the legacy resolve_site_domain fallback response aligned with the public API.
CREATE OR REPLACE FUNCTION "public"."resolve_site_domain"("p_domain" "text") RETURNS TABLE("organization_id" "uuid", "site_config" "jsonb")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_site organization_sites%ROWTYPE;
  v_org organizations%ROWTYPE;
  v_clean text;
  v_bare text;
BEGIN
  v_clean := lower(trim(p_domain));
  v_bare := regexp_replace(v_clean, '^www\.', '');

  SELECT * INTO v_site
  FROM organization_sites
  WHERE custom_domain IN (v_clean, v_bare, 'www.' || v_bare)
    AND domain_verified = true
    AND is_active = true
  LIMIT 1;

  IF v_site.id IS NULL THEN
    SELECT * INTO v_site
    FROM organization_sites
    WHERE subdomain = split_part(v_bare, '.', 1)
      AND is_active = true
    LIMIT 1;
  END IF;

  IF v_site.id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_org FROM organizations WHERE id = v_site.organization_id;

  RETURN QUERY SELECT
    v_site.organization_id,
    jsonb_build_object(
      'id', v_site.id,
      'is_active', v_site.is_active,
      'subdomain', v_site.subdomain,
      'custom_domain', v_site.custom_domain,
      'site_title', COALESCE(v_site.site_title, v_org.name),
      'site_description', v_site.site_description,
      'logo_url', COALESCE(v_site.logo_url, v_org.logo_url),
      'footer_logo_url', v_site.footer_logo_url,
      'favicon_url', v_site.favicon_url,
      'primary_color', v_site.primary_color,
      'secondary_color', v_site.secondary_color,
      'accent_color', v_site.accent_color,
      'site_theme', COALESCE(v_site.site_theme, 'dark'),
      'background_color', COALESCE(v_site.background_color, '#0D0D0D'),
      'text_color', COALESCE(v_site.text_color, '#FFFFFF'),
      'card_color', COALESCE(v_site.card_color, '#FFFFFF'),
      'whatsapp', v_site.whatsapp,
      'phone', v_site.phone,
      'email', v_site.email,
      'address', v_site.address,
      'city', v_site.city,
      'state', v_site.state,
      'instagram', v_site.instagram,
      'facebook', v_site.facebook,
      'youtube', v_site.youtube,
      'linkedin', v_site.linkedin,
      'about_title', v_site.about_title,
      'about_text', v_site.about_text,
      'about_image_url', v_site.about_image_url,
      'seo_title', v_site.seo_title,
      'seo_description', v_site.seo_description,
      'seo_keywords', v_site.seo_keywords,
      'google_analytics_id', v_site.google_analytics_id,
      'hero_image_url', v_site.hero_image_url,
      'hero_title', v_site.hero_title,
      'hero_subtitle', v_site.hero_subtitle,
      'page_banner_url', v_site.page_banner_url,
      'logo_width', COALESCE(v_site.logo_width, 160),
      'logo_height', COALESCE(v_site.logo_height, 50),
      'watermark_enabled', COALESCE(v_site.watermark_enabled, false),
      'watermark_opacity', COALESCE(v_site.watermark_opacity, 20),
      'watermark_logo_url', v_site.watermark_logo_url,
      'watermark_size', COALESCE(v_site.watermark_size, 80),
      'watermark_position', COALESCE(v_site.watermark_position, 'bottom-right'),
      'organization_name', v_org.name
    );
END;
$$;
