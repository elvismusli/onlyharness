# Resource archive rollout

`npm run inventory:resource-archives` is read-only by default. It hashes and classifies archive files but does not reconcile release rows, activate or fail pending releases, or delete stale archive objects.

Use `npm run inventory:resource-archives -- --reconcile` only in an approved maintenance window. Reconciliation is a mutation: it may activate or fail pending releases, remove stale temp/orphan objects, and refresh the local release projection.

Legacy archive classes:

- `github:*` is an external legacy mirror. It must be backed up, switched to verified open-only catalog behavior, and retired. Never invent a version or `ownerSubject` to insert it into `resource_package_releases`.
- `onlyharness:packages/*` may be migrated only from a reviewed manifest containing the exact immutable version, canonical `user:<64-hex>` owner subject, and archive digest.
- unknown IDs stay quarantined until an operator documents retention or deletion.

Before any production migration, preserve a 0600 logical Supabase schema/data dump and a checksum inventory of both legacy and imported archive roots. Do not delete the legacy root until the new release inventory has zero parity failures and rollback evidence exists outside the server.

Use a private directory and retain both dumps:

```bash
umask 077
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="${HOME}/.local/share/superskill-backups/$stamp"
mkdir -p "$backup_root"
chmod 0700 "$backup_root"
npx supabase db dump --linked --file "$backup_root/schema.sql"
npx supabase db dump --linked --data-only --use-copy --file "$backup_root/data.sql"
shasum -a 256 "$backup_root/schema.sql" "$backup_root/data.sql" > "$backup_root/SHA256SUMS"
chmod 0600 "$backup_root/"*
```

Do not run `supabase db dump --linked --dry-run` in a recorded terminal: the current CLI prints its temporary database credential. The schema dump excludes managed `auth` and `storage` schemas, while the data dump includes their rows. Therefore a restore is not an in-place rollback command: rehearse it against an isolated Supabase project, validate auth/profile/workspace counts and RLS, then cut application credentials only after that rehearsal passes.
