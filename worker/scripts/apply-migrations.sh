#!/usr/bin/env bash
# Apply pending SQL migrations to a Supabase project.
#
# Usage:
#   SUPABASE_DB_URL='postgresql://postgres:<pwd>@<project>.pooler.supabase.com:6543/postgres' \
#     ./scripts/apply-migrations.sh
#
# Get the connection string from Supabase dashboard → Project Settings →
# Database → Connection string → URI (use the "Session pooler" string for
# scripts; the IPv4 direct connection also works).
#
# Migrations are idempotent (CREATE TABLE IF NOT EXISTS, ALTER TABLE ADD
# COLUMN IF NOT EXISTS, CREATE OR REPLACE FUNCTION) so re-running is safe.

set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "error: SUPABASE_DB_URL is not set" >&2
  echo "" >&2
  echo "Get it from: Supabase dashboard → Project Settings → Database →" >&2
  echo "Connection string → URI (use the 'Session pooler' option)." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found. Install with:" >&2
  echo "  macOS:   brew install libpq && brew link --force libpq" >&2
  echo "  Ubuntu:  sudo apt-get install postgresql-client" >&2
  exit 1
fi

here="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mig_dir="${here}/migrations"

if [[ ! -d "${mig_dir}" ]]; then
  echo "error: migrations directory not found at ${mig_dir}" >&2
  exit 1
fi

shopt -s nullglob
files=("${mig_dir}"/*.sql)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  echo "no SQL files in ${mig_dir} — nothing to apply"
  exit 0
fi

# Sort alphabetically — the YYYYMMDD prefix sorts chronologically.
IFS=$'\n' files=($(printf '%s\n' "${files[@]}" | sort))
unset IFS

echo "Applying ${#files[@]} migration(s) to Supabase..."
echo ""
for f in "${files[@]}"; do
  name=$(basename "${f}")
  echo "  → ${name}"
  if ! psql "${SUPABASE_DB_URL}" \
       --set ON_ERROR_STOP=on \
       --quiet \
       --no-psqlrc \
       --file "${f}"; then
    echo "" >&2
    echo "error: migration ${name} failed" >&2
    exit 1
  fi
done

echo ""
echo "All migrations applied successfully."
