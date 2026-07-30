#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "Installing dependencies…"
npm install

echo ""
echo "Starting API (http://localhost:4000) and web app (http://localhost:5173)…"
echo "On first run, open the web app and paste your eToro + Supabase keys."
echo ""
npm start
