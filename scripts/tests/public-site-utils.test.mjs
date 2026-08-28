import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSiteHref,
  formatPrice,
  getPublicEmailHref,
  getPublicMediaEmbedUrl,
  getPublicPhoneHref,
  getThemeTokens,
  normalizePublicExternalUrl,
  normalizePublicImageUrl,
} from "../../components/features/public-site/public-site-utils.ts";

function site(overrides = {}) {
  return {
    site_theme: "light",
    background_color: null,
    text_color: null,
    card_color: null,
    primary_color: null,
    secondary_color: null,
    accent_color: null,
    ...overrides,
  };
}

test("normaliza somente imagens e links públicos com protocolos seguros", () => {
  assert.equal(normalizePublicImageUrl(" /images/casa.jpg "), "/images/casa.jpg");
  assert.equal(normalizePublicImageUrl("/\\cdn.example.com/casa.jpg", "/fallback.jpg"), "/fallback.jpg");
  assert.equal(normalizePublicImageUrl("https://cdn.example.com/casa.jpg"), "https://cdn.example.com/casa.jpg");
  assert.equal(normalizePublicImageUrl("javascript:alert(1)", "/fallback.jpg"), "/fallback.jpg");
  assert.equal(normalizePublicImageUrl("data:image/svg+xml,<svg/>", "/fallback.jpg"), "/fallback.jpg");
  assert.equal(normalizePublicImageUrl("https://user:secret@example.com/a.jpg", "/fallback.jpg"), "/fallback.jpg");

  assert.equal(normalizePublicExternalUrl("instagram.com/vimob"), "https://instagram.com/vimob");
  assert.equal(normalizePublicExternalUrl("javascript:alert(1)"), null);
  assert.equal(normalizePublicExternalUrl("https://user:secret@example.com"), null);
});

test("normaliza contatos sem permitir payload no href", () => {
  assert.equal(getPublicPhoneHref("+55 (22) 99999-0000"), "tel:+5522999990000");
  assert.equal(getPublicPhoneHref("123"), null);
  assert.equal(getPublicEmailHref(" contato@vimob.com.br "), "mailto:contato@vimob.com.br");
  assert.equal(getPublicEmailHref("contato@example.com?subject=payload"), null);
});

test("aceita somente YouTube canônico para vídeo e HTTPS para tour", () => {
  assert.equal(
    getPublicMediaEmbedUrl("https://youtu.be/AbCdEf12345", null),
    "https://www.youtube-nocookie.com/embed/AbCdEf12345",
  );
  assert.equal(getPublicMediaEmbedUrl("https://evilyoutube.com/watch?v=AbCdEf12345", null), "");
  assert.equal(
    getPublicMediaEmbedUrl(null, "https://tour.example.com/imovel/123"),
    "https://tour.example.com/imovel/123",
  );
  assert.equal(getPublicMediaEmbedUrl(null, "http://tour.example.com/imovel/123"), "");
});

test("sanitiza a paleta e escolhe contraste legível por superfície", () => {
  const tokens = getThemeTokens(site({
    background_color: "#fff",
    card_color: "#000",
    primary_color: "url(javascript:alert(1))",
    text_color: "#fff",
  }));

  assert.equal(tokens.background, "#ffffff");
  assert.equal(tokens.foreground, "#111827");
  assert.equal(tokens.cardForeground, "#ffffff");
  assert.equal(tokens.primary, "#d97706");
  assert.ok(["#111827", "#ffffff"].includes(tokens.primaryForeground));
});

test("preserva rotas do site e evita preços públicos inválidos", () => {
  assert.equal(buildSiteHref("/sites/demo", "/imoveis?tipo=Casa"), "/sites/demo/imoveis?tipo=Casa");
  assert.equal(buildSiteHref("/", "/"), "/");
  assert.equal(formatPrice(-1), "Consulte");
  assert.equal(formatPrice(Number.NaN), "Consulte");
});
