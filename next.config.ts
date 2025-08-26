import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Avoid failing the Vercel build on lint warnings/errors. We lint locally.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
