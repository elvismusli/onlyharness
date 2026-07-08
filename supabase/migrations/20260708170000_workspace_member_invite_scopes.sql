alter table public.workspace_tokens drop constraint if exists workspace_tokens_scopes_check;
alter table public.workspace_tokens
  add constraint workspace_tokens_scopes_check check (scopes <@ array[
    'workspace:*',
    'workspace:admin',
    'workspace:read',
    'workspace:setup',
    'resource:read',
    'resource:publish',
    'resource:archive',
    'collection:write',
    'member:write',
    'invite:write',
    'audit:read',
    'read',
    'setup',
    'publish',
    'entitlements:read'
  ]::text[]);
