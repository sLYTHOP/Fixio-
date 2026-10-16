create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text,
  source text not null,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists waitlist_email_role_source_key
  on public.waitlist (lower(email), coalesce(role, ''), source);

alter table public.waitlist enable row level security;

grant insert on public.waitlist to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'waitlist'
      and policyname = 'Authenticated users can join waitlist'
  ) then
    create policy "Authenticated users can join waitlist"
      on public.waitlist
      for insert
      to authenticated
      with check (
        user_id = auth.uid()
        and lower(email) = lower(auth.jwt() ->> 'email')
      );
  end if;
end
$$;
