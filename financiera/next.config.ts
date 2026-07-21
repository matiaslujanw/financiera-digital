import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cliente Postgres (node-postgres) corre solo en el server.
  serverExternalPackages: ["pg"],
  // La app vive en financiera/. Evita que un lockfile accidental en la raíz
  // haga que Turbopack observe el repositorio completo.
  turbopack: { root: process.cwd() },
};

export default nextConfig;
