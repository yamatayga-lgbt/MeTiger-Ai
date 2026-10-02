#!/usr/bin/env bash
# Включение связки MEMORY целиком: KV-неймспейс → байндинг в wrangler.toml →
# секреты → деплой → проверка прода. Без --apply только показывает план.
#
#   bash scripts/kv-onboard.sh                 план (ничего не трогает)
#   bash scripts/kv-onboard.sh --apply         делает всё
#   bash scripts/kv-onboard.sh --apply --create-only      только создать неймспейс
#   bash scripts/kv-onboard.sh --apply --no-deploy        файл и секреты, прод не трогать
#
# Почему байндинг через файл, а не через API (проверено 02.10.26 на одноразовом
# проекте этого аккаунта): PUT /pages/projects/{name} отвечает `1001
# method_not_allowed`, а PATCH принимает только 7 ключей deployment_configs и
# поле kv_namespace_bindings молча выбрасывает. Зато [[kv_namespaces]] из
# wrangler.toml применяется и при `pages deploy`, и с positional-каталогом —
# ровно так, как зовёт его scripts/publish.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
SECRETS="$REPO/../.secrets.env"
TOML="$REPO/wrangler.toml"
PROJECT=${PAGES_PROJECT:-metiger-ai}
NS_TITLE=${KV_NAMESPACE:-metiger-memory}
BIND=${KV_BINDING:-MEMORY}
PROD=https://metiger-ai.pages.dev
APPLY=0; DO_DEPLOY=1; ONLY_CREATE=0
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --no-deploy) DO_DEPLOY=0 ;;
    --create-only) ONLY_CREATE=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "не знаю флаг: $a (справка: --help)" >&2; exit 2 ;;
  esac
done
say() { printf '%s\n' "$*"; }
run() { if [ "$APPLY" = 1 ]; then "$@"; else say "  [dry] $*"; fi; }

[ -f "$SECRETS" ] || { say "нет $SECRETS — нечем стучаться в API"; exit 1; }
CF_TOKEN=$(grep -oP '^CF_TOKEN=\K.*' "$SECRETS" | head -1)
ACCT=$(grep -oP '^CF_ACCOUNT=\K.*' "$SECRETS" | head -1)
[ -n "$CF_TOKEN" ] && [ -n "$ACCT" ] || { say "в $SECRETS нет CF_TOKEN или CF_ACCOUNT"; exit 1; }
api() { # api <METHOD> <path> [json]
  local m=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -s -X "$m" -H "Authorization: Bearer $CF_TOKEN" -H 'content-type: application/json' \
      --data "$body" "https://api.cloudflare.com/client/v4$path"
  else
    curl -s -X "$m" -H "Authorization: Bearer $CF_TOKEN" "https://api.cloudflare.com/client/v4$path"
  fi
}
# wrangler берёт креды из окружения — без этого он молча падает на аутентификации,
# и «секрет не лёг» выглядит как проблема прав, а не как забытый export.
export CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$ACCT"
WRANGLER="npx --yes wrangler@3"
[ -x node_modules/.bin/wrangler ] && WRANGLER="node_modules/.bin/wrangler"

say "MeTiger · включение связки $BIND"
say "  проект:    $PROJECT · неймспейс: $NS_TITLE · прод: $PROD"
[ "$APPLY" = 1 ] || say "  режим:     план (запуск с --apply меняет)"

# ── 1. право и неймспейс ───────────────────────────────────────────────────────
say "── доступ к KV"
NS_ID=$(api GET "/accounts/$ACCT/storage/kv/namespaces" | NS_TITLE="$NS_TITLE" python3 -c "
import json, os, sys
d = json.load(sys.stdin)
if not d.get('success'):
    e = (d.get('errors') or [{}])[0]
    print('ERR %s %s' % (e.get('code'), e.get('message')))
else:
    want = os.environ['NS_TITLE']
    print(next((r['id'] for r in (d.get('result') or []) if r.get('title') == want), 'NONE'))
")
case "$NS_ID" in
  ERR*10000*|*Authentication*)
    say "  токеному праву не хватает Account · Workers KV Storage · Edit"
    say "  (My Profile → API Tokens → Create Custom Token: Workers KV Storage · Edit,"
    say "   + Cloudflare Pages · Edit — для секретов и деплоя)"
    exit 1 ;;
  ERR*) say "  API отказало: $NS_ID"; exit 1 ;;
  NONE) say "  неймспейса «$NS_TITLE» нет — создам" ;;
  *)    say "  неймспейс есть: ${NS_ID:0:12}…" ;;
