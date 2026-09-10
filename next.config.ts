import type { NextConfig } from "next";

/**
 * This app has no UI worth framing and no wallet, so framing stays denied. If a Telegram Mini App
 * is ever served from here, the header below is the one line that has to change, and it changes to
 * a named `frame-ancestors` list (Telegram Web embeds a Mini App in an iframe; mobile clients use a
 * WebView and would work either way).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],
};

export default nextConfig;
