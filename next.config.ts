import type { NextConfig } from "next";

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_LOCAL_READ_ONLY?.trim().toLowerCase() === "true"
) {
  throw new Error("NEXT_PUBLIC_LOCAL_READ_ONLY is only allowed in local development");
}

// Credentials and platform administration must never render inside another site.
// Public sites and previews stay out of this list because they may be embedded.
const AUTHENTICATION_SURFACES = [
  "/login",
  "/cadastro",
  "/onboarding",
  "/reset-password",
  "/confirmar-email",
  "/convite/:path*",
  "/admin",
  "/admin/:path*",
];

const nextConfig: NextConfig = {
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.fbcdn.net", port: "", pathname: "/**" },
      { protocol: "https", hostname: "**.cdninstagram.com", port: "", pathname: "/**" },
    ],
    // Creative thumbnails may use signed CDN queries. Do not let a permitted
    // origin redirect the optimizer to another host or a local network.
    maximumRedirects: 0,
    dangerouslyAllowLocalIP: false,
  },
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.1.*",
    "192.168.1.2",
    "192.168.1.3",
  ],
  async headers() {
    return [
      ...AUTHENTICATION_SURFACES.map((source) => ({
        source,
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      })),
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      {
        source: "/comprovantes/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Cache-Control",
            value: "private, no-store, max-age=0, must-revalidate",
          },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
