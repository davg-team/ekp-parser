#!/usr/bin/env bash
# Одноразовая (и повторяемая) подготовка Yandex Cloud: каталог, сервисные аккаунты,
# бакет, функция, API Gateway, timer-триггер, OIDC-федерация для GitHub Actions.
# Каждый шаг сначала проверяет, есть ли ресурс. Секреты и id пишутся в .env.prod.local.
#
#   CLOUD_ID=<id> ./scripts/yc-bootstrap.sh          # создать каталог ekp-parser
#   FOLDER_ID=<id> ./scripts/yc-bootstrap.sh         # или развернуть в существующем
set -euo pipefail
cd "$(dirname "$0")/.."
export YC_CLI_INITIALIZATION_SILENCE=true

CLOUD_ID="${CLOUD_ID:-$(yc config get cloud-id)}"
FOLDER_NAME="${FOLDER_NAME:-ekp-parser}"
GITHUB_REPO="${GITHUB_REPO:-davg-team/ekp-parser}"
CRON="${CRON:-0 3 ? * * *}" # ежедневно 06:00 МСК (cron YC — в UTC)
ENV_FILE=.env.prod.local

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
id_of() { jq -r '.id // empty'; }

[ -f "$ENV_FILE" ] && source "$ENV_FILE"
gen() { openssl rand -base64 32 | tr -d '/+=' | cut -c1-32; }
APP_PASSWORD="${APP_PASSWORD:-$(openssl rand -base64 12 | tr -d '/+=')}"
SESSION_SECRET="${SESSION_SECRET:-$(gen)}"
CRON_SECRET="${CRON_SECRET:-$(gen)}"

say "Каталог $FOLDER_NAME в облаке $CLOUD_ID"
# FOLDER_ID можно передать явно — тогда используется готовый каталог (нужна роль editor на нём).
[ -n "${FOLDER_ID:-}" ] || FOLDER_ID=$(yc resource-manager folder get --cloud-id "$CLOUD_ID" --name "$FOLDER_NAME" --format json 2>/dev/null | id_of || true)
[ -n "$FOLDER_ID" ] || FOLDER_ID=$(yc resource-manager folder create --cloud-id "$CLOUD_ID" --name "$FOLDER_NAME" --format json | id_of)
F=(--folder-id "$FOLDER_ID")

ensure_sa() {
  local name=$1 id
  id=$(yc iam service-account get --name "$name" "${F[@]}" --format json 2>/dev/null | id_of || true)
  [ -n "$id" ] || id=$(yc iam service-account create --name "$name" "${F[@]}" --format json | id_of)
  echo "$id"
}
bind() { yc resource-manager folder add-access-binding "$FOLDER_ID" --role "$1" --service-account-id "$2" >/dev/null 2>&1 || true; }

say "Сервисные аккаунты"
SA_ID=$(ensure_sa ekp-app) # рантайм функции, шлюз, триггер
for r in storage.editor functions.functionInvoker; do bind "$r" "$SA_ID"; done
CI_SA_ID=$(ensure_sa ekp-ci) # GitHub Actions
for r in functions.editor storage.editor iam.serviceAccounts.user; do bind "$r" "$CI_SA_ID"; done

BUCKET="${BUCKET:-ekp-parser-${FOLDER_ID}}"
say "Бакет $BUCKET"
yc storage bucket get "$BUCKET" >/dev/null 2>&1 || yc storage bucket create --name "$BUCKET" "${F[@]}" >/dev/null

cat >"$ENV_FILE" <<ENV
CLOUD_ID=$CLOUD_ID
FOLDER_ID=$FOLDER_ID
SA_ID=$SA_ID
CI_SA_ID=$CI_SA_ID
BUCKET=$BUCKET
APP_PASSWORD=$APP_PASSWORD
SESSION_SECRET=$SESSION_SECRET
CRON_SECRET=$CRON_SECRET
ENV
chmod 600 "$ENV_FILE"

