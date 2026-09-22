/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin", "mdb-reader"],
  },
};

export default nextConfig;
