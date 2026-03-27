export interface AideckProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: 'user' | 'admin';
  status: 'active' | 'inactive';
  credits: number;
  lifetime_free_decks_used: number;
  lifetime_free_decks_limit: number;
  plan: 'free' | 'pro';
  created_at: string;
  updated_at: string;
}

export interface AideckGeneration {
  id: string;
  user_id: string;
  prompt: string;
  tone: string | null;
  purpose: string | null;
  slide_count: number | null;
  color_theme: string | null;
  animations: boolean;
  credits_used: number;
  created_at: string;
}

export interface AideckCreditTransaction {
  id: string;
  user_id: string;
  amount: number;
  type: 'purchase' | 'usage' | 'admin_adjustment' | 'refund' | 'signup_bonus';
  description: string | null;
  generation_id: string | null;
  created_at: string;
}
