create table if not exists public.user_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,
  message text not null check (char_length(message) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.user_feedback enable row level security;

grant insert on public.user_feedback to authenticated;
grant insert on public.user_feedback to anon;

create policy "Authenticated users can submit their own feedback"
  on public.user_feedback
  for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and lower(email) = lower(auth.jwt() ->> 'email')
  );

create policy "Visitors can submit anonymous feedback"
  on public.user_feedback
  for insert
  to anon
  with check (user_id is null and email is null);
