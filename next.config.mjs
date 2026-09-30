/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    serverComponentsExternalPackages: ["firebase-admin", "mdb-reader"],
  },
  async redirects() {
    // The EData page grew into the whole Compulink export (QDAT, PDFs) and
    // became Data Out; old bookmarks still land.
    return [{ source: "/edata", destination: "/dataout", permanent: true }];
  },
};

export default nextConfig;
