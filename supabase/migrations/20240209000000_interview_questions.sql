
create table if not exists interview_questions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  application_id uuid references applications(id) on delete set null,
  question text not null,
  answer text,
  tags text[],
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Add indexes
create index if not exists interview_questions_user_id_idx on interview_questions(user_id);
create index if not exists interview_questions_application_id_idx on interview_questions(application_id);

-- RLS Policies
alter table interview_questions enable row level security;

create policy "Users can view their own questions"
  on interview_questions for select
  using (auth.uid() = user_id);

create policy "Users can insert their own questions"
  on interview_questions for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own questions"
  on interview_questions for update
  using (auth.uid() = user_id);

create policy "Users can delete their own questions"
  on interview_questions for delete
  using (auth.uid() = user_id);
