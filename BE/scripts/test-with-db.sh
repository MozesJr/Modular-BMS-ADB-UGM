#!/usr/bin/env bash
# Seluruh tes BE termasuk integrasi DB.  Pakai: npm run test:db
exec bash "$(dirname "$0")/with-test-db.sh" npx vitest run "$@"