esac
if [ "$NS_ID" = "NONE" ]; then
  RES=$(run api POST "/accounts/$ACCT/storage/kv/namespaces" "{\"title\":\"$NS_TITLE\"}")
  [ "$APPLY" = 1 ] || { say "  [dry] POST storage/kv/namespaces {title:$NS_TITLE}"; exit 0; }
  NS_ID=$(printf '%s' "$RES" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print((d.get('result') or {}).get('id','') if d.get('success') else '')
")
  [ -n "$NS_ID" ] || { say "  создать не вышло: $(printf '%s' "$RES" | head -c 160)"; exit 1; }
  say "  создан: ${NS_ID:0:12}…"
fi
[ "$ONLY_CREATE" = 1 ] && { say "готово: неймспейс ${NS_ID:0:12}… (дальше --apply без --create-only)"; exit 0; }

# ── 2. байндинг в wrangler.toml ────────────────────────────────────────────────
say "── байндинг в $TOML"
if [ -f "$TOML" ] && grep -q "binding = \"$BIND\"" "$TOML"; then
  CUR=$(grep -A3 "binding = \"$BIND\"" "$TOML" | grep -oP 'id = "\K[^"]+' | head -1)
  if [ "$CUR" = "$NS_ID" ]; then
    say "  уже прописан на ${NS_ID:0:12}…"
  else
    say "  прописан на другой id (${CUR:-пусто}) — правлю на ${NS_ID:0:12}…"
    [ "$APPLY" = 1 ] && python3 - "$TOML" "$BIND" "$CUR" "$NS_ID" <<'PY'
import sys
p, bind, old, new = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
s = open(p, encoding='utf-8').read()
lines = s.split('\n')
for n, line in enumerate(lines):
    if line.strip() == 'binding = "%s"' % bind:
        for m in range(n, min(n + 4, len(lines))):
            if lines[m].lstrip().startswith('id ='):
                lines[m] = 'id = "%s"' % new
                break
        break
open(p, 'w', encoding='utf-8').write('\n'.join(lines))
PY
  fi
elif [ -f "$TOML" ]; then
  [ "$APPLY" = 1 ] && printf '\n[[kv_namespaces]]\nbinding = "%s"\nid = "%s"\n' "$BIND" "$NS_ID" >> "$TOML"
  say "  блок [[kv_namespaces]] дописан"
else
  [ "$APPLY" = 1 ] && printf 'name = "%s"\npages_build_output_dir = "./dist"\ncompatibility_date = "2026-09-30"\n\n[[kv_namespaces]]\nbinding = "%s"\nid = "%s"\n' "$PROJECT" "$BIND" "$NS_ID" > "$TOML"
  say "  файла не было — создан"
fi

# ── 3. секреты, которые включает скрипт ────────────────────────────────────────
say "── переменные"
if [ "$APPLY" = 1 ]; then
  if printf '%s' "${MEMORY_SUMMARIZE:-1}" | $WRANGLER pages secret put MEMORY_SUMMARIZE --project-name "$PROJECT" >/dev/null 2>&1; then
    say "  MEMORY_SUMMARIZE=${MEMORY_SUMMARIZE:-1} лежит"
  else
    say "  ⚠ MEMORY_SUMMARIZE не легло — проверь право Cloudflare Pages · Edit"
  fi
else
  say "  [dry] wrangler pages secret put MEMORY_SUMMARIZE (=1)"
fi

# ── 4. деплой и проверка ───────────────────────────────────────────────────────
if [ "$DO_DEPLOY" = 1 ]; then
  say "── деплой (байндинг применяется именно на деплое)"
  if [ "$APPLY" = 1 ]; then bash scripts/publish.sh --fast; else say "  [dry] bash scripts/publish.sh --fast"; fi
fi
# Проверки идут и без деплоя: --no-deploy нужен именно чтобы проверить,
# не дёргая прод вторично.
if [ "$APPLY" = 1 ]; then
  say "── проверка прода"
  sleep 8
  api GET "/accounts/$ACCT/storage/kv/namespaces/$NS_ID/keys" | python3 -c "
import json,sys
d=json.load(sys.stdin); r=d.get('result') or []
# ответ бывает и {'keys': [...]}, и просто списком — принимаем обе формы
ks = r.get('keys') if isinstance(r, dict) else r
ks = ks or []
print('  неймспейс отвечает, ключей:', len(ks), [k.get('name') for k in ks][:4])
"
  curl -s "$PROD/api/chat" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  limits:', json.dumps(d.get('limits'),ensure_ascii=False))
"
  curl -s "$PROD/telegram/webhook" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  memory:', d.get('memory'), '| limits:', d.get('limits'))
"
  printf '{"text":"запомни число 4242","chatId":"onboard-check"}' > /tmp/kv1.json
  printf '{"text":"какое число я просил запомнить?","chatId":"onboard-check"}' > /tmp/kv2.json
  curl -s -X POST "$PROD/api/chat" -H 'content-type: application/json' --data @/tmp/kv1.json >/dev/null
  curl -s -X POST "$PROD/api/chat" -H 'content-type: application/json' --data @/tmp/kv2.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  ответ:', (d.get('reply') or d.get('error') or '')[:130])
print('  память:', json.dumps(d.get('memory'),ensure_ascii=False)[:200])
"
  printf '{"forget":true,"text":"/forget","chatId":"onboard-check"}' > /tmp/kv3.json
  curl -s -X POST "$PROD/api/chat" -H 'content-type: application/json' --data @/tmp/kv3.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  /forget:', d.get('forgotten'), '| память после:', json.dumps(d.get('memory'),ensure_ascii=False)[:140])
"
  rm -f /tmp/kv1.json /tmp/kv2.json /tmp/kv3.json
fi
say "готово"
