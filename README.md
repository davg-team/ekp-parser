# ekp-parser

Каталог мероприятий по **спортивному программированию** для поиска организаторов (продажи хакатонов и т.п.).

Источники:

| Источник | Что берём | Как |
|---|---|---|
| [ЕКП Минспорта](https://www.minsport.gov.ru/activity/government-regulation/edinyj-kalendarnyj-plan/), часть II (PDF ~37 МБ, ~2700 стр.) | раздел «СПОРТИВНОЕ ПРОГРАММИРОВАНИЕ» за текущий и 2 прошлых года | `lib/ekp/*` — pdfjs, разбор по x-координатам колонок |
| [fsp-russia.ru/region/regions](https://fsp-russia.ru/region/regions/) | 89 региональных отделений: руководитель, e-mail | `lib/fsp/regions.ts` |
| [fsp-russia.ru/calendar](https://fsp-russia.ru/calendar/) | календарь ФСП (±12 месяцев) | `lib/fsp/calendar.ts` |
| Telegram-каналы и группы VK региональных отделений ([справочник](data/regional-sources.json), [разведка](docs/regional-sources.md)) | анонсы региональных соревнований и хакатонов | `lib/fsp/regional/*` — посты → мероприятия по правилам (ключевые слова, даты) |

Новая версия ЕКП определяется по URL файла (в имени — дата актуализации). Изменения
мероприятий пишутся в историю (добавлено / изменено поле / исключено / возвращено).
Записи ФСП автоматически связываются с записями ЕКП (даты + субъект + дисциплина).

## Стек

Один Next.js 16 (API + UI на Gravity UI). Всё состояние — один JSON (`lib/store`):
локально `.data/dataset.json`, в облаке — объект в Object Storage (данных — сотни записей,
отдельная БД не нужна). Фильтры и сортировка — на сервере по AST (`lib/filters`).

Yandex Cloud: Cloud Function (standalone Next + `server/yc-handler.mjs`) за API Gateway,
статика `/_next/static` из бакета, ежедневный timer-триггер → `POST /api/cron/sync`.

## Локально

```bash
pnpm install
pnpm sync          # скачать ЕКП и ФСП в .data/dataset.json (~40 с)
pnpm dev           # http://localhost:3000
pnpm test
```

`pnpm sync regional` — только региональные отделения (Telegram без ключей; VK — при `VK_SERVICE_TOKEN`).
`pnpm sync ekp --force` — перепарсить ЕКП даже без новой версии. Пароль входа — `APP_PASSWORD`
(не задан — вход не спрашивается), см. `.env.example`.

## Фильтры

Быстрые фильтры (статус, год, уровень, дисциплины, ФО, субъект, источник, формат, период)
и конструктор «Сложный фильтр»: вложенные группы И/ИЛИ с инверсией НЕ, операторы по типу поля
(текст, списки, даты в т.ч. «ближайшие N дней» / «этот квартал», числа, да/нет). Всё состояние —
в URL, им можно делиться; можно сохранить как «Представление». Сортировка по нескольким
колонкам — ⌘/Ctrl + клик по заголовку. Выгрузка текущей выборки — CSV (Excel, `;`).

## Деплой

Один раз:

```bash
yc init                                   # аккаунт с правом создавать ресурсы
CLOUD_ID=<id> ./scripts/yc-bootstrap.sh   # создаст каталог ekp-parser
# или в существующий каталог:
FOLDER_ID=<id> ./scripts/yc-bootstrap.sh
```

Скрипт идемпотентный: сервисные аккаунты, бакет, функция (+ первая версия), API Gateway,
timer-триггер, OIDC-федерация для GitHub Actions и переменные репозитория. Секреты
(`APP_PASSWORD`, `SESSION_SECRET`, `CRON_SECRET`) — в `.env.prod.local` (не в git).

Дальше каждый push в `main` деплоится `.github/workflows/deploy.yml`; вручную — `./scripts/deploy.sh`.
