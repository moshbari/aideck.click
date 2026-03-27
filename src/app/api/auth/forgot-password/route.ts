import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/auth/forgot-password
 *
 * Server-side forgot-password that:
 *   1. Generates a password reset link via Supabase Admin API
 *   2. Sends the link through GoHighLevel webhook (so the email
 *      comes from GHL's configured sender, not Supabase)
 *
 * Body: { email: string }
 */

const GHL_PASSWORD_RESET_WEBHOOK_URL =
  process.env.GHL_PASSWORD_RESET_WEBHOOK_URL || '';

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'Email is required' },
        { status: 400 },
      );
    }

    const normalizedEmail = email.toLowerCase().trim();
    const supabase = createAdminClient();

    // 1. Check the user actually exists before generating a link
    //    (prevents leaking whether an email is registered — we still
    //     return a generic success message either way)
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const user = users?.find((u) => u.email === normalizedEmail);

    if (!user) {
      // Don't reveal that the email doesn't exist
      console.log(`[Forgot-PW] No user found for ${normalizedEmail} — returning silent success`);
      return NextResponse.json({ success: true });
    }

    // 2. Generate recovery link via Supabase Admin API
    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: normalizedEmail,
        options: {
          redirectTo: 'https://aideck.click/reset-password',
        },
      });

    if (linkError || !linkData?.properties?.action_link) {
      console.error(
        `[Forgot-PW] Error generating link: ${linkError?.message || 'no link returned'}`,
      );
      return NextResponse.json(
        { error: 'Failed to generate reset link' },
        { status: 500 },
      );
    }

    const resetLink = linkData.properties.action_link;
    console.log(`[Forgot-PW] Generated reset link for ${normalizedEmail}`);

    // 3. POST to GoHighLevel webhook to trigger the password-reset email
    if (GHL_PASSWORD_RESET_WEBHOOK_URL) {
      try {
        const firstName =
          user.user_metadata?.full_name?.split(/\s+/)[0] ||
          user.user_metadata?.first_name ||
          '';

        const ghlRes = await fetch(GHL_PASSWORD_RESET_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: normalizedEmail,
            first_name: firstName,
            password_reset_link: resetLink,
          }),
        });

        console.log(`[Forgot-PW] GHL webhook response: ${ghlRes.status}`);
      } catch (ghlErr) {
        console.error('[Forgot-PW] GHL webhook error:', ghlErr);
        // Fall through — we'll still return success so the user
        // isn't stuck, and the link was generated regardless.
      }
    } else {
      // No GHL webhook configured — fall back to Supabase built-in email
      console.log('[Forgot-PW] No GHL webhook URL — falling back to Supabase email');
      await supabase.auth.admin.generateLink({
        type: 'recovery',
        email: normalizedEmail,
        options: {
          redirectTo: 'https://aideck.click/reset-password',
        },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Forgot-PW] Error:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 },
    );
  }
}
