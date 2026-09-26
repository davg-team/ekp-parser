#!/usr/bin/env bash
# Собирает deploy/ — содержимое Cloud Function: standalone-сборка Next + адаптер.
set -euo pipefail
cd "$(dirname "$0")/.."

[ "${SKIP_BUILD:-}" = 1 ] || pnpm build

rm -rf deploy deploy.zip
mkdir -p deploy
cp -R -L .next/standalone/. deploy/
mkdir -p deploy/.next/static
cp -R .next/static/. deploy/.next/static/
[ -d public ] && cp -R public deploy/public
cp -R server deploy/server
# pdfjs: воркер грузится динамически — кладём пакет целиком.
rm -rf deploy/node_modules/pdfjs-dist
cp -R -L node_modules/pdfjs-dist deploy/node_modules/pdfjs-dist
rm -rf deploy/.data deploy/node_modules/pdfjs-dist/{web,image_decoders,types} deploy/node_modules/pdfjs-dist/build
find deploy -name "*.map" -delete
# sharp (оптимизация картинок) не нужен: картинок нет, а бинарники собраны под ОС сборки.
find deploy/node_modules \( -name "sharp*" -o -name "@img*" \) -maxdepth 3 -prune -exec rm -rf {} +
(cd deploy && zip -qr ../deploy.zip .)
du -sh deploy deploy.zip
