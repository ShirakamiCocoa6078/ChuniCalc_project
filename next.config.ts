
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
        hostname: 'chunirec.net', // For potential direct .png links if available
        port: '',
        pathname: '/images/jacket/**',
      },
      {
        protocol: 'https',
        hostname: 'db.chunirec.net', // For scraped images from this domain
        port: '',
        pathname: '/**', // Allow any path since scraped URLs can vary
      }
    ],
  },
  env: {
    // It's better to prefix with NEXT_PUBLIC_ if you intend to use it client-side directly
    // However, for API routes, process.env.CHUNIREC_API_TOKEN works fine
    CHUNIREC_API_TOKEN: process.env.CHUNIREC_API_TOKEN,
    NEXT_PUBLIC_CHUNIREC_API_TOKEN: process.env.CHUNIREC_API_TOKEN, // Exposing for client-side API calls
  }
};

export default nextConfig;

// environment variables in vercel