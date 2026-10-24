alter table public.feedback
  add column if not exists analysis_key text;

create unique index if not exists feedback_user_analysis_key_unique
  on public.feedback (user_id, analysis_key)
  where analysis_key is not null;
