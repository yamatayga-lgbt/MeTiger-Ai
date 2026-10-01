#!/usr/bin/env bash
# Точка входа, которая была в проекте до появления publish.sh — оставлена, чтобы
# привычка не подвела. Вся логика теперь там: тесты, сборка, деплой с --branch main
# и проверка прода. Флаги проходят насквозь: ./scripts/deploy.sh --bump
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env ]; then set -a; . ./.env; set +a; fi
exec bash scripts/publish.sh "$@"
