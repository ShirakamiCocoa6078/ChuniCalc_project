
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'chunirec.net',
        port: '',
        pathname: '/images/jacket/**',
      }
    ],
  },
  env: {
    CHUNIREC_API_TOKEN: process.env.CHUNIREC_API_TOKEN,
  }
};

export default nextConfig;
