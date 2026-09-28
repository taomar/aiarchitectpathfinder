import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  typedRoutes: false,
  serverExternalPackages: ["geoip-lite", "@azure/monitor-opentelemetry"],
  outputFileTracingIncludes: {
    "/admin": ["./node_modules/geoip-lite/data/geoip-country*.dat"],
    "/api/usage": ["./node_modules/geoip-lite/data/geoip-country*.dat"],
    "/api/admin/usage": ["./node_modules/geoip-lite/data/geoip-country*.dat"]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; connect-src 'self'; form-action 'self' https://login.microsoftonline.com https://login.windows.net; upgrade-insecure-requests"
          }
        ]
      }
    ];
  },
  webpack: (config, { isServer, webpack }) => {
    // pptxgenjs imports node-only modules via the `node:` scheme but its
    // package `browser` field maps them to `false`. Webpack 5 doesn't strip the
    // `node:` prefix automatically, so we rewrite it here, then nullify the
    // modules for the browser build.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
        resource.request = resource.request.replace(/^node:/, "");
      })
    );
    if (!isServer) {
      config.resolve.fallback = {
        ...(config.resolve.fallback || {}),
        fs: false,
        https: false,
        os: false,
        path: false,
        "image-size": false,
        express: false
      };
    }
    return config;
  }
};
export default nextConfig;
