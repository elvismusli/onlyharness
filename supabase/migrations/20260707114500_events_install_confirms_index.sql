create index if not exists events_install_confirms_idx
  on public.events (owner, repo, client, subject)
  where kind = 'install';
