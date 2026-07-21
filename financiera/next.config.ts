import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cliente Postgres (node-postgres) corre solo en el server.
  serverExternalPackages: ["pg"],
};

export default nextConfig;
