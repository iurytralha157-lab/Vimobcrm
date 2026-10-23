import assert from "node:assert/strict";
import test from "node:test";

import { getDashboardCreativeSafeUrl, getDashboardCreativeThumbnailUrl } from "./creative-thumbnail-url.ts";

test("miniaturas da Dashboard aceitam apenas URLs HTTPS absolutas sem credenciais", () => {
  assert.equal(getDashboardCreativeThumbnailUrl(" https://cdn.example.com/a.jpg "), "https://cdn.example.com/a.jpg");
  assert.equal(getDashboardCreativeThumbnailUrl("http://cdn.example.com/a.jpg"), null);
  assert.equal(getDashboardCreativeThumbnailUrl("https:cdn.example.com/a.jpg"), null);
  assert.equal(getDashboardCreativeThumbnailUrl("https://user:secret@cdn.example.com/a.jpg"), null);
  assert.equal(getDashboardCreativeThumbnailUrl("javascript:alert(1)"), null);
  assert.equal(getDashboardCreativeThumbnailUrl("/local.jpg"), null);
  assert.equal(getDashboardCreativeThumbnailUrl(null), null);
});

test("links externos dos criativos usam a mesma validação HTTPS", () => {
  assert.equal(getDashboardCreativeSafeUrl("https://www.instagram.com/p/example/"), "https://www.instagram.com/p/example/");
  assert.equal(getDashboardCreativeSafeUrl("javascript:alert(1)"), null);
  assert.equal(getDashboardCreativeSafeUrl("https://name:password@cdn.example.com/video.mp4"), null);
  assert.equal(getDashboardCreativeSafeUrl(undefined), null);
});

test("URLs legadas com credenciais de query ou porta explícita nunca chegam ao navegador", () => {
  for (const value of ["https://scontent.fbcdn.net/image.jpg?access_token=secret", "https://scontent.fbcdn.net/image.jpg?APPSECRET_PROOF=secret", "https://scontent.fbcdn.net/image.jpg?auth%54oken=secret", "https://scontent.fbcdn.net/image.jpg?client_secret=secret", "https://scontent.fbcdn.net:443/image.jpg", "https://scontent.fbcdn.net:8443/image.jpg", "https://scontent.fbcdn.net/image.jpg?oh=%broken", "https://scontent.fbcdn.net/image.jpg?oh=x;token=secret"]) assert.equal(getDashboardCreativeSafeUrl(value), null, value);
  const signed = "https://scontent.fbcdn.net/image.jpg?oh=public-signature&oe=abc";
  assert.equal(getDashboardCreativeSafeUrl(signed), signed);
});

test("fragmentos são rejeitados inteiros sem reescrever URLs assinadas", () => {
  for (const value of [
    "https://scontent.fbcdn.net/image.jpg#access_token=secret",
    "https://scontent.fbcdn.net/image.jpg#appsecret_proof=secret",
    "https://www.instagram.com/p/example/#section",
    "https://scontent.fbcdn.net/image.jpg#",
  ]) {
    assert.equal(getDashboardCreativeSafeUrl(value), null, value);
    assert.equal(getDashboardCreativeThumbnailUrl(value), null, value);
  }
  const signed = "https://scontent.fbcdn.net/image%23part.jpg?oh=public-signature&oe=abc";
  assert.equal(getDashboardCreativeSafeUrl(signed), signed);
});
