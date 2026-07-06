drop policy if exists "Profiles are readable by everyone" on public.profiles;
drop policy if exists "Users read own profile" on public.profiles;

create policy "Users read own profile"
  on public.profiles for select
  using (auth.uid() = id);
