#!/usr/bin/env bash
# Включение связки MEMORY целиком: KV-неймспейс → привязка к Pages → секреты →
# деплой → проверка прода. По умолчанию только показывает план; делает — с --apply.
#
#   bash scripts/kv-onboard.sh                 план, ничего не трогает
#   bash scripts/kv-onboard.sh --apply         делает всё
#   bash scripts/kv-onboard.sh --apply --create-only   только создать неймспейс
#   bash scripts/kv-onboard.sh --apply --no-deploy     хранилище и байндинг, прод не трогать
#   bash scripts/kv-onboard.sh --apply --no-bind       создать неймспейс, привязку не трогать
#
# Почему PATCH, а не PUT (проверено на одноразовом проекте этого аккаунта, 01.10.26):
# PUT на /pages/projects/{name} отвечает `1001 method_not_allowed`, а PATCH
# объединяет поля — secret_text и plain_text из env_vars пережили три PATCH подряд,
# в которых их не было. То есть привязка не может стереть ключи провайдеров.
# Всё равно сверяем список ключей до и после: если API когда-нибудь изменит
# семантику, скрипт это заметит и остановится, а не будет чинить молча.
# Поле байндинга: deployment_configs.production.kv_namespace_bindings — если Pages
# его проигнорирует (например, изменит форму), скрипт это проверит чтением обратно.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
SECRETS="$REPO/../.secrets.env"
DEVVARS="$REPO/.dev.vars"
PROJECT=${PAGES_PROJECT:-metiger-ai}
NS_TITLE=${KV_NAMESPACE:-metiger-memory}
BIND=${KV_BINDING:-MEMORY}
PROD=https://metiger-ai.pages.dev
APPLY=0; DO_DEPLOY=1; ONLY_CREATE=0; DO_BIND=1
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --no-deploy) DO_DEPLOY=0 ;;
    --create-only) ONLY_CREATE=1 ;;
    --no-bind) DO_BIND=0 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
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
WRANGLER="npx --yes wrangler@3"
[ -x node_modules/.bin/wrangler ] && WRANGLER="node_modules/.bin/wrangler"

say "MeTiger · включение связки $BIND"
say "  проект:      $PROJECT"
say "  неймспейс:   $NS_TITLE"
say "  прод:        $PROD"
[ "$APPLY" = 1 ] || say "  режим:       план (ничего не меняю; запуск с --apply)"
[ -f "$DEVVARS" ] && say "  страховка:   секреты возьму из .dev.vars ($(grep -cE '^[A-Z]' "$DEVVARS") строк)" \
                  || say "  ВНИМАНИЕ: .dev.vars нет — перезалить секреты при расхождении будет нечем"

# ── 1. право ────────────────────────────────────────────────────────────────────
say "── право на KV"
LIST=$(api GET "/accounts/$ACCT/storage/kv/namespaces")
NS_ID=$(printf '%s' "$LIST" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if not d.get('success'):
    e=(d.get('errors') or [{}])[0]
    print(''.join(['ERR ', str(e.get('code')), ' ', e.get('message','')])); raise SystemExit(0)
for r in (d.get('result') or []):
    if r.get('title') == '$NS_TITLE': print(r.get('id')); break
else: print('NONE')
")
case "$NS_ID" in
  ERR\ 10000*|*Authentication*)
    say "  токену не хватает права. Нужно: Account · Workers KV Storage · Edit"
    say "  (My Profile → API Tokens → этот токен → Edit... → Add more → Workers KV Storage → Edit)"
    say "  и, для привязки (PATCH конфигурации): Account · Cloudflare Pages · Edit"
    exit 1 ;;
  ERR*) say "  API ответило отказом: $NS_ID"; exit 1 ;;
  NONE) say "  право есть, неймспейса «$NS_TITLE» нет — создам" ;;
  *)    say "  неймспейс уже есть: ${NS_ID:0:10}… — создавать не буду" ;;
esac

