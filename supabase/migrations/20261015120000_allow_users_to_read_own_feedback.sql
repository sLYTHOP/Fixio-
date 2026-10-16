alter table public.feedback enable row level security;

grant select on public.feedback to authenticated;

create policy "Users can read their own feedback"
  on public.feedback
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can download their own resumes"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'resumes'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
