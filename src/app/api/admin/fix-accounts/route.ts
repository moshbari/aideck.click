import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Admin API — Fix stuck accounts from failed IPN processing
 *
 * POST /api/admin/fix-accounts
 * Body: { email: string, adminKey: string }
 *
 * This will:
 * 1. Check if the user exists in auth.users
 * 2. Check if they have an aideck_profiles row
 * 3. If auth user exists but no profile → create the profile
 * 4. Apply any pending purchases
 * 5. Generate a password setup link
 */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, adminKey } = body;

    // Simple admin key check
    const expectedKey = process.env.WP_SECURITY_KEY;
    if (!expectedKey || adminKey !== expectedKey) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    if (!email) {
      return NextResponse.json({ error: 'Email required' }, { status: 400 });
    }

    const supabase = createAdminClient();
    const normalizedEmail = email.toLowerCase().trim();
    const results: string[] = [];

    // 1. Check auth.users
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const authUser = users?.find(u => u.email === normalizedEmail);

    if (!authUser) {
      // No auth user — create one
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: normalizedEmail,
        email_confirm: true,
        user_metadata: { source: 'admin_fix' },
      });

      if (createError) {
        results.push(`❌ Failed to create auth user: ${createError.message}`);
        return NextResponse.json({ results });
      }

      results.push(`✅ Created auth user: ${newUser?.user?.id}`);

      // Wait for trigger
      await new Promise(resolve => setTimeout(resolve, 2000));
    } else {
      results.push(`ℹ️ Auth user already exists: ${authUser.id}`);
    }

    const userId = authUser?.id || (await supabase.auth.admin.listUsers()).data?.users?.find(u => u.email === normalizedEmail)?.id;

    if (!userId) {
      results.push('❌ Could not find or create user ID');
      return NextResponse.json({ results });
    }

    // 2. Check aideck_profiles
    const { data: profile } = await supabase
      .from('aideck_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (!profile) {
      // No profile row — create one manually
      const { error: profileError } = await supabase
        .from('aideck_profiles')
        .insert({
          id: userId,
          email: normalizedEmail,
          plan: 'free',
          credits: 0,
          role: 'user',
          status: 'active',
        });

      if (profileError) {
        results.push(`❌ Failed to create profile: ${profileError.message}`);
      } else {
        results.push('✅ Created aideck_profiles row');
      }
    } else {
      results.push(`ℹ️ Profile already exists — plan: ${profile.plan}, credits: ${profile.credits}`);
    }

    // 3. Check pending purchases
    const { data: pendingPurchases } = await supabase
      .from('aideck_pending_purchases')
      .select('*')
      .eq('email', normalizedEmail)
      .eq('status', 'pending');

    if (pendingPurchases && pendingPurchases.length > 0) {
      for (const purchase of pendingPurchases) {
        // Apply credits
        const { data: currentProfile } = await supabase
          .from('aideck_profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (currentProfile) {
          const updates: Record<string, unknown> = {
            credits: currentProfile.credits + purchase.credits,
          };
          if (purchase.is_pro) {
            updates.plan = 'pro';
          }

          await supabase
            .from('aideck_profiles')
            .update(updates)
            .eq('id', userId);

          await supabase
            .from('aideck_pending_purchases')
            .update({ status: 'applied' })
            .eq('id', purchase.id);

          results.push(`✅ Applied ${purchase.credits} credits from ${purchase.product_name}`);
        }
      }
    } else {
      results.push('ℹ️ No pending purchases found');
    }

    // 4. Re-fetch final profile state
    const { data: finalProfile } = await supabase
      .from('aideck_profiles')
      .select('*')
      .eq('id', userId)
      .single();

    // 5. Generate password setup link
    const { data: linkData } = await supabase.auth.admin.generateLink({
      type: 'recovery',
      email: normalizedEmail,
      options: {
        redirectTo: 'https://aideck.click/reset-password',
      },
    });

    const passwordLink = linkData?.properties?.action_link || 'N/A';

    return NextResponse.json({
      results,
      user: {
        id: userId,
        email: normalizedEmail,
        plan: finalProfile?.plan,
        credits: finalProfile?.credits,
        passwordSetupLink: passwordLink,
      },
    });
  } catch (error) {
    console.error('[Admin Fix] Error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
