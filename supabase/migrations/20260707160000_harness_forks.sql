create table if not exists public.harness_forks (
  id bigserial primary key,
  user_subject text not null,
  source_owner text not null,
  source_repo text not null,
  source_version text not null,
  fork_owner text not null,
  fork_repo text not null,
  fork_version text,
  created_at timestamptz not null default now(),
  unique (user_subject, source_owner, source_repo, fork_owner, fork_repo)
);

alter table public.harness_forks enable row level security;

create index if not exists harness_forks_source_idx
  on public.harness_forks (source_owner, source_repo, created_at desc);
