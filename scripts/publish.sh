#!/usr/bin/env bash
# Публикация MeTiger Ai одной командой.
#
#   npm run publish                 тесты → сборка → прод → проверка прода
#   npm run publish -- --bump       то же + поднять APP_VERSION на 0.001
#   npm run publish -- --fast       пропустить тесты (только когда они только что шли)
#   npm run publish -- --preview    залить не в прод, а на preview-адрес
#   npm run publish -- --commit "текст"   сначала закоммитить всё и запушить в main
#   npm run publish -- --dry        показать, что будет сделано, ничего не трогать
#   npm run publish -- --git-only     только коммит и пуш (правишь документы — прод не трогаем)
#
# Доступы берутся из окружения, а если их нет — из файла ../.secrets.env (он вне
# репозитория и в git не попадает). Значения наружу не печатаются никогда: ни в
# успехе, ни в ошибке.
#
# Почему скрипт, а не «просто wrangler»:
#   1. деплой без --branch main уходит в preview, и прод остаётся на старом билде
#      — по git push ничего не обновляется, потому что git-интеграции у проекта нет;
#   2. wrangler@latest требует Node >= 22, а в песочнице и у половины CI Node 20 —
#      рабочая ветка 3, она подхвачена отсюда локально или через npx;
#   3. секреты Pages нельзя записать прямым запросом к API (405), только wranglerом.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO=$PWD
# Ключи — в папке keys/ внутри репозитория, но в git они не живут (.gitignore).
# Переопределение адреса: METIGER_SECRETS=/путь/.secrets.env.
SECRETS=${METIGER_SECRETS:-$REPO/keys/.secrets.env}
# Старый адрес рядом с репозиторием остаётся запасным: пусть работают те,
# кто ещё не знает о переезде.
[ -f "$SECRETS" ] || SECRETS="$REPO/../.secrets.env"
PROJECT=${PAGES_PROJECT:-metiger-ai}
PROD=https://metiger-ai.pages.dev
MODE=production
GIT_ONLY=0
BUMP=0; TESTS=1; DRY=0; COMMIT_MSG=""

while [ $# -gt 0 ]; do
  case "$1" in
    --bump)    BUMP=1 ;;
    --fast)    TESTS=0 ;;
    --preview) MODE=preview ;;
    --dry)      DRY=1 ;;
    --git-only) GIT_ONLY=1 ;;
    --commit)  shift; COMMIT_MSG=${1:-} ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "неизвестный флаг: $1 (справка: --help)" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "  [dry] $*"; else "$@"; fi; }

# ── доступы: из окружения или из файла, без вывода значений ───────────────────
pull() { [ -n "${!1:-}" ] || [ ! -f "$SECRETS" ] || export "$1=$(grep -oP "^$1=\K.*" "$SECRETS" | head -1)"; }
pull CLOUDFLARE_API_TOKEN || true
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -f "$SECRETS" ]; then
  export CLOUDFLARE_API_TOKEN=$(grep -oP '^CF_TOKEN=\K.*' "$SECRETS" | head -1)
fi
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ] && [ -f "$SECRETS" ]; then
  export CLOUDFLARE_ACCOUNT_ID=$(grep -oP '^CF_ACCOUNT=\K.*' "$SECRETS" | head -1)
fi
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  say "нет CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID (ни в окружении, ни в $SECRETS)" >&2
  exit 1
fi

WRANGLER="npx --yes wrangler@3"
[ -x node_modules/.bin/wrangler ] && WRANGLER="node_modules/.bin/wrangler"

say "MeTiger Ai · $PROJECT · режим $MODE"
say "  репозиторий: $REPO"
say "  HEAD:        $(git rev-parse --short HEAD 2>/dev/null || echo '—') · грязных файлов $(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
say "  wrangler:    $WRANGLER"

# ── версия ───────────────────────────────────────────────────────────────────
if [ "$BUMP" = 1 ]; then
  VER=$(node -e '
    const fs=require("fs"), p="src/lib/version.ts";
    const s=fs.readFileSync(p,"utf8");
    const m=s.match(/APP_VERSION = .(\d+)\.(\d{1,4})./);
    if(!m){console.error("не понял формат APP_VERSION в "+p);process.exit(1)}
    const pad=Math.max(3,m[2].length);
    const txt=m[1]+"."+String(+m[2]+1).padStart(pad,"0");
    fs.writeFileSync(p, s.replace(m[0], "APP_VERSION = \x27"+txt+"\x27"));
    console.log(txt);')
say "  версия:      поднята до $VER"
  node -e 'const fs=require("fs");const p="package.json";const d=JSON.parse(fs.readFileSync(p,"utf8"));d.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n")' "$VER"
  say "  package.json:  version = $VER"
fi

# ── тесты и сборка ────────────────────────────────────────────────────────────
if [ "$TESTS" = 1 ]; then
  say "── тесты"
  run npm test --silent
fi
if [ "$GIT_ONLY" = 1 ]; then
  say "── только git: без сборки и деплоя (правка документов)
"; else
  say "── сборка"
  run npm run build --silent
fi

# ── коммит и пуш (по флагу) ───────────────────────────────────────────────────
if [ -n "$COMMIT_MSG" ]; then
  say "── коммит и пуш в main"
  run git add -A
  run git commit -q -m "$COMMIT_MSG"
  if [ "$DRY" = 0 ]; then
    PAT=${GITHUB_PAT:-}
    [ -z "$PAT" ] && [ -f "$SECRETS" ] && PAT=$(grep -oP '^GITHUB_PAT=\K.*' "$SECRETS" | head -1)
    if [ -z "$PAT" ]; then
      say "нет GITHUB_PAT: коммит готов локально, пуша не делаю — пуши сам или положи пат в $SECRETS" >&2
      exit 1
    fi
    GIT_USER=${GITHUB_USER:-yamatayga-lgbt}
    ASK=$(mktemp); chmod 700 "$ASK"
    # Важно: генерировать heredoc'ом, а не printf. Наружный printf съедает %s
    # внутри собственного текста — askpass возвращал пустые строки, и пуш уходил
    # анонимным («No anonymous write access»).
    cat > "$ASK" <<'EOS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s' "$GIT_USER" ;;
  *) printf '%s' "$GITHUB_PAT" ;;
