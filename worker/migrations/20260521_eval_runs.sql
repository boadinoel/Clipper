-- LLM eval harness: trend log of judge-graded scoring runs.
-- Worker writes via service role; no RLS policies needed.

create table if not exists public.eval_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  git_sha text,
  kind text not null check (kind in ('manual', 'sample')),
  golden_set_version text,
  clip_id uuid,
  user_id uuid,
  scoring_input jsonb,
  variants jsonb,
  median_scores jsonb,
  per_variant_scores jsonb,
  notes text
);

create index if not exists eval_runs_run_at_idx on public.eval_runs (run_at desc);
create index if not exists eval_runs_kind_idx on public.eval_runs (kind, run_at desc);

alter table public.eval_runs enable row level security;
-- No policies = service role only.
