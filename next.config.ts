const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  webpack: (config: any) => {
    // 1. Abaikan canvas di level alias
    config.resolve.alias.canvas = false;
    config.resolve.alias.encoding = false;
    
    // 2. Abaikan canvas di level fallback (Solusi Error SSR Vercel)
    config.resolve.fallback = {
      ...config.resolve.fallback,
      canvas: false,
      fs: false,
      path: false,
    };
    
    return config;
  },
};

export default nextConfig;