esac
EOS
    trap 'rm -f "$ASK"' EXIT
    # ASK читает $GITHUB_PAT и $GIT_USER в момент вызова — значит обе переменные
    # надо передать в окружение git, иначе askpass вернёт пустую строку и GitHub
    # ответит «No anonymous write access».
    # credential.helper=store мешает: он отрабатывает раньше, чем git успевает
    # спросить GIT_ASKPASS, и пуш уходит анонимным («No anonymous write access»).
    # Отключаем хелперы именно на эту команду — авторизация идёт через askpass.
    GITHUB_PAT="$PAT" GIT_USER="$GIT_USER" GIT_ASKPASS="$ASK" run git -c credential.helper= push origin HEAD:main
    rm -f "$ASK"; trap - EXIT
  fi
fi

# ── деплой ─────────────────────────────────────────────────────────────────────
if [ "$GIT_ONLY" = 1 ]; then
  say "готово: закоммичено и запушено, прод не трогали"
  exit 0
fi
say "── деплой на Pages"
if [ "$DRY" = 1 ]; then
  say "  [dry] $WRANGLER pages deploy dist --project-name $PROJECT $( [ "$MODE" = preview ] && echo '--branch preview' || echo '--branch main' )"
else
  if ! OUT=$($WRANGLER pages deploy dist --commit-dirty=true --project-name "$PROJECT" $( [ "$MODE" = preview ] && echo '--branch preview' || echo '--branch main' ) 2>&1); then
    # Раньше провал молча съедался: set -e выходил без объяснений, а следом
    # печаталось «выложено». Теперь — причина и честный выход.
    printf '%s\n' "$OUT" | tail -20 | sed 's/^/    /' >&2
    say "  ✗ деплой не состоялся — прод остался на прошлой сборке" >&2
    exit 1
  fi
  printf '%s\n' "$OUT" | tail -4
  URL=$(printf '%s\n' "$OUT" | grep -oE 'https://[a-z0-9-]+\.metiger-ai\.pages\.dev' | tail -1)
  say "  выложено: прод = $PROD (адрес сборки ${URL:-?} мог ещё не прогреться — судить по проду)"
fi

# ── проверка прода ────────────────────────────────────────────────────────────
if [ "$MODE" = production ] && [ "$DRY" = 0 ]; then
  say "── проверка прода"
  # Дверь бота обязана быть закрыта: с 0.036 бота нет. Мерить надо POST-ом и типом
  # ответа: GET на несуществующий путь Pages отдаёт index.html с кодом 200 (заглушка
  # приложения), и по одному коду «маршрут жив» не отличить от «маршрута нет».
  W=$(curl -s -o /dev/null -w '%{http_code}' --max-time 40 -X POST -H 'content-type: application/json' \
        -d '{"ok":"проверка"}' "$PROD/telegram/webhook")
  J=$(curl -s --max-time 40 "$PROD/telegram/webhook" | head -c 400)
  if [ "$W" = 405 ] || [ "$W" = 404 ]; then
    printf '  /telegram/webhook: %s — приёма апдейтов нет (так и задумано)\n' "$W"
  else
    say "  /telegram/webhook: $W — ДВЕРЬ БОТА ОТКРЫТА, хотя кода приёмника нет"; exit 1
  fi
  case "$J" in *'"route"'*) say "  вебхук отдаёт статус — старый_functions ещё жив"; exit 1;; esac
  C=$(curl -s --max-time 90 -X POST "$PROD/api/chat" -H 'content-type: application/json' \
        -d '{"text":"2+2","chatId":"publish_smoke","history":[]}')
  printf '  ответ:   %s\n' "$(printf '%s' "$C" | head -c 220)"
  # Смотрим ровно в поле reply и на любую отдельно стоящую четвёрку. Прежняя проверка искала
  # `"4"` во всём JSON и падала, когда модель отвечала «2 + 2 = 4» или ставила неразрывный пробел:
  # дымовой тест спорил с форматированием ответа, а не со сломанным счётом.
  R=$(printf '%s' "$C" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let r="";try{r=(JSON.parse(s).reply||"")}catch(e){}console.log(r.replace(/[\s\u00a0\u202f]+/g," "))})' 2>/dev/null)
  printf '  реплика:  %s\n' "$(printf '%s' "$R" | head -c 120)"
  printf '%s' "$R" | grep -qE '(^|[^0-9.,])4([^0-9]|$)' && say "  дымовой тест: ок" || say "  дымовой тест: в ответе нет четвёрки — смотри выше"
fi
say "готово"
