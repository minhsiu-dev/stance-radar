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
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default withNextIntl(nextConfig);
