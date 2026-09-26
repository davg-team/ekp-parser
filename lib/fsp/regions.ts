import { parse } from "node-html-parser";
import { fetchText } from "../http";
import { findRegion } from "../regions";
import type { Federation } from "../types";

export const FSP_BASE = "https://fsp-russia.ru";
export const FSP_REGIONS_URL = `${FSP_BASE}/region/regions/`;

const clean = (s: string | undefined | null) => (s ?? "").replace(/\s+/g, " ").trim();

/** Страница «Регионы»: аккордеон по федеральным округам, в каждом — строки «Субъект / Руководитель / Контакты». */
export function parseFederations(html: string, now = new Date().toISOString()): Federation[] {
  const root = parse(html);
  const out: Federation[] = [];
  const seen = new Set<string>();
  {
    for (const row of root.querySelectorAll(".contact_td")) {
      let acc = row.parentNode;
      while (acc && !acc.classList?.contains("accordion-item")) acc = acc.parentNode;
      const foTitle = clean(acc?.querySelector(".accordion-header h4")?.text);
      const sub = row.querySelector(".cont.sub");
      const link = sub?.querySelector("a")?.getAttribute("href") ?? null;
      const regionText = clean(sub?.querySelector(".white_region")?.text);
      if (!regionText || seen.has(regionText)) continue;
      seen.add(regionText);
      const head = clean(row.querySelector(".cont.ruk .white_region")?.text) || null;
      const contact = clean(row.querySelector(".cont.con .white_region")?.text);
      const emails = contact.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
      const phones = contact.match(/\+?\d[\d\s()-]{8,}\d/g) ?? [];
      const region = findRegion(regionText);
      out.push({
        regionCode: region?.code ?? null,
        region: region?.name ?? regionText,
        federalDistrict: region?.fo ?? (foTitle.replace(/\s*федеральный округ\s*/i, "") || null),
        name: `ФСП — ${region?.name ?? regionText}`,
        head,
        phone: phones[0]?.trim() ?? null,
        email: emails[0] ?? null,
        site: null,
        socials: [],
        address: null,
        url: link ? new URL(link, FSP_BASE).toString() : null,
        updatedAt: now,
      });
    }
  }
  return out;
}

export async function fetchFederations(): Promise<Federation[]> {
  return parseFederations(await fetchText(FSP_REGIONS_URL));
}