# ── 2. неймспейс ────────────────────────────────────────────────────────────────
if [ "$NS_ID" = "NONE" ]; then
  CREATED=$(run api POST "/accounts/$ACCT/storage/kv/namespaces" "{\"title\":\"$NS_TITLE\"}")
  if [ "$APPLY" = 1 ]; then
    NS_ID=$(printf '%s' "$CREATED" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print((d.get('result') or {}).get('id','') if d.get('success') else 'ERR '+str((d.get('errors') or [{}])[0].get('message')))
")
    case "$NS_ID" in ERR*|'') say "  создать не вышло: $NS_ID"; exit 1 ;; esac
    say "  создано: ${NS_ID:0:10}…"
  fi
fi
[ "$ONLY_CREATE" = 1 ] && { say "готово: только неймспейс (${NS_ID:-—}). Дальше --apply без --create-only."; exit 0; }

# ── 3. снимок конфигурации проекта ───────────────────────────────────────────────
PROJ=$(api GET "/accounts/$ACCT/pages/projects/$PROJECT")
if ! printf '%s' "$PROJ" | python3 -c "import json,sys; sys.exit(0 if json.load(sys.stdin).get('success') else 1)"; then
  say "  проект $PROJECT не читается этим токеном — дальше не иду"; exit 1
