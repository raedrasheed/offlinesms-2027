/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@offlinesms/design-tokens'],
  experimental: { typedRoutes: true },
};
module.exports = nextConfig;
