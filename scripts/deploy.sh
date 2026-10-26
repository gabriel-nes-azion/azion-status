#!/bin/sh
# The edge keeps static assets for an hour, so every deploy purges each domain or pages and their scripts drift apart.
set -e

export DOMAINS=""

cd "$(dirname "$0")/.."
azion deploy --local --auto --no-prompt -y
MAP_DOMAIN=$(node -e 'const u=require("./azion/azion.json").workloads?.url; if (u) console.log(new URL(u).host)')
for domain in $DOMAINS $MAP_DOMAIN; do
  azion purge --wildcard "$domain/*"
done
