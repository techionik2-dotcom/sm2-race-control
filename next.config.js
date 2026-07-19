/** @type {import('next').NextConfig} */
const trimTrailingSlash = (value) => String(value || "").replace(/\/+$/, "");

const normalizeApiProxyTarget = (value) => {
  const target = trimTrailingSlash(value || "http://127.0.0.1:8000");
  return target.replace(/\/api\/v1$/i, "");
};

const apiProxyTarget = normalizeApiProxyTarget(
  process.env.SM2_API_PROXY_TARGET ||
    process.env.BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_PROXY_TARGET,
);

const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: "/api/v1/:path*",
        destination: `${apiProxyTarget}/api/v1/:path*`,
      },
    ];
  },
}

module.exports = nextConfig
