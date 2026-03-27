'use client';

import { useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

/**
 * Thank You / Welcome Page — shown after WarriorPlus purchase
 *
 * WarriorPlus redirects buyers here after checkout (set as the Delivery URL).
 * The page:
 *   1. Welcomes the customer and confirms their purchase
 *   2. Tells them we sent a password-setup email
 *   3. Provides a signup form so they can create their account
 *      using the SAME email they used for the W+ purchase
 */
export default function ThankYouPage() {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setIsLoading(true);

    try {
      const supabase = createClient();

      // First try to sign up — if account was auto-created by IPN,
      // this will fail, so we catch and guide the user to check email
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
        },
      });

      if (signUpError) {
        // If user already exists (auto-created by IPN), guide them
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
          <h1 className="text-4xl font-bold mb-2">Thank You for Your Purchase!</h1>
          <p className="text-gray-400 text-lg">
            Your AI Deck credits have been applied. Let&apos;s get you into your account.
          </p>
        </div>

        {/* ---- Email Notification Card ---- */}
        <div className="mb-8 p-5 bg-gray-900/60 border border-orange-500/30 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="flex-shrink-0 mt-0.5">
              <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <div>
              <h2 className="font-semibold text-white text-lg mb-1">Check Your Email</h2>
              <p className="text-gray-300 text-sm leading-relaxed">
                We&apos;ve sent you an email with a link to <span className="text-orange-400 font-medium">set up your password</span> and access your account.
                Check your inbox (and spam folder) for an email from AI Deck.
              </p>
            </div>
          </div>
        </div>

        {/* ---- Divider ---- */}
        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-800"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-3 bg-black text-gray-500">Or create your account right now</span>
          </div>
        </div>

        {/* ---- Important Note ---- */}
        <div className="mb-5 p-4 bg-yellow-900/15 border border-yellow-500/30 rounded-lg">
          <p className="text-yellow-300 text-sm font-medium">
            Important: Use the same email you used for your purchase so your credits are linked to your account.
          </p>
        </div>

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

        {/* ---- Signup Form ---- */}
        {!success && (
          <form onSubmit={handleSignUp} className="space-y-5">
            {/* Full Name */}
            <div>
              <label htmlFor="fullName" className="block text-sm font-medium text-gray-300 mb-2">
                Full Name
              </label>
              <input
                id="fullName"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="John Doe"
                required
                className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
                Email Address <span className="text-orange-400">(same as your purchase)</span>
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your-purchase-email@example.com"
                required
                className="w-full px-4 py-3 bg-gray-900 border border-gray-800 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-transparent transition"
              />
            </div>

            {/* Password */}
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

            {/* Error */}
            {error && (
              <div className="p-4 bg-red-900/20 border border-red-500/50 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-semibold rounded-lg hover:from-orange-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition duration-200"
            >
              {isLoading ? 'Creating account...' : 'Create My Account'}
            </button>
          </form>
        )}

        {/* ---- Already have an account ---- */}
        <div className="relative my-8">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-800"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-black text-gray-500">Already have an account?</span>
          </div>
        </div>

        <Link
          href="/login"
          className="block w-full py-3 px-4 bg-gray-900 border border-gray-800 text-white font-semibold rounded-lg hover:bg-gray-800 transition duration-200 text-center"
        >
          Sign In to Your Account
        </Link>

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
