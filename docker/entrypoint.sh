#!/bin/sh
set -e

echo "[xterminal] applying database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "[xterminal] starting server..."
exec node apps/api/dist/index.js
