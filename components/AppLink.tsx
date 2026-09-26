"use client";

import { Link, type LinkProps } from "@gravity-ui/uikit";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/client/data";

/** Ссылка uikit с клиентской навигацией Next (без перезагрузки страницы). */
export function AppLink({ href, ...rest }: LinkProps & { href: string }) {
  const router = useRouter();
  return (
    <Link
      {...rest}
      // в href — полный путь (basePath GitHub Pages) для открытия в новой вкладке; router.push добавляет его сам
      href={href.startsWith("/") ? BASE_PATH + href : href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(href);
      }}
    />
  );
}
