# SuperSkill production auth and SMTP runbook

Status: **NO-GO until the dashboard and DNS gates below are green**

This runbook configures confirmation-first signup for `superskill.sh`. It does not permit
service-role user creation as production signup evidence and it never records access
tokens, confirmation URLs, SMTP passwords, inbox addresses, or provider payloads.

## Verified current state — 2026-07-13

- OnlyHarness Supabase Auth uses the built-in SMTP service.
- The dashboard email limit is `2 emails/hour`; the built-in service is explicitly not a
  production delivery path.
- Email confirmation is enabled; existing auth smoke proves only that an unconfirmed
  signup receives no immediate session.
- Site URL is `https://onlyharness.com`.
- Redirect allowlist contains `https://www.onlyharness.com`,
  `http://127.0.0.1:5177`, and `http://localhost:5177`; both SuperSkill origins are
  missing.
- `superskill.sh` and `www.superskill.sh` resolve to the production service at
  `37.27.104.125`.
- DNS has an existing root SPF record for registrar forwarding, but no dedicated sending
  subdomain DKIM or DMARC record.
- The Supabase dashboard showed an active provider incident banner and the project
  overview reported `Unhealthy`; rerun all acceptance after the provider incident clears.

Supabase documents that its default SMTP is best-effort/non-production and currently
limited to two messages per hour. Custom SMTP is required for normal production delivery:
<https://supabase.com/docs/guides/auth/auth-smtp>.

## Recommended provider boundary

Use a dedicated Resend sending subdomain:

```text
mail.superskill.sh
sender: SuperSkill <no-reply@mail.superskill.sh>
SMTP host: smtp.resend.com
port: 587
security: STARTTLS
username: resend
password: dedicated Resend API key stored only in Supabase
```

Resend requires a verified domain and SMTP credential, and recommends a subdomain to
isolate sending reputation:
<https://resend.com/docs/send-with-smtp>,
<https://resend.com/docs/dashboard/domains/introduction>.

Do not reuse a broad account API key. Create a dedicated key for Supabase Auth, enter it
directly into Supabase, and never copy it into this repository, terminal output, evidence,
or browser storage controlled by the app.

## Dashboard and DNS procedure

1. In Resend, add `mail.superskill.sh` in the closest appropriate sending region.
2. In Namecheap Advanced DNS, add exactly the SPF/MX return-path and DKIM records shown
   for that Resend domain. Keep the existing root forwarding SPF separate; do not create
   a second SPF TXT record at the same hostname.
3. Add a DMARC TXT record for `_dmarc.mail.superskill.sh`, initially with monitoring
   policy and a controlled aggregate-report destination. Tighten policy only after real
   delivery is stable.
4. Wait until Resend reports the sending domain verified. Record only record host/type,
   provider verification state and timestamp—not key values.
5. In Supabase Authentication → Emails → SMTP Settings, enable custom SMTP with the
   values above and sender name `SuperSkill`.
6. Keep confirmation enabled. Disable provider link tracking because rewritten
   confirmation links can break Supabase auth links.
7. In Supabase Authentication → URL Configuration, add:

   ```text
   https://superskill.sh
   https://www.superskill.sh
   ```

8. Keep `https://onlyharness.com` as the site URL during the dark rollout. The app must
   pass a specific allowlisted SuperSkill confirmation redirect.
9. After custom SMTP is enabled, set a conservative signup/email rate limit suitable for
   the alpha cohort. Supabase starts custom SMTP projects at a low limit; do not raise it
   beyond provider capacity.

## Acceptance run

Use three unique, real inbox aliases sequentially. Never retry the same signup inside the
provider cooldown window.

For each run:

1. generate a unique QA alias and strong one-time password outside retained evidence;
2. sign up with the same redirect used by the frontend: `emailRedirectTo=https://superskill.sh`;
3. assert signup returns no session;
4. assert password login fails before confirmation;
5. receive exactly one confirmation email within the bounded timeout;
6. verify visible sender/from domain and that SPF, DKIM and DMARC pass in the inbox's
   authentication details;
7. open the one-time link once and verify it returns only to an allowlisted SuperSkill
   origin;
8. sign in and obtain the user session normally;
9. verify an absent `superskill:managed` grant still blocks managed routes;
10. grant the user through the operator RPC, verify recommend/no-match, revoke the grant,
    and verify the next request is blocked;
11. delete the QA user and revoke any remaining grant through the operator control plane.

Safe evidence fields: run ID, timestamps, origin, delivery latency, provider verdicts,
HTTP status/stable code, pseudonymous subject, and cleanup result. Do not retain email,
password, access/refresh token, confirmation URL, provider message body, raw user ID or
SMTP secret.

## Stop conditions

Remain **NO-GO** if any of these is true:

- custom SMTP is disabled or provider domain is unverified;
- any run is rate-limited, needs dashboard/manual confirmation, sends more than one
  message, or misses the bounded delivery window;
- SPF, DKIM or DMARC does not pass;
- a link redirects outside the allowlist or appears in logs/evidence;
- unconfirmed login succeeds;
- missing/revoked managed grant does not fail closed immediately;
- Supabase/provider incident is still affecting auth health;
- fewer than three consecutive unique runs pass.
