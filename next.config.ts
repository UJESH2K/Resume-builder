import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // Emits .next/standalone — a self-contained server for the Docker image.
  output: "standalone",
};

export default nextConfig;
