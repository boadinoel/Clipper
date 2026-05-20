-- Cost rails: per-day per-service spend ledger.
-- Worker reads/writes via service role; no RLS.

create table if not exists public.service_spend (
  id bigserial primary key,
  date date not null,
  service text not null,
  cents_used integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (date, service)
);

create index if not exists service_spend_date_idx on public.service_spend (date desc);

alter table public.service_spend enable row level security;
-- No policies = service role only.

-- Atomic reserve: insert-or-add, return the new running total.
create or replace function public.cost_rails_reserve(
  p_date date,
  p_service text,
  p_cents integer
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  new_total integer;
begin
  insert into public.service_spend (date, service, cents_used, updated_at)
  values (p_date, p_service, greatest(0, p_cents), now())
  on conflict (date, service) do update
    set cents_used = public.service_spend.cents_used + greatest(0, p_cents),
        updated_at = now()
  returning cents_used into new_total;
  return new_total;
end;
$$;

-- Adjust by delta (can be negative).
create or replace function public.cost_rails_adjust(
  p_date date,
  p_service text,
  p_delta integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.service_spend (date, service, cents_used, updated_at)
  values (p_date, p_service, greatest(0, p_delta), now())
  on conflict (date, service) do update
    set cents_used = greatest(0, public.service_spend.cents_used + p_delta),
        updated_at = now();
end;
$$;

revoke all on function public.cost_rails_reserve(date, text, integer) from public;
revoke all on function public.cost_rails_adjust(date, text, integer) from public;
grant execute on function public.cost_rails_reserve(date, text, integer) to service_role;
grant execute on function public.cost_rails_adjust(date, text, integer) to service_role;
