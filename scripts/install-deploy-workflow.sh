#!/usr/bin/env bash
# Включение автодеплоя на Cloudflare Pages через GitHub Actions — одной командой.
#
#   bash scripts/install-deploy-workflow.sh            положить воркфлоу и запушить
#   bash scripts/install-deploy-workflow.sh --dry      показать, что будет сделано
#
# Зачем отдельный скрипт: файл `.github/workflows/*` GitHub принимает только от
# токена с правом **Workflows: Write**. У App-токена песочницы Arena этого права
# нет (пуш отбивается словами «refusing to allow a GitHub App to create or update
# workflow … without `workflows` permission»), а у fine-grained PAT — только если
# в настройках самого PAT отмечено «Workflows: Read and write». Поэтому исходник
# воркфлоу лежит в обычном каталоге (scripts/deploy/github-actions.yml), а этот
# скрипт кладёт его на место и пушит — из той сессии, где токен полноценный.
#
# Секреты Cloudflare кладёт он же, если у токена есть право **Secrets** и в
# окружении (или в keys/.secrets.env) лежат CF_TOKEN / CF_ACCOUNT. Без права —
# скажет, что осталось сделать руками: Settings → Secrets and variables → Actions.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
REPO=$PWD
SRC=scripts/deploy/github-actions.yml
DST=.github/workflows/deploy.yml
DRY=0
[ "${1:-}" = "--dry" ] && DRY=1

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "  [dry] $*"; else "$@"; fi; }

[ -f "$SRC" ] || { say "нет $SRC — нечего ставить" >&2; exit 1; }

SECRETS=${METIGER_SECRETS:-$REPO/keys/.secrets.env}
[ -f "$SECRETS" ] || SECRETS="$REPO/../.secrets.env"

say "MeTiger Ai · установка воркфлоу выкладки"
say "  откуда: $SRC"
say "  куда:   $DST"

mkdir -p .github/workflows
run cp "$SRC" "$DST"
run git add "$DST" scripts/install-deploy-workflow.sh scripts/deploy/github-actions.yml
if [ "$DRY" = 0 ] && git diff --cached --quiet; then
  say "  файлы уже в индексе — коммит не нужен"
else
  run git commit -q -m "деплой: автовыкладка на Cloudflare Pages через GitHub Actions (0.121)"
fi
run git push origin HEAD

# ── секреты (если токен умеет) ────────────────────────────────────────────────
CF_TOKEN=${CF_TOKEN:-}
CF_ACCOUNT=${CF_ACCOUNT:-}
[ -z "$CF_TOKEN" ] && [ -f "$SECRETS" ] && CF_TOKEN=$(grep -oP '^CF_TOKEN=\K.*' "$SECRETS" | head -1 || true)
[ -z "$CF_ACCOUNT" ] && [ -f "$SECRETS" ] && CF_ACCOUNT=$(grep -oP '^CF_ACCOUNT=\K.*' "$SECRETS" | head -1 || true)

if [ -n "$CF_TOKEN" ] && [ -n "$CF_ACCOUNT" ]; then
  if [ "$DRY" = 1 ]; then
    say "  [dry] gh secret set CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID"
  elif gh secret set CLOUDFLARE_API_TOKEN --repo "$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#')" --body "$CF_TOKEN" >/dev/null 2>&1 \
    && gh secret set CLOUDFLARE_ACCOUNT_ID --repo "$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+/[^/.]+).*#\1#')" --body "$CF_ACCOUNT" >/dev/null 2>&1; then
    say "  секреты CF положены в репозиторий — выкладка заработает с ближайшего пуша"
  else
    say "  секреты положить не вышло (у токена нет права Secrets) — сделай руками:"
    say "    Settings → Secrets and variables → Actions → New repository secret"
    say "    CLOUDFLARE_API_TOKEN = <CF_TOKEN из keys/.secrets.env>"
    say "    CLOUDFLARE_ACCOUNT_ID = <CF_ACCOUNT из keys/.secrets.env>"
    say "  после этого перезапусти любой прогон Deploy (Re-run) — прод обновится"
  fi
else
  say "  CF_TOKEN/CF_ACCOUNT не найдены — секреты положи руками (Settings → Secrets → Actions)"
fi

say "готово"
