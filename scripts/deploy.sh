#!/usr/bin/env bash
# MeTiger Ai — сборка и деплой на Cloudflare Pages
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && export $(grep -v '^#' .env | xargs)
npm run build
npx -y wrangler@3 pages deploy dist --project-name metiger-ai --branch main --commit-dirty=true
