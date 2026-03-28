import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getDownloadUrl } from '@/lib/r2';

/**
 * GET /api/presentations — List user's saved presentations
 * Query params: ?action=download&id=<presentation_id> for download URL
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth cookie
    const authHeader = request.headers.get('cookie') || '';
    let userId: string | null = null;

    // Supabase stores cookies in format: sb-<project>-auth-token=base64-<base64json>
    // where the JSON is {access_token, refresh_token, ...} or legacy [access_token, refresh_token]
    const tokenMatch = authHeader.match(/sb-[^=]+-auth-token[^=]*=([^;]+)/);
    if (tokenMatch) {
      try {
        let tokenValue = decodeURIComponent(tokenMatch[1]);

        // Handle base64- prefix (newer Supabase format)
        if (tokenValue.startsWith('base64-')) {
          tokenValue = Buffer.from(tokenValue.substring(7), 'base64').toString('utf-8');
        }

        // Try to parse as JSON
        try {
          const parsed = JSON.parse(tokenValue);
          if (Array.isArray(parsed) && parsed[0]) {
            // Legacy format: [access_token, refresh_token]
            tokenValue = parsed[0];
          } else if (parsed && typeof parsed === 'object' && parsed.access_token) {
            // New format: {access_token, refresh_token, ...}
            tokenValue = parsed.access_token;
          }
        } catch {
          // Not JSON, use as-is
        }
        const { data: { user } } = await supabaseAdmin.auth.getUser(tokenValue);
        if (user) userId = user.id;
      } catch {
        // Auth failed
      }
    }

    if (!userId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get('action');
    const id = searchParams.get('id');

    // --- Download action: return a signed download URL ---
    if (action === 'download' && id) {
      const { data: presentation, error: fetchError } = await supabaseAdmin
        .from('aideck_saved_presentations')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single();

      if (fetchError || !presentation) {
        return NextResponse.json({ error: 'Presentation not found' }, { status: 404 });
      }

      // Check if expired
      if (new Date(presentation.expires_at) < new Date()) {
        // Clean up the expired record
        await supabaseAdmin
          .from('aideck_saved_presentations')
          .delete()
          .eq('id', id);
        return NextResponse.json({ error: 'This presentation has expired and been deleted' }, { status: 410 });
      }

      try {
        const downloadUrl = await getDownloadUrl(presentation.r2_key);
        return NextResponse.json({
          url: downloadUrl,
          filename: presentation.filename,
        });
      } catch (r2Error) {
        console.error('R2 download URL error:', r2Error);
        return NextResponse.json({ error: 'Failed to generate download link' }, { status: 500 });
      }
    }

    // --- Default action: list all saved presentations ---
    const now = new Date().toISOString();

    // First, clean up any expired presentations
    await supabaseAdmin
      .from('aideck_saved_presentations')
      .delete()
      .eq('user_id', userId)
      .lt('expires_at', now);

    // Then fetch the remaining ones
    const { data: presentations, error: listError } = await supabaseAdmin
      .from('aideck_saved_presentations')
      .select('id, filename, title, description, slide_count, tone, color_theme, file_size, expires_at, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (listError) {
      console.error('List presentations error:', listError);
      return NextResponse.json({ error: 'Failed to fetch presentations' }, { status: 500 });
    }

    return NextResponse.json({ presentations: presentations || [] });
  } catch (error) {
    console.error('Presentations API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
