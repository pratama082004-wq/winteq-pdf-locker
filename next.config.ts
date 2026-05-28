const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config: any) => {
    config.resolve.alias.canvas = false;
    return config;
  },
  // Tambahan agar Turbopack di Next.js 16 tidak ngambek
  turbopack: {},
};

export default nextConfig;