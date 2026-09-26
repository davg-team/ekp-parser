import { localApi } from "./api";
import { BASE_PATH, NeedPassword } from "./data";

/** Запросы к «API» обслуживаются в браузере; нет ключа к данным — на страницу входа. */
export async function getJson<T>(url: string): Promise<T> {
  try {
    return await localApi<T>(url);
  } catch (e) {
    if (e instanceof NeedPassword) {
      const here = location.pathname.slice(BASE_PATH.length) + location.search;
      location.href = `${BASE_PATH}/login/?next=${encodeURIComponent(here)}`;
    }
    throw e;
  }
}
