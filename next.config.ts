import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    agentUpgrade: "security",
  },
  allowedDevOrigins: ["*.trycloudflare.com"],
  serverExternalPackages: ["ffmpeg-static", "ws"],
};

export default nextConfig;
