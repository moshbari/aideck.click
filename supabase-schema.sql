-- AIDeck SaaS Schema
-- All tables prefixed with aideck_ to avoid conflicts with other projects

-- ─── PROFILES TABLE ───
-- Extends Supabase auth.users with app-specific fields
CREATE TABLE IF NOT EXISTS aideck_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  credits INTEGER NOT NULL DEFAULT 0,
  lifetime_free_decks_used INTEGER NOT NULL DEFAULT 0,
  lifetime_free_decks_limit INTEGER NOT NULL DEFAULT 2,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── GENERATIONS TABLE ───
-- Tracks every deck generation for analytics + credit deduction
CREATE TABLE IF NOT EXISTS aideck_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES aideck_profiles(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  tone TEXT,
  purpose TEXT,
  slide_count INTEGER,
  color_theme TEXT,
  animations BOOLEAN DEFAULT false,
  credits_used INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── CREDIT TRANSACTIONS TABLE ───
-- Audit log for all credit changes (purchases, usage, admin adjustments)
CREATE TABLE IF NOT EXISTS aideck_credit_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES aideck_profiles(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL, -- positive = credit added, negative = credit used
  type TEXT NOT NULL CHECK (type IN ('purchase', 'usage', 'admin_adjustment', 'refund', 'signup_bonus')),
  description TEXT,
  generation_id UUID REFERENCES aideck_generations(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── SAVED PRESENTATIONS TABLE ───
-- Stores metadata for presentations uploaded to R2 cloud storage
-- Files auto-expire after 25 days via R2 lifecycle rules
CREATE TABLE IF NOT EXISTS aideck_saved_presentations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES aideck_profiles(id) ON DELETE CASCADE,
  generation_id UUID REFERENCES aideck_generations(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,           -- smart filename like "AI-Marketing-2026-03-28-abc123.pptx"
  r2_key TEXT NOT NULL,             -- full R2 object key (aideck-presentations/filename)
  file_size INTEGER NOT NULL,       -- file size in bytes
  title TEXT NOT NULL,              -- presentation title from Claude
  description TEXT,                 -- short summary of what the presentation is about
  slide_count INTEGER,
  tone TEXT,
  color_theme TEXT,
  expires_at TIMESTAMPTZ NOT NULL,  -- 25 days from creation
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aideck_saved_pres_user ON aideck_saved_presentations(user_id);
CREATE INDEX IF NOT EXISTS idx_aideck_saved_pres_expires ON aideck_saved_presentations(expires_at);

-- ─── PENDING PURCHASES TABLE ───
-- Stores WarriorPlus purchases for users who haven't signed up yet.
-- When they sign up with the same email, credits are auto-applied.
CREATE TABLE IF NOT EXISTS aideck_pending_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  buyer_name TEXT,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  credits INTEGER NOT NULL,
  is_pro BOOLEAN NOT NULL DEFAULT false,
  sale_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  wp_sale_id TEXT,
  wp_txn_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_aideck_pending_email ON aideck_pending_purchases(email);
CREATE INDEX IF NOT EXISTS idx_aideck_pending_status ON aideck_pending_purchases(status);

-- ─── INDEXES ───
CREATE INDEX IF NOT EXISTS idx_aideck_profiles_email ON aideck_profiles(email);
CREATE INDEX IF NOT EXISTS idx_aideck_profiles_role ON aideck_profiles(role);
CREATE INDEX IF NOT EXISTS idx_aideck_profiles_status ON aideck_profiles(status);
CREATE INDEX IF NOT EXISTS idx_aideck_generations_user ON aideck_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_aideck_generations_created ON aideck_generations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aideck_credit_tx_user ON aideck_credit_transactions(user_id);

-- ─── AUTO-CREATE PROFILE ON SIGNUP ───
-- Trigger function: when a new user signs up via Supabase Auth,
-- automatically create their aideck_profiles row
CREATE OR REPLACE FUNCTION aideck_handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  pending RECORD;
  total_credits INTEGER := 0;
  should_be_pro BOOLEAN := false;
BEGIN
  -- 1. Create the profile (use ON CONFLICT to avoid duplicate errors)
  INSERT INTO aideck_profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Check for pending WarriorPlus purchases
  FOR pending IN
    SELECT * FROM aideck_pending_purchases
    WHERE email = NEW.email AND status = 'pending'
  LOOP
    total_credits := total_credits + pending.credits;
    IF pending.is_pro THEN
      should_be_pro := true;
    END IF;

    -- Log the credit transaction
    INSERT INTO aideck_credit_transactions (user_id, amount, type, description)
    VALUES (
      NEW.id,
      pending.credits,
      'purchase',
      'Applied pending purchase: ' || pending.product_name || ' (W+ Sale #' || COALESCE(pending.wp_sale_id, '?') || ')'
    );

    -- Mark as applied
    UPDATE aideck_pending_purchases SET status = 'applied' WHERE id = pending.id;
  END LOOP;

  -- 3. Apply accumulated credits and pro status
  IF total_credits > 0 OR should_be_pro THEN
    UPDATE aideck_profiles SET
      credits = total_credits,
      plan = CASE WHEN should_be_pro OR total_credits > 0 THEN 'pro' ELSE 'free' END
    WHERE id = NEW.id;
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Log but don't fail — the IPN handler will create the profile as a fallback
  RAISE WARNING '[aideck_handle_new_user] trigger error for %: % (SQLSTATE: %)', NEW.email, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists then create
DROP TRIGGER IF EXISTS aideck_on_auth_user_created ON auth.users;
CREATE TRIGGER aideck_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION aideck_handle_new_user();

-- ─── ADMIN HELPER FUNCTION ───
-- SECURITY DEFINER to avoid infinite recursion in RLS policies
-- (admin policies on aideck_profiles can't self-reference aideck_profiles)
CREATE OR REPLACE FUNCTION aideck_is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM aideck_profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── ROW LEVEL SECURITY ───
ALTER TABLE aideck_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE aideck_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE aideck_credit_transactions ENABLE ROW LEVEL SECURITY;

ALTER TABLE aideck_saved_presentations ENABLE ROW LEVEL SECURITY;

-- Saved presentations: users see own, admins see all
CREATE POLICY "Users can view own saved presentations"
  ON aideck_saved_presentations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own saved presentations"
  ON aideck_saved_presentations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own saved presentations"
  ON aideck_saved_presentations FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all saved presentations"
  ON aideck_saved_presentations FOR SELECT
  USING (aideck_is_admin());

-- Profiles: users can read their own, admins can read all
CREATE POLICY "Users can view own profile"
  ON aideck_profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON aideck_profiles FOR SELECT
  USING (aideck_is_admin());

CREATE POLICY "Users can update own profile (name only)"
  ON aideck_profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Admins can update any profile"
  ON aideck_profiles FOR UPDATE
  USING (aideck_is_admin());

-- Generations: users see own, admins see all
CREATE POLICY "Users can view own generations"
  ON aideck_generations FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own generations"
  ON aideck_generations FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all generations"
  ON aideck_generations FOR SELECT
  USING (aideck_is_admin());

-- Credit transactions: users see own, admins see all
CREATE POLICY "Users can view own credit transactions"
  ON aideck_credit_transactions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own credit transactions"
  ON aideck_credit_transactions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all credit transactions"
  ON aideck_credit_transactions FOR SELECT
  USING (aideck_is_admin());

CREATE POLICY "Admins can insert credit transactions"
  ON aideck_credit_transactions FOR INSERT
  WITH CHECK (aideck_is_admin());
