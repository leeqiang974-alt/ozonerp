create table if not exists auto_listing_jobs (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  migrated_at timestamptz
);

create table if not exists pipeline_runs (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  migrated_at timestamptz
);

create table if not exists stock_queue_jobs (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  migrated_at timestamptz
);

