import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  distDir: "../ui",
  basePath: "/ui",
  images: {
    unoptimized: true
  }
};

export default nextConfig;
