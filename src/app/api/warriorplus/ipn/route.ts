import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * WarriorPlus IPN (Instant Payment Notification) Handler
 *
 * When a customer buys through WarriorPlus, W+ POSTs transaction data here.
 * We verify the security key, then:
 *   - SALE: find or auto-create user, upgrade plan / add credits,
 *           POST to GoHighLevel webhook to trigger welcome email
 *   - REFUND: reverse the credits / downgrade
 *
 * Product mapping (WP_ITEM_NUMBER → action):
 *   461000 = AI Deck Gold   → plan='pro', +15 credits
 *   461001 = AI Deck 50 Cr  → +50 credits
 *   461002 = AI Deck 100 Cr → +100 credits
 *   461003 = AI Deck 250 Cr → +250 credits
 */

// Product WSO slug → credits to add
// W+ sends the WSO slug (e.g. "wso_fjh1d4") as WP_ITEM_NUMBER, NOT the numeric product ID
const PRODUCT_MAP: Record<string, { credits: number; name: string; isPro: boolean }> = {
  'wso_fjh1d4': { credits: 15, name: 'AI Deck Gold (Pro Access)', isPro: true },      // 461000
  'wso_v2z309': { credits: 50, name: 'AI Deck 50 Credits', isPro: false },             // 461001
  'wso_kbm5vk': { credits: 100, name: 'AI Deck 100 Credits', isPro: false },           // 461002
  'wso_j2l652': { credits: 250, name: 'AI Deck 250 Credits', isPro: false },           // 461003
};

// GoHighLevel Inbound Webhook URL for AIDeck Welcome Email workflow
const GHL_WEBHOOK_URL = process.env.GHL_WEBHOOK_URL || '';

