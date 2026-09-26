"use client";

import { ArrowRightFromSquare, Calendar, ClockArrowRotateLeft, Moon, Persons, Sun } from "@gravity-ui/icons";
import { AsideHeader, FooterItem, MobileHeader } from "@gravity-ui/navigation";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useThemeMode } from "./Providers";
import { logout as logoutLocal } from "@/lib/client/data";

const NAV = [
  { id: "events", title: "Мероприятия", icon: Calendar, path: "/", match: (p: string) => p === "/" || p.startsWith("/event") },
  { id: "federations", title: "Отделения ФСП", icon: Persons, path: "/federations", match: (p: string) => p.startsWith("/federations") },
  { id: "sources", title: "Источники и история", icon: ClockArrowRotateLeft, path: "/sources", match: (p: string) => p.startsWith("/sources") },
];

function useIsMobile() {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(max-width: 768px)");
    const upd = () => setM(mq.matches);
    upd();
    mq.addEventListener("change", upd);
    return () => mq.removeEventListener("change", upd);
  }, []);
  return m;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { theme, toggle } = useThemeMode();
  const [compact, setCompact] = useState(false);
  const isMobile = useIsMobile();

  if (pathname.startsWith("/login")) return <>{children}</>;

  const logout = () => {
    logoutLocal();
    router.push("/login/");
  };
  const themeItem = { id: "theme", title: theme === "dark" ? "Светлая тема" : "Тёмная тема", icon: theme === "dark" ? Sun : Moon, onItemClick: toggle };
  const logo = { text: "ЕКП · Спорт. программирование", icon: Calendar, onClick: () => router.push("/") };

  if (isMobile) {
    return (
      <MobileHeader
        logo={logo}
        burgerMenu={{
          items: [
            ...NAV.map((n) => ({ id: n.id, title: n.title, icon: n.icon, current: n.match(pathname), closeMenuOnClick: true, onItemClick: () => router.push(n.path) })),
            { id: "div", title: "", type: "divider" as const },
            { ...themeItem, closeMenuOnClick: false },
            { id: "logout", title: "Выйти", icon: ArrowRightFromSquare, closeMenuOnClick: true, onItemClick: logout },
          ],
        }}
        renderContent={() => <div className="app-content app-content_mobile">{children}</div>}
      />
    );
  }

  return (
    <AsideHeader
      compact={compact}
      onChangeCompact={setCompact}
      headerDecoration
      logo={logo}
      menuItems={NAV.map((n) => ({ id: n.id, title: n.title, icon: n.icon, current: n.match(pathname), onItemClick: () => router.push(n.path) }))}
      renderContent={() => <div className="app-content">{children}</div>}
      renderFooter={() => (
        <>
          <FooterItem compact={compact} {...themeItem} />
          <FooterItem compact={compact} id="logout" title="Выйти" icon={ArrowRightFromSquare} onItemClick={logout} />
        </>
      )}
    />
  );
}
