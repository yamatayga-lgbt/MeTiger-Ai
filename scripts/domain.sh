#!/usr/bin/env bash
# Свой адрес для MeTiger Ai — чтобы приложение открывалось без VPN и чужих DNS.
#
#   npm run domain -- metiger.example.com          привязать адрес
#   npm run domain -- metiger.example.com --status только проверить
#   npm run domain -- metiger.example.com --remove отвязать
#
# Почему это нужно вообще: *.pages.dev режут провайдеры в ряде стран — режут по
# имени в TLS, поэтому сервер жив, а браузер «не видит сети». Свой адрес уходит
# от этого фильтра: имя другое, а отдаёт его тот же Cloudflare.
#
# Что делает скрипт:
#   1. привязывает имя к проекту Pages (без этого Cloudflare ответит 522, даже
#      если DNS уже настроен — так устроена привязка по имени хоста);
#   2. печатает точную запись CNAME, которую надо добавить у регистратора;
#   3. ждёт, пока Cloudflare выпустит сертификат и имя станет активным;
#   4. проверяет живой /api/usage уже на новом адресе.
#
# Секреты берутся из окружения или из keys/.secrets.env и никогда не печатаются.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO=$PWD
SECRETS=${METIGER_SECRETS:-$REPO/keys/.secrets.env}
[ -f "$SECRETS" ] || SECRETS="$REPO/../.secrets.env"
PROJECT=${PAGES_PROJECT:-metiger-ai}
PAGES_HOST="${PROJECT}.pages.dev"

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

DOMAIN=""
MODE="add"
for arg in "$@"; do
  case "$arg" in
    --status) MODE="status" ;;
    --remove) MODE="remove" ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    -*) die "неизвестный флаг: $arg (справка: --help)" ;;
    *) DOMAIN="$arg" ;;
  esac
done
[ -n "$DOMAIN" ] || die "нужен адрес: npm run domain -- metiger.example.com"

pull() {
  [ -n "${!1:-}" ] && return 0
  [ -f "$SECRETS" ] || return 0
  export "$1=$(grep -oP "^$1=\K.*" "$SECRETS" | head -1)"
}
pull CF_TOKEN
pull CF_ACCOUNT
: "${CLOUDFLARE_API_TOKEN:=${CF_TOKEN:-}}"
: "${CLOUDFLARE_ACCOUNT_ID:=${CF_ACCOUNT:-}}"
[ -n "$CLOUDFLARE_API_TOKEN" ] || die "нет CF_TOKEN (окружение или $SECRETS)"
[ -n "$CLOUDFLARE_ACCOUNT_ID" ] || die "нет CF_ACCOUNT (окружение или $SECRETS)"

API="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${PROJECT}/domains"

# Ответ API разбираем питоном: он есть везде, где есть wrangler, и не тащит jq.
api() {
  local method=$1 url=$2 data=${3:-}
  if [ -n "$data" ]; then
    curl -s -X "$method" "$url" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
      -H "content-type: application/json" --data-binary "$data"
  else
    curl -s -X "$method" "$url" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  fi
}

show() {
  python3 - "$1" <<'PY'
import json, sys
raw = sys.argv[1]
try:
    d = json.loads(raw)
except Exception:
    print('  ответ не разобрать:', raw[:200]); raise SystemExit(0)
if not d.get('success'):
    errs = d.get('errors') or []
    print('  ошибка API:', '; '.join((e.get('message') or '') for e in errs)[:300] or raw[:200])
    raise SystemExit(0)
for x in d.get('result') or []:
    v = (x.get('validation_data') or {})
    print('  {name} — {status} (проверка: {v})'.format(
        name=x.get('name'), status=x.get('status'), v=v.get('status') or '—'))
PY
}

if [ "$MODE" = "status" ]; then
  say "Домены проекта ${PROJECT}:"
  show "$(api GET "$API")"
  exit 0
fi

if [ "$MODE" = "remove" ]; then
  say "Отвязываю ${DOMAIN} от проекта…"
  show "$(api DELETE "$API/$DOMAIN")"
  say "Готово. Сам адрес у регистратора остаётся — уберите там CNAME, если он больше не нужен."
  exit 0
fi

case "$DOMAIN" in
  *" "*) die "в адресе не должно быть пробелов" ;;
  *.*) : ;;
  *) die "это не похоже на домен: $DOMAIN" ;;
esac
case "$DOMAIN" in
  *.pages.dev) die "pages.dev привязывать незачем — это и есть адрес, который режут" ;;
esac

say "Привязываю ${DOMAIN} к проекту ${PROJECT}…"
OUT=$(api POST "$API" "{\"name\":\"${DOMAIN}\"}")
ERR=$(printf '%s' "$OUT" | python3 -c 'import json,sys;d=json.load(sys.stdin);print(";".join((e.get("message") or "") for e in (d.get("errors") or [])))' 2>/dev/null || true)
if [ -n "$ERR" ] && [ "$ERR" != "" ]; then
  case "$ERR" in
    *already*|*duplicate*|*exists*) say "  уже привязан — продолжаю" ;;
    *) say "  Cloudflare ответил: $ERR"; say "  это не всегда отказ: часть ошибок значит «уже в работе»";;
  esac
fi

say ""
say "Теперь добавьте у регистратора ровно одну запись:"
say "  тип   CNAME"
say "  имя   ${DOMAIN}"
say "  куда  ${PAGES_HOST}"
say ""
say "Если DNS этого домена уже в Cloudflare — запись создастся сама,"
say "и ждать останется только сертификат."
say ""

say "Жду активации (обычно от минуты до часа, иногда дольше)…"
for i in $(seq 1 60); do
  STATE=$(api GET "$API/$DOMAIN" | python3 -c '
import json,sys
try: d=json.load(sys.stdin)
except Exception: print("unknown"); raise SystemExit(0)
r=d.get("result") or {}
v=(r.get("validation_data") or {}).get("status") or ""
print((r.get("status") or "unknown") + ("/" + v if v else ""))
' 2>/dev/null || echo unknown)
  say "  [${i}] ${DOMAIN}: ${STATE}"
  case "$STATE" in
    active*)
      say ""
      say "Адрес активен: https://${DOMAIN}"
      CODE=$(curl -s -o /tmp/mt-domain-check.json -w '%{http_code}' "https://${DOMAIN}/api/usage" || echo 000)
      if [ "$CODE" = "200" ] && grep -q '"ok":true' /tmp/mt-domain-check.json; then
        say "Проверка API на новом адресе: 200, ответ живой."
        say ""
        say "Дальше: откройте https://${DOMAIN} на телефоне и добавьте на домашний экран заново —"
        say "иконка со старого адреса продолжит ходить на pages.dev."
      else
        say "Привязка есть, но /api/usage ответил ${CODE}: подождите пару минут (сертификат) и проверьте снова."
      fi
      exit 0 ;;
    pending*|unknown) : ;;
    *) say "  статус: ${STATE} — если так и останется, проверьте CNAME у регистратора." ;;
  esac
  sleep 30
done
say ""
say "За полчаса не активировался. Это нормально, если CNAME ещё не прописался."
say "Вернитесь позже:  npm run domain -- ${DOMAIN} --status"