export async function POST(request: NextRequest) {
  try {
    // WarriorPlus sends form-encoded POST data
    const formData = await request.formData();
    const data: Record<string, string> = {};
    formData.forEach((value, key) => {
      data[key] = value.toString();
    });

    // Log incoming IPN for debugging (remove in production if desired)
    console.log('[W+ IPN] Received:', JSON.stringify({
      action: data.WP_ACTION,
      item: data.WP_ITEM_NUMBER,
      email: data.WP_BUYER_EMAIL,
      amount: data.WP_SALE_AMOUNT,
      status: data.WP_PAYMENT_STATUS,
      saleId: data.WP_SALEID,
    }));

    // 1. Verify security key
    const expectedKey = process.env.WP_SECURITY_KEY;
    if (expectedKey && data.WP_SECURITYKEY !== expectedKey) {
      console.error('[W+ IPN] Security key mismatch');
      return NextResponse.json({ error: 'Invalid security key' }, { status: 403 });
    }

    // 2. Extract key fields
    const action = data.WP_ACTION; // 'sale', 'refund', 'dispute'
    const itemNumber = data.WP_ITEM_NUMBER;
    const buyerEmail = data.WP_BUYER_EMAIL?.toLowerCase().trim();
    const buyerName = data.WP_BUYER_NAME || '';
    const saleAmount = data.WP_SALE_AMOUNT || '0';
    const paymentStatus = data.WP_PAYMENT_STATUS; // 'Completed', 'Refunded', 'Pending'
    const saleId = data.WP_SALEID || data.WP_SALE || '';
    const txnId = data.WP_TXNID || '';

    // 3. Validate required fields
    if (!buyerEmail || !itemNumber) {
      console.error('[W+ IPN] Missing required fields');
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // 4. Look up product
    const product = PRODUCT_MAP[itemNumber];
    if (!product) {
      console.error(`[W+ IPN] Unknown product: ${itemNumber}`);
      return NextResponse.json({ error: 'Unknown product' }, { status: 400 });
    }

    const supabase = createAdminClient();

    // 5. Handle SALE
    // W+ sends status as "COMPLETED" (uppercase) — normalize for comparison
    const normalizedAction = action?.toLowerCase();
    const normalizedStatus = paymentStatus?.toLowerCase();

    if (normalizedAction === 'sale' && normalizedStatus === 'completed') {
      // Split buyer name into first/last
      const nameParts = buyerName.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Find user by email in aideck_profiles
      const { data: profile } = await supabase
        .from('aideck_profiles')
        .select('*')
        .eq('email', buyerEmail)
        .single();

      let userId = profile?.id;
      let isNewAccount = false;
      let passwordSetupLink = '';

      if (!profile) {
        // User NOT found — auto-create a Supabase account
        console.log(`[W+ IPN] Creating Supabase account for ${buyerEmail}...`);

        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: buyerEmail,
          email_confirm: true, // auto-confirm so they can log in immediately after setting password
          user_metadata: {
            full_name: buyerName,
            source: 'warriorplus',
          },
        });

        if (createError) {
          // If user already exists in auth but not in profiles, look them up
          if (createError.message?.includes('already been registered')) {
            const { data: { users } } = await supabase.auth.admin.listUsers();
            const existingUser = users?.find(u => u.email === buyerEmail);
            if (existingUser) {
              userId = existingUser.id;
              console.log(`[W+ IPN] Found existing auth user ${buyerEmail}, id: ${userId}`);
            }
          } else {
            console.error(`[W+ IPN] Error creating user: ${createError.message}`);
          }
        } else if (newUser?.user) {
          userId = newUser.user.id;
          isNewAccount = true;
          console.log(`[W+ IPN] ✅ Created Supabase account for ${buyerEmail}, id: ${userId}`);
        }

        // Generate a password setup link (magic link / recovery link)
        if (userId) {
          const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
            type: 'recovery',
            email: buyerEmail,
            options: {
              redirectTo: 'https://aideck.click/reset-password',
            },
          });

          if (linkData?.properties?.hashed_token) {
            // Use hashed_token with client-side verifyOtp (PKCE-compatible)
            const tokenHash = linkData.properties.hashed_token;
            passwordSetupLink = `https://aideck.click/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
            console.log(`[W+ IPN] Generated password setup link for ${buyerEmail}`);
          } else if (linkError) {
            console.error(`[W+ IPN] Error generating link: ${linkError.message}`);
            // Fallback: user can use "Forgot Password" on the login page
            passwordSetupLink = 'https://aideck.click/auth/login';
          }
        }

        // Wait a moment for the trigger to create the profile row
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Check if profile was created by the signup trigger
        const { data: newProfile } = await supabase
          .from('aideck_profiles')
          .select('*')
          .eq('email', buyerEmail)
          .single();

        if (newProfile) {
          userId = newProfile.id;
        }
      }

      // Now apply credits and upgrade
      if (userId) {
        // Re-fetch profile to get latest data
        const { data: currentProfile } = await supabase
          .from('aideck_profiles')
          .select('*')
          .eq('id', userId)
          .single();

        if (currentProfile) {
          const updates: Record<string, unknown> = {
            credits: currentProfile.credits + product.credits,
          };

          // Set the buyer's name on the profile if not already set
          if (buyerName && !currentProfile.full_name) {
            updates.full_name = buyerName;
          }

          // Upgrade to pro for any paid product
          if (product.isPro || currentProfile.plan === 'free') {
            updates.plan = 'pro';
          }

          await supabase
            .from('aideck_profiles')
            .update(updates)
            .eq('id', userId);

          // Log the credit transaction
          await supabase.from('aideck_credit_transactions').insert({
            user_id: userId,
            amount: product.credits,
            type: 'purchase',
            description: `${product.name} — W+ Sale #${saleId} ($${saleAmount})`,
          });

          console.log(`[W+ IPN] ✅ Added ${product.credits} credits to ${buyerEmail} (${product.name})`);
        }
      }

      // Also store in pending_purchases as a receipt/backup
      await supabase.from('aideck_pending_purchases').insert({
        email: buyerEmail,
        buyer_name: buyerName,
        product_id: itemNumber,
        product_name: product.name,
        credits: product.credits,
        is_pro: product.isPro,
        sale_amount: parseFloat(saleAmount),
        wp_sale_id: saleId,
        wp_txn_id: txnId,
        status: userId ? 'applied' : 'pending',
      });

      // POST to GoHighLevel webhook to trigger welcome email
      if (GHL_WEBHOOK_URL && (isNewAccount || !profile)) {
        try {
          const ghlResponse = await fetch(GHL_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: buyerEmail,
              first_name: firstName,
              last_name: lastName,
              product_name: product.name,
              credits: product.credits,
              password_setup_link: passwordSetupLink || 'https://aideck.click/auth/login',
              sale_amount: saleAmount,
              wp_sale_id: saleId,
            }),
          });
          console.log(`[W+ IPN] GHL webhook response: ${ghlResponse.status}`);
        } catch (ghlError) {
          console.error('[W+ IPN] GHL webhook error:', ghlError);
          // Don't fail the IPN — email is nice-to-have, not critical
        }
      }
    }

    // 6. Handle REFUND
    if (normalizedAction === 'refund' || normalizedStatus === 'refunded') {
      const { data: profile } = await supabase
        .from('aideck_profiles')
        .select('*')
        .eq('email', buyerEmail)
        .single();

      if (profile) {
        const newCredits = Math.max(0, profile.credits - product.credits);
        const updates: Record<string, unknown> = {
          credits: newCredits,
        };

        // If Gold was refunded, downgrade to free
        if (product.isPro) {
          updates.plan = 'free';
        }

        await supabase
          .from('aideck_profiles')
          .update(updates)
          .eq('id', profile.id);

        // Log the refund
        await supabase.from('aideck_credit_transactions').insert({
          user_id: profile.id,
          amount: -product.credits,
          type: 'refund',
          description: `Refund: ${product.name} — W+ Sale #${saleId}`,
        });

        console.log(`[W+ IPN] 🔄 Refund: Removed ${product.credits} credits from ${buyerEmail}`);
      } else {
        // Mark pending purchase as refunded
        await supabase
          .from('aideck_pending_purchases')
          .update({ status: 'refunded' })
          .eq('email', buyerEmail)
          .eq('wp_sale_id', saleId);

        console.log(`[W+ IPN] 🔄 Marked pending purchase as refunded for ${buyerEmail}`);
      }
    }

    // Always return 200 so W+ doesn't retry
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[W+ IPN] Error:', error);
    // Still return 200 to prevent W+ from endless retries
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 200 });
  }
}
