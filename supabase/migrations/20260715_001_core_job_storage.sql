-- Ozon ERP durable storage baseline.
-- The application stores business payloads in JSONB so the migration is additive
-- and can coexist with the local JSON fallback during a staged rollout.
-- Apply with the Supabase CLI or the platform migration runner; do not paste
-- service-role credentials into this file.
-- ozon-erp-migration: 20260715_001_core_job_storage schema=1

create table if not exists public.auto_listing_jobs (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  migrated_at timestamptz
);

create table if not exists public.stock_queue_jobs (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  migrated_at timestamptz
);

create table if not exists public.pipeline_runs (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  migrated_at timestamptz
);

create index if not exists auto_listing_jobs_updated_at_idx
  on public.auto_listing_jobs (updated_at desc);
create index if not exists stock_queue_jobs_updated_at_idx
  on public.stock_queue_jobs (updated_at desc);
create index if not exists pipeline_runs_updated_at_idx
  on public.pipeline_runs (updated_at desc);

alter table public.auto_listing_jobs enable row level security;
alter table public.stock_queue_jobs enable row level security;
alter table public.pipeline_runs enable row level security;

comment on table public.auto_listing_jobs is 'Ozon ERP auto-listing durable payloads; service role only.';
comment on table public.stock_queue_jobs is 'Ozon ERP stock queue durable payloads; service role only.';
comment on table public.pipeline_runs is 'Ozon ERP workflow pipeline durable payloads; service role only.';
