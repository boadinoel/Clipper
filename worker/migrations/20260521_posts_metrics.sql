-- Posts metrics ingestion: 24h + 7d snapshots, learning-loop percentile.

alter table public.posts
  add column if not exists last_metrics_check_at timestamptz,
  add column if not exists metrics_at_24h jsonb,
  add column if not exists metrics_at_7d jsonb,
  add column if not exists performance_percentile numeric;

create index if not exists posts_metrics_check_idx
  on public.posts (status, posted_at, last_metrics_check_at)
  where status = 'posted';
