"use client";

import { Link, type LinkProps } from "@gravity-ui/uikit";
import { useRouter } from "next/navigation";

/** Ссылка uikit с клиентской навигацией Next (без перезагрузки страницы). */
export function AppLink({ href, ...rest }: LinkProps & { href: string }) {
  const router = useRouter();
  return (
    <Link
      {...rest}
      href={href}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        router.push(href);
      }}
    />
  );
}
