#!/usr/bin/env bash
# Публикует короткое имя metiger.pages.dev — редирект на основной проект.
# Зачем отдельный проект: поддомен *.pages.dev у готового проекта не переименовывается
# (известное ограничение Cloudflare), поэтому короткая ссылка делается рядом.
# Ничего общего с ключами, KV и байндингами основного проекта: этот отдаёт три файла.
set -euo pipefail
cd "$(dirname "$0")/.."
KEYS="$(git rev-parse --show-toplevel)/keys/.secrets.env"
[ -f "$KEYS" ] || { echo "нет $KEYS — без токена нечего делать"; exit 1; }
set -a; . "$KEYS"; set +a
export CLOUDFLARE_API_TOKEN="$CF_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT"

NAME="${LINK_PROJECT:-metiger}"
TARGET="https://${NAME}.pages.dev"
# Существование проверяем запросом к API, а не `wrangler pages project list --json`:
# у list нет стабильного JSON-вывода, и ложный «нет такого проекта» заканчивается
# падением на «A project with this name already exists» (проверено на первой публикации).
if ! curl -s --max-time 30 -H "Authorization: Bearer $CF_TOKEN" \
     "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT/pages/projects/$NAME" | grep -q '"success":[[:space:]]*true'; then
  echo "создаю проект $NAME (ветка main, без сборки — только статика)"
  npx --yes wrangler pages project create "$NAME" --production-branch main > /dev/null
fi
# Работаем из каталога двойника: --config для Pages не поддерживается, wrangler сам берёт
# wrangler.toml из текущей папки. Если запускать из корня репозитория, он прочитает корневой
# конфиг и притащит в редирект-проект Functions и байндинги основного сайта (так и вышло
# на первой публикации — двойник начал отвечать /api/skills своим кодом).
(cd tools/link && npx --yes wrangler pages deploy . --project-name "$NAME" \
  --branch main --commit-dirty=true 2>&1 | grep -Ei "complete|uploaded|error|✘" | tail -3)

# Проверка, а не вера: адрес, который есть только у основного проекта, обязан редиректить.
# Если здесь 200 — в двойник снова легли Functions, и это правка, а не «и так сойдёт».
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$TARGET/api/skills")
LOC=$(curl -s -o /dev/null -D - --max-time 30 "$TARGET/api/skills" | grep -i '^location:' | tr -d '\r' | cut -d' ' -f2)
if [ "$CODE" = "302" ] && [ "${LOC#https://metiger-ai.pages.dev/}" = "api/skills" ]; then
  echo "дым: $TARGET/api/skills → 302 $LOC — двойник честный, только редирект"
else
  echo "дым: $TARGET/api/skills → $CODE ${LOC:-без Location} — ДВОЙНИК ОТДАЁТ ЧУЖОЙ КОД, так leaving нельзя" >&2
  exit 1
fi
echo "короткая ссылка: $TARGET → основной адрес"