fi
BACKUP=$REPO/../.kv-onboard-backup-$(date +%Y%m%d-%H%M%S).json
printf '%s' "$PROJ" > "$BACKUP"; chmod 600 "$BACKUP"
KEYS_BEFORE=$(printf '%s' "$PROJ" | python3 -c "
import json,sys
d=(json.load(sys.stdin).get('result') or {})
for env in ('production','preview'):
    ev=(((d.get('deployment_configs') or {}).get(env) or {}).get('env_vars') or {})
    print(env + '=' + ','.join(sorted(ev)))
")
say "── конфигурация проекта"
say "  снимок: $BACKUP (файл вне git, 600)"
printf '%s\n' "$KEYS_BEFORE" | sed 's/^/  /'

# ── 4. привязка ─────────────────────────────────────────────────────────────────
say "── привязка $BIND → ${NS_ID:0:10}…"
if [ "$DO_BIND" = 0 ]; then
  say "  пропускаю привязку (--no-bind)"
elif [ "$APPLY" = 1 ]; then
  BODY=$(NS_ID="$NS_ID" BIND_NAME="$BIND" python3 -c "
import json, os
ns, name = os.environ['NS_ID'], os.environ['BIND_NAME']
one = {'kv_namespace_bindings': {name: ns}}
print(json.dumps({'deployment_configs': {'production': one, 'preview': one}}))
")
  RES=$(api PATCH "/accounts/$ACCT/pages/projects/$PROJECT" "$BODY")
  printf '%s' "$RES" | python3 -c "
import json, sys
d = json.load(sys.stdin)
print('  ' + ('patch принят' if d.get('success') else 'отказ: ' + str((d.get('errors') or [{}])[0])))
raise SystemExit(0 if d.get('success') else 1)
" || { say "  PATCH не принят — подробнее в $BACKUP рядом со снимком"; exit 1; }

  # Pages умеет молча проигнорировать незнакомое поле, поэтому проверяем чтением
  BIND_OK=$(api GET "/accounts/$ACCT/pages/projects/$PROJECT" | NS_ID="$NS_ID" BIND_NAME="$BIND" python3 -c "
import json, os, sys
ns, name = os.environ['NS_ID'], os.environ['BIND_NAME']
cfgs = ((json.load(sys.stdin).get('result') or {}).get('deployment_configs') or {})
got = {e: (((cfgs.get(e) or {}).get('kv_namespace_bindings') or {}).get(name) == ns) for e in ('production','preview')}
print('yes' if got['production'] else 'no', 'preview=' + ('yes' if got['preview'] else 'no'))
")
  case "$BIND_OK" in
    yes*) say "  байндинг $BIND виден в конфигурации проекта (${BIND_OK})" ;;
    *)
      say "  ⚠ API принял PATCH, но $BIND в конфигурации не появился ($BIND_OK)."
      say "  Значит Pages изменил форму поля — не угадываем: Pages → $PROJECT → Settings →"
      say "  Functions → KV namespace bindings → $BIND → $NS_TITLE. Остальное (деплой, проверка)"
      say "  доделает этот же скрипт без --apply-привязки: bash scripts/kv-onboard.sh --apply --no-bind"
      exit 1 ;;
  esac
else
  say "  [dry] PATCH /accounts/<acct>/pages/projects/$PROJECT · $BIND → <id неймспейса> (production + preview)"
fi

# ── 5. сверка, что ключи провайдеров на месте ──────────────────────────────────
AFTER=$(api GET "/accounts/$ACCT/pages/projects/$PROJECT")
KEYS_AFTER=$(printf '%s' "$AFTER" | python3 -c "
import json,sys
d=(json.load(sys.stdin).get('result') or {})
for env in ('production','preview'):
    ev=(((d.get('deployment_configs') or {}).get(env) or {}).get('env_vars') or {})
    print(env + '=' + ','.join(sorted(ev)))
")
if [ "$KEYS_BEFORE" != "$KEYS_AFTER" ]; then
  say "  ⚠ список env_vars изменился — на этом стоп, дальше не иду"
  say "    было:  $KEYS_BEFORE"
  say "    стало: $KEYS_AFTER"
  say "    снимок до: $BACKUP"
  exit 1
else
  say "  env_vars не тронуты ($(printf '%s\n' "$KEYS_BEFORE" | head -1 | cut -d= -f2 | tr ',' '\n' | grep -c .) ключей)"
fi

# ── 6. выжимки памяти (по выбору владельца) ─────────────────────────────────────
if [ "$APPLY" = 1 ]; then
  say "── MEMORY_SUMMARIZE=1 (свёртка старого хвоста в выжимку)"
  printf '1' | $WRANGLER pages secret put MEMORY_SUMMARIZE --project-name "$PROJECT" >/dev/null \
    && say "  лежит" || say "  не легло — положи сам: wrangler pages secret put MEMORY_SUMMARIZE"
fi

# ── 7. деплой и проверка ────────────────────────────────────────────────────────
if [ "$DO_DEPLOY" = 1 ]; then
  say "── деплой"
  run bash scripts/publish.sh --fast
  if [ "$APPLY" = 1 ]; then
    say "── проверка прода"
    sleep 6
    curl -s "$PROD/api/chat" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  limits:', json.dumps(d.get('limits'),ensure_ascii=False))
"
    curl -s "$PROD/telegram/webhook" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  memory:', d.get('memory'))
print('  limits:', d.get('limits'))
"
    printf '{"text":"запомни: число 4242","chatId":"onboard-check"}' > /tmp/kv1.json
    printf '{"text":"какое число я просил запомнить?","chatId":"onboard-check"}' > /tmp/kv2.json
    curl -s -X POST "$PROD/api/chat" -H 'content-type: application/json' --data @/tmp/kv1.json >/dev/null
    curl -s -X POST "$PROD/api/chat" -H 'content-type: application/json' --data @/tmp/kv2.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  ответ:', (d.get('reply') or d.get('error') or '')[:120])
print('  память:', json.dumps(d.get('memory'),ensure_ascii=False)[:160])
"
    rm -f /tmp/kv1.json /tmp/kv2.json
    printf '{"forget":true,"text":"/forget","chatId":"onboard-check"}' > /tmp/kv3.json
    curl -s -X POST "$PROD/api/chat" -H 'content-type: application/json' --data @/tmp/kv3.json | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('  /forget:', d.get('forgotten'), '| память после:', json.dumps(d.get('memory'),ensure_ascii=False)[:120])
"; rm -f /tmp/kv3.json
  fi
fi
say "готово"