say "Функция"
FUNCTION_ID=$(yc serverless function get --name ekp-parser "${F[@]}" --format json 2>/dev/null | id_of || true)
[ -n "$FUNCTION_ID" ] || FUNCTION_ID=$(yc serverless function create --name ekp-parser "${F[@]}" --format json | id_of)
echo "FUNCTION_ID=$FUNCTION_ID" >>"$ENV_FILE"
if ! yc serverless function version list --function-id "$FUNCTION_ID" --format json | jq -e 'length > 0' >/dev/null; then
  say "Первая версия функции"
  ./scripts/deploy.sh
fi

say "API Gateway"
SPEC=$(mktemp)
BUCKET=$BUCKET SA_ID=$SA_ID FUNCTION_ID=$FUNCTION_ID envsubst '$BUCKET $SA_ID $FUNCTION_ID' <scripts/gateway.yaml >"$SPEC"
if yc serverless api-gateway get --name ekp-parser "${F[@]}" >/dev/null 2>&1; then
  yc serverless api-gateway update --name ekp-parser "${F[@]}" --spec "$SPEC" >/dev/null
else
  yc serverless api-gateway create --name ekp-parser "${F[@]}" --spec "$SPEC" >/dev/null
fi
rm -f "$SPEC"
DOMAIN=$(yc serverless api-gateway get --name ekp-parser "${F[@]}" --format json | jq -r .domain)
echo "APP_URL=https://$DOMAIN" >>"$ENV_FILE"

say "Timer-триггер ($CRON UTC)"
PAYLOAD=$(jq -cn --arg s "$CRON_SECRET" '{httpMethod:"POST", path:"/api/cron/sync", url:"/api/cron/sync", queryStringParameters:{job:"all"}, headers:{"x-cron-secret":$s}, body:"", isBase64Encoded:false}')
yc serverless trigger delete --name ekp-sync "${F[@]}" >/dev/null 2>&1 || true
yc serverless trigger create timer --name ekp-sync "${F[@]}" \
  --cron-expression "$CRON" --payload "$PAYLOAD" \
  --invoke-function-id "$FUNCTION_ID" --invoke-function-service-account-id "$SA_ID" \
  --retry-attempts 1 --retry-interval 60s >/dev/null

say "OIDC-федерация для $GITHUB_REPO"
ORG=${GITHUB_REPO%%/*}
FED_ID=$(yc iam workload-identity oidc federation get --name github "${F[@]}" --format json 2>/dev/null | id_of || true)
[ -n "$FED_ID" ] || FED_ID=$(yc iam workload-identity oidc federation create --name github "${F[@]}" \
  --issuer https://token.actions.githubusercontent.com \
  --audiences "https://github.com/$ORG" \
  --jwks-url https://token.actions.githubusercontent.com/.well-known/jwks --format json | id_of)
SUBJECT="repo:$GITHUB_REPO:ref:refs/heads/main"
if ! yc iam workload-identity federated-credential list --service-account-id "$CI_SA_ID" --format json | jq -e --arg s "$SUBJECT" 'map(.external_subject_id) | index($s)' >/dev/null; then
  yc iam workload-identity federated-credential create --service-account-id "$CI_SA_ID" --federation-id "$FED_ID" --external-subject-id "$SUBJECT" >/dev/null
fi

if command -v gh >/dev/null; then
  say "Переменные репозитория GitHub"
  gh variable set YC_CI_SERVICE_ACCOUNT_ID -R "$GITHUB_REPO" -b "$CI_SA_ID"
  gh variable set YC_FOLDER_ID -R "$GITHUB_REPO" -b "$FOLDER_ID"
  gh variable set YC_BUCKET_NAME -R "$GITHUB_REPO" -b "$BUCKET"
  gh variable set YC_APP_URL -R "$GITHUB_REPO" -b "https://$DOMAIN"
fi

say "Готово: https://$DOMAIN  (пароль — APP_PASSWORD в $ENV_FILE)"
