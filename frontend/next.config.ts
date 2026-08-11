import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const API_URL = process.env.API_URL ?? "http://localhost:8000";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
  async rewrites() {
    return [
      // /api/internal/* is for server-to-server use only (the worker calls the api
      // directly over the docker network at http://api:8000, not through this rewrite):
      // block it from the public Cloudflare-tunnel-facing catch-all below. Must come
      // first -- Next.js rewrites are tried in order and the catch-all would otherwise
      // shadow this.
      { source: "/api/internal/:path*", destination: "/404" },
      { source: "/api/:path*", destination: `${API_URL}/api/:path*` },
    ];
  },
};

export default withNextIntl(nextConfig);
