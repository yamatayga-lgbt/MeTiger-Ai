#!/usr/bin/env bash
# Временная ссылка на MeTiger без слова pages.dev: `https://<случайно>.trycloudflare.com`.
#
# Зачем: *.pages.dev вырезан реестром целиком (с 09.05.2024 в РФ, Беларусь повторяет),
# поэтому боевой адрес у части людей обрывается прямо на рукопожатии TLS. Quick Tunnel —
# единственный способ дать живую ссылку за минуту и без покупки домена: облачного аккаунта
# он не требует, имя не содержит pages.dev.
#
# Чем этот адрес НЕ является: это не прод. Живёт, пока работает процесс; адрес при каждом
# запуске новый; двигает он локальную сборку этого репозитория (её ключи и лимиты), а не
# выложенный проект. Для постоянного адреса нужен домен, приклеенный к Pages-проекту.
#
#   bash scripts/tunnel.sh            # соберёт, поднимет движок и превью, выдаст ссылку
#   bash scripts/tunnel.sh --keep     # то же, но не гасить серверы при Ctrl-C
set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO=$PWD
KEEP=${1:-}
API_PORT=${API_PORT:-8788}
VIEW_PORT=${VIEW_PORT:-4173}
BIN=$REPO/bin
CF=$BIN/cloudflared

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

[ -d node_modules ] || die "нет node_modules — сначала npm install"

# cloudflared берём в bin/ репозитория (в git его нет): права на установку в /usr/local
# в песочнице нет, а бинарник весит 39 МБ и нужен только для этой ссылки.
if [ ! -x "$CF" ]; then
  say "скачиваю cloudflared в bin/ (однократно)"
  mkdir -p "$BIN"
  curl -fsSL --max-time 300 -o "$CF" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    || die "cloudflared не скачался — проверьте доступ к github.com"
  chmod +x "$CF"
fi

# dist не считаем устаревшим молча: без него превью отдаст пустоту, а вина будет на туннеле.
[ -f dist/index.html ] || { say "собираю (npm run build)"; npm run build >/dev/null || die "сборка упала"; }

api_pid=""; view_pid=""
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:$API_PORT/api/skills)" = "200" ]; then
  say "движок на :$API_PORT уже работает — не дублирую"
else
  say "поднимаю движок (:$API_PORT)"
  (npm run api > /tmp/mt-tunnel-api.log 2>&1 &) ; api_pid=$!
fi
if [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:$VIEW_PORT/)" = "200" ]; then
  say "превью на :$VIEW_PORT уже работает — не дублирую"
else
  say "поднимаю собранный сайт (:$VIEW_PORT)"
  (npx --yes vite preview --port "$VIEW_PORT" > /tmp/mt-tunnel-view.log 2>&1 &) ; view_pid=$!
fi
pids=(${api_pid:+"$api_pid"} ${view_pid:+"$view_pid"})

# Порт ещё может греться, а без ответа движка ссылка будет выглядеть битой: ждём оба.
for i in $(seq 1 30); do
  a=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$API_PORT/api/skills" || true)
  v=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:$VIEW_PORT/" || true)
  [ "$a" = "200" ] && [ "$v" = "200" ] && break
  sleep 2
done
[ "${a:-0}" = "200" ] || { tail -5 /tmp/mt-tunnel-api.log; die "движок не ответил на /api/skills"; }
[ "${v:-0}" = "200" ] || { tail -5 /tmp/mt-tunnel-view.log; die "превью не отдаёт главную"; }

"$CF" tunnel --url "http://127.0.0.1:$VIEW_PORT" --no-autoupdate > /tmp/mt-tunnel-cf.log 2>&1 &
cf_pid=$!
pids+=("$cf_pid")

url=""
for i in $(seq 1 30); do
  url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' /tmp/mt-tunnel-cf.log | head -1)
  [ -n "$url" ] && break
  kill -0 "$cf_pid" 2>/dev/null || { tail -8 /tmp/mt-tunnel-cf.log; die "cloudflared умер при старте"; }
  sleep 2
done
[ -n "$url" ] || die "имя туннеля не появилось за 60 с — смотрите /tmp/mt-tunnel-cf.log"

# Ссылка годна ровно тогда, когда за ней стоит живой ответ: проверяем до того, как показать.
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 40 "$url/")
[ "$code" = "200" ] || die "туннель отвечает $code — ссылку не даю, смотрите /tmp/mt-tunnel-cf.log"

say ""
say "ссылка: $url"
say "живёт, пока запущен этот процесс (Ctrl-C — и она гаснется, если не --keep)"
say "логи: /tmp/mt-tunnel-{api,view,cf}.log"

if [ "$KEEP" = "--keep" ]; then
  say "процессы оставлены живыми: ${pids[*]}"
  exit 0
fi

trap 'kill "${pids[@]}" 2>/dev/null; exit 0' INT TERM
wait "$cf_pid"
