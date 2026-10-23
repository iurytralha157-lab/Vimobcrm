import assert from "node:assert/strict";
import test from "node:test";
import { canOptimizeDashboardCreativeImage } from "@/components/features/dashboard/creative-image-optimization";

test("native thumbnail optimization is limited to the configured HTTPS Meta CDN hosts", () => {
  for (const url of ["https://scontent.xx.fbcdn.net/image.jpg?oe=abc", "https://scontent.cdninstagram.com/image.jpg"]) assert.equal(canOptimizeDashboardCreativeImage(url), true, url);
  for (const url of ["https://fbcdn.net/image.jpg", "https://cdninstagram.com/image.jpg", "http://fbcdn.net/image.jpg", "https://fbcdn.net.evil.example/image.jpg", "https://fakefbcdn.net/image.jpg", "https://cdninstagram.com:8080/image.jpg", "https://user:password@fbcdn.net/image.jpg", "https://127.0.0.1/image.jpg", "https://scontent.fbcdn.net/image.gif", "https://scontent.fbcdn.net/image.svg", null]) assert.equal(canOptimizeDashboardCreativeImage(url), false, url ?? "null");
});
