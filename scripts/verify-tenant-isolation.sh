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

# Attempt an INSERT as the authenticated role; report allowed/denied based on
# whether RLS permits it. Always rolled back, so nothing persists.
write_probe() { # $1 = jwt claims json, $2 = client_id
  if psql "$DATABASE_URL" -qtA -v ON_ERROR_STOP=1 >/dev/null 2>&1 <<SQL
begin;
set local request.jwt.claims = '$1';
set local role authenticated;
insert into public.decisions (client_id, title) values ('$2', 'synthetic write probe');
rollback;
SQL
  then echo "allowed"; else echo "denied"; fi
}

DIRECTOR_AAL2='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal2"}'
DIRECTOR_AAL1='{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","aal":"aal1"}'

# Read isolation: positive assertions prove RLS grants; negatives prove isolation.
check "tenant A sees its own decisions"          2 "$(probe "$USER_A" "count(*) from public.decisions")"
check "tenant A blocked from other tenant"       0 "$(probe "$USER_A" "count(*) from public.decisions where client_id='other-tenant'")"
check "tenant A sees only its own client"        1 "$(probe "$USER_A" "count(*) from public.clients")"
check "tenant B sees its own decisions"          1 "$(probe "$USER_B" "count(*) from public.decisions")"
check "tenant B blocked from other tenant"       0 "$(probe "$USER_B" "count(*) from public.decisions where client_id='hacker-dojo'")"
check "anonymous sees nothing"                   0 "$(probe '{}' "count(*) from public.decisions")"

# Write isolation + privilege/MFA gate.
check "director (aal2) writes its own tenant"    allowed "$(write_probe "$DIRECTOR_AAL2" 'hacker-dojo')"
check "director (aal2) blocked cross-tenant"     denied  "$(write_probe "$DIRECTOR_AAL2" 'other-tenant')"
check "director without aal2 cannot write (MFA)" denied  "$(write_probe "$DIRECTOR_AAL1" 'hacker-dojo')"
check "board_viewer cannot write"                denied  "$(write_probe "$USER_A" 'hacker-dojo')"

if [[ "$fail" -ne 0 ]]; then
  echo "TENANT ISOLATION FAILED"
  exit 1
fi
echo "TENANT ISOLATION VERIFIED"
