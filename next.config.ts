import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  allowedDevOrigins: ["localhost", "127.0.0.1", "192.168.1.*", "192.168.1.2", "192.168.1.3"],
};

export default nextConfig;
