#!/usr/bin/env bash
#
# One command to ship: sync public/ into site/, then deploy to Vercel.
#
# The trap this avoids: `vercel --prod` deploys whatever is already in site/, and site/ is
# a copy of public/, not the live tree. Deploying without running prepare.sh first ships
# the last synced version and silently drops every edit made since. So the two always run
# together, in this order, and a failed prepare stops the deploy.
#
# Usage:
#   bash site/deploy.sh              # production deploy (vercel --prod)
#   bash site/deploy.sh --preview    # preview deploy (a throwaway URL, prod untouched)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# --preview builds a throwaway URL instead of promoting to production.
TARGET="--prod"
if [ "${1:-}" = "--preview" ]; then
  TARGET=""
  echo "==> preview deploy (production stays on its current version)"
fi

echo "==> syncing public/ into site/"
bash "$HERE/prepare.sh"

echo
echo "==> deploying to Vercel"
cd "$HERE"
# shellcheck disable=SC2086
vercel $TARGET

echo
echo "done. hard-reload the console (Ctrl+Shift+R) and re-add the OBS Browser Source."
