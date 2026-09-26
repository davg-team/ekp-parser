"use client";

import { ThemeProvider, Toaster, ToasterComponent, ToasterProvider, configure } from "@gravity-ui/uikit";
import { settings } from "@gravity-ui/date-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState } from "react";

// uikit не размечен под RSC — всё, что его тянет, живёт за этой клиентской границей.
configure({ lang: "ru" });
// Локаль дат грузится асинхронно; пока её нет, date-components падают («reading 'formats'»),
// поэтому интерфейс рисуем только после загрузки — и только в браузере.
const localeReady = settings.loadLocale("ru").then(() => settings.setLocale("ru"));

const toaster = new Toaster();
type Theme = "light" | "dark";
const ThemeCtx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });
export const useThemeMode = () => useContext(ThemeCtx);

const KEY = "ekp_theme";

export function Providers({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void localeReady.then(() => setReady(true));
  }, []);
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } }));
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === "dark" || saved === "light") setTheme(saved);
      else if (matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark");
    } catch {
      /* нет localStorage — светлая тема */
    }
  }, []);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next = t === "light" ? "dark" : "light";
      try {
        localStorage.setItem(KEY, next);
      } catch {}
      return next;
    });
  }, []);
  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      <ThemeProvider theme={theme}>
        <ToasterProvider toaster={toaster}>
          <QueryClientProvider client={client}>
            {ready ? children : null}
            <ToasterComponent />
          </QueryClientProvider>
        </ToasterProvider>
      </ThemeProvider>
    </ThemeCtx.Provider>
  );
}
