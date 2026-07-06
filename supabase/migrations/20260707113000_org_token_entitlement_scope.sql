alter table public.org_tokens
  drop constraint if exists org_tokens_scopes_check;

alter table public.org_tokens
  add constraint org_tokens_scopes_check
  check (scopes <@ array['read', 'setup', 'publish', 'entitlements:read']::text[]);
