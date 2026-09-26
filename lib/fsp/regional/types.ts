import type { Incoming } from "../../sync/merge";
import type { SportEvent } from "../../types";

/** Пост из канала или группы отделения. */
export type Post = {
  /** стабильный ключ внутри источника (номер поста) */
  key: string;
  /** номер поста для окна просмотра; растёт со временем */
  seq: number;
  url: string;
  /** дата публикации YYYY-MM-DD */
  date: string;
  text: string;
};

export interface RegionAdapter {
  /** tg-<канал> / vk-<группа> */
  id: string;
  /** код субъекта */
  region: number;
  url: string;
  fetch(): Promise<Incoming[]>;
  /** Записи этого адаптера, которые покрыл последний fetch (по окну просмотренных постов). */
  inScope(e: SportEvent): boolean;
}

/** Id записи: region:<адаптер>:<ключ поста>[-<№ мероприятия в посте>] */
export const eventId = (adapter: string, postKey: string, n: number) =>
  `region:${adapter}:${postKey}${n ? `-${n}` : ""}`;

/** Номер поста из id записи (для окна). */
export function postSeq(id: string): number | null {
  const m = id.match(/:(\d+)(?:-\d+)?$/);
  return m ? Number(m[1]) : null;
}

/** inScope по окну [minSeq, maxSeq] просмотренных постов. */
export function windowScope(adapter: string, posts: Post[]): (e: SportEvent) => boolean {
  if (!posts.length) return () => false;
  const min = Math.min(...posts.map((p) => p.seq));
  const max = Math.max(...posts.map((p) => p.seq));
  const prefix = `region:${adapter}:`;
  return (e) => {
    if (!e.id.startsWith(prefix)) return false;
    const s = postSeq(e.id);
    return s != null && s >= min && s <= max;
  };
}
