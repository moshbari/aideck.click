import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    // Verify the user is an authenticated admin
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('aideck_profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse and validate the theme
    const body = await request.json();
    const { theme } = body;

    if (!['dark', 'deckai'].includes(theme)) {
      return NextResponse.json({ error: 'Invalid theme. Use "dark" or "deckai".' }, { status: 400 });
    }

    // Save to Supabase using admin client (bypasses RLS)
    const adminSupabase = createAdminClient();
    const { error: upsertError } = await adminSupabase
      .from('aideck_site_settings')
      .upsert(
        { key: 'active_theme', value: theme, updated_at: new Date().toISOString() },
        { onConflict: 'key' }
      );

    if (upsertError) {
      console.error('Theme upsert error:', upsertError);
      return NextResponse.json(
        { error: 'Failed to save theme. Make sure the aideck_site_settings table exists.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, theme });
  } catch (err) {
    console.error('Theme API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
