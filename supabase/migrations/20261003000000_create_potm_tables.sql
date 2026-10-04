-- Problem of the Month tables.
--
-- This site shares a Supabase project (and therefore auth.users) with the
-- Problem of the Week site, but keeps its own problems, submissions, and
-- profiles so the two leaderboards are independent. Everything here is
-- prefixed with `potm_` so it never collides with the POTW objects.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.potm_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  problems_solved INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  all_time_points INTEGER NOT NULL DEFAULT 0,
  all_time_problems_solved INTEGER NOT NULL DEFAULT 0,
  is_admin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.potm_problems (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
  points INTEGER NOT NULL DEFAULT 10,
  -- First day of the month this problem belongs to (e.g. 2026-10-01)
  month DATE NOT NULL CHECK (EXTRACT(DAY FROM month) = 1),
  due_date TIMESTAMP WITH TIME ZONE NOT NULL,
  hint TEXT,
  correct_answer TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  -- Users in the order they submitted; used as a leaderboard tie-breaker
  submitted_user_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.potm_submissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  problem_id UUID NOT NULL REFERENCES public.potm_problems(id) ON DELETE CASCADE,
  selected_answer TEXT NOT NULL,
  is_correct BOOLEAN NOT NULL,
  points_earned INTEGER NOT NULL DEFAULT 0,
  submitted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, problem_id)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so RLS policies can call it without recursing into
-- potm_profiles' own policies.
CREATE OR REPLACE FUNCTION public.is_potm_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.potm_profiles
    WHERE user_id = auth.uid() AND is_admin = true
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_potm_admin() TO authenticated;

-- Accounts are shared with the POTW site, so a user may already exist in
-- auth.users without a POTM profile (e.g. they signed up on POTW). The app
-- calls this after login to lazily create their POTM profile.
CREATE OR REPLACE FUNCTION public.ensure_potm_profile()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.potm_profiles (user_id, display_name)
  SELECT
    u.id,
    COALESCE(
      NULLIF(u.raw_user_meta_data->>'display_name', ''),
      (SELECT p.display_name FROM public.profiles p WHERE p.user_id = u.id),
      'Student'
    )
  FROM auth.users u
  WHERE u.id = auth.uid()
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ensure_potm_profile() TO authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.potm_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.potm_problems ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.potm_submissions ENABLE ROW LEVEL SECURITY;

-- Profiles: public leaderboard. Rows are created via ensure_potm_profile()
-- and updated by the submission trigger, so clients get no write access.
CREATE POLICY "POTM profiles are viewable by everyone"
  ON public.potm_profiles
  FOR SELECT
  USING (true);

-- Problems
CREATE POLICY "Anyone can view active POTM problems"
  ON public.potm_problems
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "POTM admins can manage problems"
  ON public.potm_problems
  FOR ALL
  TO authenticated
  USING (public.is_potm_admin())
  WITH CHECK (public.is_potm_admin());

-- Submissions
CREATE POLICY "Users can view their own POTM submissions"
  ON public.potm_submissions
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own POTM submissions"
  ON public.potm_submissions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Submission trigger: update profile totals and record submission order
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.potm_update_profile_on_submission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Make sure the profile exists so points are never silently dropped
  INSERT INTO public.potm_profiles (user_id, display_name)
  SELECT
    u.id,
    COALESCE(NULLIF(u.raw_user_meta_data->>'display_name', ''), 'Student')
  FROM auth.users u
  WHERE u.id = NEW.user_id
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.potm_profiles
  SET
    total_points = total_points + NEW.points_earned,
    all_time_points = all_time_points + NEW.points_earned,
    problems_solved = CASE WHEN NEW.is_correct THEN problems_solved + 1 ELSE problems_solved END,
    all_time_problems_solved = CASE WHEN NEW.is_correct THEN all_time_problems_solved + 1 ELSE all_time_problems_solved END,
    updated_at = now()
  WHERE user_id = NEW.user_id;

  -- Earlier submitters get lower indices (leaderboard tie-breaker)
  UPDATE public.potm_problems
  SET submitted_user_ids = CASE
    WHEN NEW.user_id = ANY(submitted_user_ids) THEN submitted_user_ids
    ELSE array_append(submitted_user_ids, NEW.user_id)
  END
  WHERE id = NEW.problem_id;

  RETURN NEW;
END;
$$;

CREATE TRIGGER potm_on_submission_created
  AFTER INSERT ON public.potm_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.potm_update_profile_on_submission();

-- ---------------------------------------------------------------------------
-- Yearly reset (admin only): zero current-year stats, keep all-time totals
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reset_potm_yearly_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_potm_admin() THEN
    RAISE EXCEPTION 'Only admins can reset the leaderboard';
  END IF;

  -- `WHERE true` is required by Supabase's `safeupdate` extension
  UPDATE public.potm_profiles
  SET
    total_points = 0,
    problems_solved = 0,
    current_streak = 0,
    updated_at = now()
  WHERE true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_potm_yearly_leaderboard() TO authenticated;

-- ---------------------------------------------------------------------------
-- Bootstrap: carry over existing POTW admins as POTM admins
-- ---------------------------------------------------------------------------

INSERT INTO public.potm_profiles (user_id, display_name, is_admin)
SELECT user_id, display_name, true
FROM public.profiles
WHERE is_admin = true
ON CONFLICT (user_id) DO UPDATE SET is_admin = true;
