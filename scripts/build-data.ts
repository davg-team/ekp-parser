// Данные для статического сайта: data/dataset.json → public/data.enc (DATA_PASSWORD задан) или public/data.json.
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { seal } from "../lib/crypto";

const src = process.env.DATA_FILE ?? "data/dataset.json";
const { views: _v, extractCache: _c, ...ds } = JSON.parse(await readFile(src, "utf8"));
const plain = JSON.stringify(ds);

await mkdir("public", { recursive: true });
await rm("public/data.json", { force: true });
await rm("public/data.enc", { force: true });
const password = process.env.DATA_PASSWORD;
if (password) {
  await writeFile("public/data.enc", JSON.stringify(await seal(plain, password)));
  console.log(`public/data.enc: ${ds.events.length} мероприятий, зашифровано`);
} else {
  await writeFile("public/data.json", plain);
  console.log(`public/data.json: ${ds.events.length} мероприятий, БЕЗ пароля (DATA_PASSWORD не задан)`);
}
