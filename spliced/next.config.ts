import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: ['judiciary-putt-afar.ngrok-free.dev'],
};

export default nextConfig;