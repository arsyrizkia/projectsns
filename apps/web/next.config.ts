import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@projectsns/core"],
  output: "standalone",
};

export default nextConfig;
