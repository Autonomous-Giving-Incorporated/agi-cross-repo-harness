#!/usr/bin/env bash
# Verify tenant/project isolation against a Postgres that carries a synthetic
# replica of the AGI platform RLS slice (sql/tenant-isolation-slice.sql).
#
# Requires DATABASE_URL pointing at a disposable Postgres (a CI service container
# or a local throwaway db) whose superuser can create roles + SECURITY DEFINER
# functions. Synthetic data only. Fails closed: any cross-tenant read that returns
# data, or a positive read that returns nothing, is a hard failure.
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (postgresql://user:pass@host:port/db)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Applying synthetic tenant-isolation slice..."
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$ROOT/sql/tenant-isolation-slice.sql" >/dev/null

USER_A='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}'
USER_B='{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}'

# Run a SELECT as the authenticated role with a given JWT claim set, returning a
# single scalar. SET commands emit no rows and -q suppresses status tags, so the
# only output is the scalar result.
probe() { # $1 = jwt claims json, $2 = select expression
  psql "$DATABASE_URL" -qtA <<SQL
begin;
set local request.jwt.claims = '$1';
set local role authenticated;
select $2;
rollback;
SQL
}

fail=0
check() { # $1 = label, $2 = expected, $3 = actual
  if [[ "$2" == "$3" ]]; then
    echo "OK    $1 = $3"
  else
    echo "FAIL  $1: expected $2, got $3"
    fail=1
  fi
}

# Positive assertions prove RLS grants correctly; negative assertions prove isolation.
check "tenant A sees its own decisions"        2 "$(probe "$USER_A" "count(*) from public.decisions")"
check "tenant A blocked from other tenant"     0 "$(probe "$USER_A" "count(*) from public.decisions where client_id='other-tenant'")"
check "tenant A sees only its own client"      1 "$(probe "$USER_A" "count(*) from public.clients")"
check "tenant B sees its own decisions"        1 "$(probe "$USER_B" "count(*) from public.decisions")"
check "tenant B blocked from other tenant"     0 "$(probe "$USER_B" "count(*) from public.decisions where client_id='hacker-dojo'")"
check "anonymous sees nothing"                 0 "$(probe '{}' "count(*) from public.decisions")"

if [[ "$fail" -ne 0 ]]; then
  echo "TENANT ISOLATION FAILED"
  exit 1
fi
echo "TENANT ISOLATION VERIFIED"
