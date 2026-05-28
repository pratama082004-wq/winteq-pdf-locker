// Hapus import NextConfig di baris 1
// Hapus titik dua NextConfig di variabelnya

const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

export default nextConfig;