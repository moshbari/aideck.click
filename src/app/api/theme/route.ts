import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('aideck_site_settings')
      .select('value')
      .eq('key', 'active_theme')
      .single();

    if (error || !data) {
      return NextResponse.json({ theme: 'dark' });
    }

    return NextResponse.json({ theme: data.value || 'dark' });
  } catch {
    // If the table doesn't exist or any error, default to dark
    return NextResponse.json({ theme: 'dark' });
  }
}
