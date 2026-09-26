import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Статический сайт для GitHub Pages: данные — public/data.{json,enc}, всё считается в браузере.
  output: "export",
  // Pages отдаёт каталоги как <путь>/index.html
  trailingSlash: true,
  // сайт проекта живёт в /<репозиторий>; путь задаёт workflow pages.yml
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  images: { unoptimized: true },
  // @gravity-ui/* не размечены под RSC — без транспиляции падают с «createContext only works in Client Components».
  transpilePackages: ["@gravity-ui/uikit", "@gravity-ui/navigation", "@gravity-ui/date-components", "@gravity-ui/components"],
};

export default nextConfig;
