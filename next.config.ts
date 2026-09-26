import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone — тот же артефакт запускается локально (`node server.js`) и в Cloud Function (server/yc-handler.mjs).
  output: "standalone",
  images: { unoptimized: true },
  // @gravity-ui/* не размечены под RSC — без транспиляции падают с «createContext only works in Client Components».
  transpilePackages: ["@gravity-ui/uikit", "@gravity-ui/navigation", "@gravity-ui/date-components", "@gravity-ui/components"],
  // pdfjs тянет worker и wasm-файлы по относительным путям — не бандлим.
  serverExternalPackages: ["pdfjs-dist"],
  // Воркер pdfjs грузится динамическим import() — трассировка standalone его не видит.
  outputFileTracingIncludes: {
    "/api/sync": ["./node_modules/pdfjs-dist/legacy/build/**/*"],
    "/api/cron/sync": ["./node_modules/pdfjs-dist/legacy/build/**/*"],
  },
  experimental: {
    // За API Gateway хеш RSC-заголовков не сходится и Next уходит в бесконечные 307 (см. kuznitsa-platform/web/next.config.ts).
    validateRSCRequestHeaders: false,
  },
};

export default nextConfig;
