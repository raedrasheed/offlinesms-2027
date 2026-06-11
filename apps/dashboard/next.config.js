/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@offlinesms/design-tokens'],
  experimental: { typedRoutes: true },
  webpack: (config, { dev }) => {
    // Dev-only: avoid the webpack persistent-cache gzip allocation that OOMs
    // ("RangeError: Array buffer allocation failed") on low-memory machines.
    if (dev && config.cache && typeof config.cache === 'object') {
      config.cache.compression = false;
      config.cache.maxMemoryGenerations = 1;
    }
    return config;
  },
};
module.exports = nextConfig;
