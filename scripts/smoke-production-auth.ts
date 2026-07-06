import { createClient } from "@supabase/supabase-js";

const apiUrl = (process.env.SMOKE_API_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `qa+publish-${suffix}@onlyharness.com`;
const password = `OnlyHarnessSmoke-${suffix}!`;
const name = `qa-publish-${suffix}`;
const expectEmailConfirmation = process.env.SMOKE_EXPECT_EMAIL_CONFIRMATION === "1";
const authRateLimitOk = process.env.SMOKE_AUTH_RATE_LIMIT_OK === "1";

const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
  email,
  password,
  options: {
    data: { display_name: "OnlyHarness QA" },
    emailRedirectTo: "https://onlyharness.com"
  }
});

if (signUpError) {
  if (authRateLimitOk && /rate limit/i.test(signUpError.message)) {
    console.warn(`Production auth confirmation smoke skipped: Supabase signup rate limited (${signUpError.message})`);
    process.exit(0);
  }
  throw new Error(`Supabase signUp failed: ${signUpError.message}`);
}

if (expectEmailConfirmation) {
  if (signUpData.session?.access_token) {
    throw new Error("Expected email confirmation to block immediate session, but signup returned an access token");
  }
  const login = await supabase.auth.signInWithPassword({ email, password });
  if (!login.error) {
    throw new Error("Expected unconfirmed user sign-in to fail before email confirmation");
  }
  console.log(`Production auth confirmation smoke passed: signup requires email confirmation for ${email}`);
  process.exit(0);
}

const session = signUpData.session ?? (await supabase.auth.signInWithPassword({ email, password })).data.session;
if (!session?.access_token) throw new Error("Supabase did not return an access token; check email confirmation settings");

const response = await fetch(`${apiUrl}/imports/markdown-to-harness`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${session.access_token}`
  },
  body: JSON.stringify({
    name,
    markdown: `# QA Publish ${suffix}\n\nValidate that a registered OnlyHarness user can publish a harness through the production API auth guard.`
  })
});

const body = await response.json() as { item?: { name?: string }; error?: string };
if (!response.ok) throw new Error(`Publish failed with ${response.status}: ${JSON.stringify(body)}`);
if (body.item?.name !== name) throw new Error(`Unexpected published item: ${JSON.stringify(body)}`);

await supabase.auth.signOut();
console.log(`Production auth publish smoke passed: ${body.item.name}`);
