'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Suspense } from 'react';

/**
 * Thank You / Welcome Page — shown after WarriorPlus purchase
 *
 * Flow:
 *   1. Checkout email guide image at top (shows 2 emails in W+ checkout)
 *   2. "We already sent you a password setup email" — use your DELIVERY email
 *   3. Can't find it? Check spam
 *   4. Still can't find it? Use the form below (last resort)
 */

function ThankYouContent() {
  const searchParams = useSearchParams();
  const urlEmail = searchParams.get('email') || '';
  const urlName = searchParams.get('name') || '';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (urlEmail) setEmail(urlEmail);
    if (urlName) setFullName(urlName);
  }, [urlEmail, urlName]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setIsLoading(true);

    try {
      const supabase = createClient();
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (signUpError) {
        if (
          signUpError.message?.toLowerCase().includes('already registered') ||
          signUpError.message?.toLowerCase().includes('already been registered')
        ) {
          setError(
            'An account with this email already exists — we created it for you automatically! Check your email for the password setup link, or go to the login page and click "Forgot Password".'
          );
          return;
        }
        setError(signUpError.message);
        return;
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">

        {/* ---- Welcome Banner ---- */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-4xl font-bold mb-2">Welcome to AI Deck!</h1>
          <p className="text-gray-400 text-lg">
            Your credits have been applied. Let&apos;s get you started.
          </p>
        </div>

        {/* ---- Step 1: We already sent you an email ---- */}
        <div className="mb-6 p-5 bg-gray-900/60 border border-orange-500/30 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-white text-lg mb-2">We Already Sent You a Password Setup Email</h2>
              <p className="text-gray-300 text-sm leading-relaxed mb-3">
                Your account has been created using your <span className="text-orange-400 font-semibold">Delivery Email</span> from checkout.
                Open the email from AI Deck and click the password setup link to get started.
              </p>
              <div className="p-3 bg-yellow-900/20 border border-yellow-500/20 rounded-lg">
                <p className="text-yellow-300 text-sm">
                  Can&apos;t find it? <span className="font-semibold">Check your spam/junk folder.</span> The email may take a minute to arrive.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ---- Login Button ---- */}
        <Link
          href="/login"
          className="block w-full py-3 px-4 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-pink-600 transition duration-200 text-center mb-6"
        >
          Go to Login
        </Link>

        {/* ---- Divider: Can't find the email at all? ---- */}
        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-800"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-3 bg-black text-gray-500">Can&apos;t find the email at all?</span>
          </div>
        </div>

        {/* ---- Fallback: Create account manually ---- */}
        {!showForm && !success && (
          <div>
            <p className="text-gray-400 text-sm mb-4 text-center">
              If you didn&apos;t receive the password setup email, you can create your account manually.
              Make sure to use the same <span className="text-orange-400 font-medium">Delivery Email</span> you used at checkout.
            </p>

            {/* ---- Checkout Email Guide Image ---- */}
            <div className="mb-6 rounded-xl overflow-hidden border border-gray-800">
              <Image
                src="/checkout-email-guide.jpg"
                alt="WarriorPlus checkout — use your Delivery Email to create your AI Deck account"
                width={640}
                height={480}
                className="w-full h-auto"
              />
            </div>

            <div className="text-center">
              <button
                onClick={() => setShowForm(true)}
                className="py-3 px-8 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition duration-200"
              >
                Create Account Manually
              </button>
            </div>
          </div>
        )}

        {/* ---- Success Message ---- */}
        {success && (
          <div className="mb-6 p-4 bg-green-900/20 border border-green-500/50 rounded-lg">
            <p className="text-green-400 text-sm">
              Account created! Check your email to confirm, then{' '}
              <Link href="/login" className="underline font-medium hover:text-green-300">
                sign in here
              </Link>.
            </p>
          </div>
        )}

        {/* ---- Signup Form (hidden until user clicks) ---- */}
        {showForm && !success && (
          <form onSubmit={handleSignUp} className="space-y-5 mt-6">
            <div className="p-3 bg-yellow-900/15 border border-yellow-500/30 rounded-lg">
              <p className="text-yellow-300 text-sm font-medium">
                Use the same Delivery Email you entered during checkout so your credits are linked to your account.
              </p>
            </div>

            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-300 mb-2">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your first or full name"
                required
                className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Delivery Email <span className="text-orange-400">(same as checkout)</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your-delivery-email@example.com"
                required
                className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-2">
                Choose a Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              />
            </div>

            {error && (
              <div className="p-4 bg-red-900/20 border border-red-500/50 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
            >
              {isLoading ? 'Creating account...' : 'Create My Account'}
            </button>
          </form>
        )}

        {/* ---- Footer ---- */}
        <div className="mt-8 text-center text-sm">
          <Link href="/" className="text-orange-500 hover:text-orange-400 transition">
            ← Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ThankYouPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <p className="text-gray-400">Loading...</p>
      </div>
    }>
      <ThankYouContent />
    </Suspense>
  );
}
