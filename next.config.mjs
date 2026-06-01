/** @type {import('next').NextConfig} */
const nextConfig = {
  // jsdom은 번들링하지 않고 Node에서 직접 require (canvas 등 선택적 네이티브 의존성 회피)
  experimental: {
    serverComponentsExternalPackages: ["jsdom"],
  },
};

export default nextConfig;
