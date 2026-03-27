import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * WarriorPlus IPN (Instant Payment Notification) Handler
 *
 * When a customer buys through WarriorPlus, W+ POSTs transaction data here.
 * We verify the security key, then:
 *   - SALE: upgrade the user's plan / add credits
 *   - REFUND: reverse the credits / downgrade
 *
 * Product mapping (WP_ITEM_NUMBER → action):
 *   461000 = AI Deck Gold   → plan='pro', +15 credits
 *   461001 = AI Deck 50 Cr  → +50 credits
 *   461002 = AI Deck 100 Cr → +100 credits
 *   461003 = AI Deck 250 Cr → +250 credits
 */

// Product ID → credits to add
const PRODUCT_MAP: Record<string, { credits: number; name: string; isPro: boolean }> = {
  '461000': { credits: 15, name: 'AI Deck Gold (Pro Access)', isPro: true },
  '461001': { credits: 50, name: 'AI Deck 50 Credits', isPro: false },
  '461002': { credits: 100, name: 'AI Deck 100 Credits', isPro: false },
  '461003': { credits: 250, name: 'AI Deck 250 Credits', isPro: false },
};

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
    if (action === 'sale' && paymentStatus === 'Completed') {
      // Find user by email
      const { data: profile } = await supabase
        .from('aideck_profiles')
        .select('*')
        .eq('email', buyerEmail)
        .single();

      if (profile) {
        // User exists — update their profile
        const updates: Record<string, unknown> = {
          credits: profile.credits + product.credits,
        };

        // If this is the Gold/Pro product, upgrade plan
        if (product.isPro) {
          updates.plan = 'pro';
        }
        // Credit packs also upgrade to pro (they paid, they deserve full access)
        if (profile.plan === 'free') {
          updates.plan = 'pro';
        }

        await supabase
          .from('aideck_profiles')
          .update(updates)
          .eq('id', profile.id);

        // Log the credit transaction
        await supabase.from('aideck_credit_transactions').insert({
          user_id: profile.id,
          amount: product.credits,
          type: 'purchase',
          description: `${product.name} — W+ Sale #${saleId} ($${saleAmount})`,
        });

        console.log(`[W+ IPN] ✅ Added ${product.credits} credits to ${buyerEmail} (${product.name})`);
      } else {
        // User NOT found — store as pending purchase
        // When they sign up with this email, credits will be applied
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
          status: 'pending',
        });

        console.log(`[W+ IPN] ⏳ Stored pending purchase for ${buyerEmail} (${product.name}) — user not found yet`);
      }
    }

    // 6. Handle REFUND
    if (action === 'refund' || paymentStatus === 'Refunded') {
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
