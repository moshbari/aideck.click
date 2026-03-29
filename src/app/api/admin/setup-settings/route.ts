import { NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

/**
 * One-time setup: creates the aideck_site_settings table.
 * Hit GET /api/admin/setup-settings once after deploy.
 * Only admins can use this endpoint.
 *
 * SQL this executes:
 *   CREATE TABLE IF NOT EXISTS aideck_site_settings (
 *     key TEXT PRIMARY KEY,
 *     value TEXT NOT NULL,
 *     updated_at TIMESTAMPTZ DEFAULT now()
 *   );
 *   INSERT INTO aideck_site_settings (key, value)
 *     VALUES ('active_theme', 'dark')
 *     ON CONFLICT (key) DO NOTHING;
 */
export async function GET() {
  try {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Not authenticated. Log in first.' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('aideck_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Admin only.' }, { status: 403 });
    }

    // The table needs to be created directly in Supabase SQL Editor.
    // This endpoint provides the SQL and checks if the table already works.

    const sql = `
CREATE TABLE IF NOT EXISTS aideck_site_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seed with default theme
INSERT INTO aideck_site_settings (key, value)
  VALUES ('active_theme', 'dark')
  ON CONFLICT (key) DO NOTHING;

-- Allow service role full access (no RLS needed for admin-only table)
ALTER TABLE aideck_site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Service role full access" ON aideck_site_settings
  FOR ALL USING (true) WITH CHECK (true);
    `.trim();

    // Try to read from the table to check if it exists
    const { data, error } = await supabase
      .from('aideck_site_settings')
      .select('*')
      .limit(1);

    if (error) {
      return NextResponse.json({
        status: 'TABLE_NOT_FOUND',
        message:
          'The aideck_site_settings table does not exist yet. Please run this SQL in your Supabase SQL Editor:',
        sql,
      });
    }

    return NextResponse.json({
      status: 'OK',
      message: 'Table already exists and is working!',
      rows: data,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
