CREATE TABLE IF NOT EXISTS public.feedback (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL CHECK (type IN ('bug', 'feedback', 'other')),
  message TEXT NOT NULL,
  path TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now())
);

-- Enable RLS on the table
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to insert their own feedback
CREATE POLICY "Authenticated users can insert feedback" ON public.feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Allow admins to read all feedback
CREATE POLICY "Admins can read all feedback" ON public.feedback
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );
