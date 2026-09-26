#!/usr/bin/env bash
# Ручной деплой из локальной машины (CI делает то же в .github/workflows/deploy.yml):
# статику — в бакет, пакет — в бакет, новая версия функции с переменными из .env.prod.local.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck disable=SC1091
source .env.prod.local

./scripts/package.sh

yc storage s3 cp --recursive .next/static/ "s3://$BUCKET/assets/_next/static/" \
  --cache-control "public, max-age=31536000, immutable" >/dev/null
yc storage s3 cp deploy.zip "s3://$BUCKET/releases/app.zip" >/dev/null

yc serverless function version create \
  --folder-id "$FOLDER_ID" \
  --function-name ekp-parser \
  --runtime nodejs22 \
  --entrypoint server/yc-handler.handler \
  --memory 2048m \
  --execution-timeout 600s \
  --service-account-id "$SA_ID" \
  --package-bucket-name "$BUCKET" \
  --package-object-name releases/app.zip \
  --environment "NODE_ENV=production,YC_METADATA=1,DATA_BUCKET=$BUCKET,DATA_KEY=data/dataset.json,APP_PASSWORD=$APP_PASSWORD,SESSION_SECRET=$SESSION_SECRET,CRON_SECRET=$CRON_SECRET" \
  --format json | jq -r '"version " + .id + " created"'
