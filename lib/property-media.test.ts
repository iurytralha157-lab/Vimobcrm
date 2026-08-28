import assert from "node:assert/strict";
import test from "node:test";

import { getSafePropertyImageSource } from "./property-media";

test("accepts HTTP(S) and safe same-origin property images", () => {
  assert.equal(
    getSafePropertyImageSource("https://cdn.example.com/property.jpg"),
    "https://cdn.example.com/property.jpg",
  );
  assert.equal(
    getSafePropertyImageSource("/images/property.jpg"),
    "/images/property.jpg",
  );
});

test("rejects unsafe schemes and falls back to the next valid photo", () => {
  assert.equal(
    getSafePropertyImageSource(
      "javascript:alert(1)",
      "https://cdn.example.com/fallback.jpg",
    ),
    "https://cdn.example.com/fallback.jpg",
  );
  assert.equal(
    getSafePropertyImageSource(
      "data:image/svg+xml,bad",
      "//evil.example/image.jpg",
    ),
    null,
  );
});
