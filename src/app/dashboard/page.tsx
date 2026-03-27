'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AideckProfile, AideckGeneration } from '@/lib/supabase/types';

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<AideckProfile | null>(null);
  const [generations, setGenerations] = useState<AideckGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get current user
        const { data: userData, error: userError } = await supabase.auth.getUser();
        if (userError || !userData.user) {
          router.push('/login');
          return;
        }

        setUser({
          id: userData.user.id,
          email: userData.user.email || 'No email',
        });

        // Fetch user profile
        const { data: profileData, error: profileError } = await supabase
          .from('aideck_profiles')
          .select('*')
          .eq('id', userData.user.id)
          .single();

        if (profileError) {
          console.error('Profile fetch error:', profileError);
          setError('Failed to load profile');
        } else {
          setProfile(profileData as AideckProfile);
        }

        // Fetch recent generations
        const { data: generationsData, error: generationsError } = await supabase
          .from('aideck_generations')
          .select('*')
          .eq('user_id', userData.user.id)
          .order('created_at', { ascending: false })
          .limit(10);

        if (generationsError) {
          console.error('Generations fetch error:', generationsError);
          setError('Failed to load generations');
        } else {
          setGenerations((generationsData as AideckGeneration[]) || []);
        }
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('An unexpected error occurred');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [supabase, router]);

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleBuyCredits = () => {
    alert('Buy Credits feature coming soon! In the future, you will be able to purchase additional credits here.');
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const truncatePrompt = (prompt: string, length: number = 50) => {
    return prompt.length > length ? prompt.substring(0, length) + '...' : prompt;
  };

  const progressPercent = profile
    ? (profile.lifetime_free_decks_used / profile.lifetime_free_decks_limit) * 100
    : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-orange-500 mx-auto mb-4"></div>
          <p>Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header Bar */}
      <header className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              <h1 className="text-2xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
                AIDeck
              </h1>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm text-gray-400">
                  {profile?.full_name || 'User'}
                </p>
                <p className="text-xs text-gray-500">{user.email}</p>
              </div>

              <button
                onClick={handleSignOut}
                className="px-3 py-2 text-sm text-gray-400 hover:text-white transition rounded-lg hover:bg-gray-800"
              >
                Sign Out
              </button>

              <Link
                href="/"
                className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 rounded-lg transition"
              >
                Create Deck
              </Link>

              {profile?.role === 'admin' && (
                <Link
                  href="/admin"
                  className="px-3 py-2 text-sm font-medium text-orange-400 hover:text-orange-300 transition"
                >
                  Admin
                </Link>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400">
            {error}
          </div>
        )}

        {/* Credit Balance Card */}
        <div className="mb-8 p-6 rounded-lg bg-gray-900 border border-gray-800">
          <div className="flex justify-between items-start mb-6">
            <div>
              <p className="text-gray-400 text-sm mb-2">Credits Available</p>
              <p className="text-5xl font-bold text-white">
                {profile?.credits || 0}
              </p>
            </div>
            <button
              onClick={handleBuyCredits}
              className="px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 rounded-lg transition"
            >
              Buy Credits
            </button>
          </div>

          {profile?.plan === 'free' && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm text-gray-300">
                  {profile.lifetime_free_decks_used} of {profile.lifetime_free_decks_limit} free decks used
                </p>
                <span className="text-xs text-gray-500">
                  {Math.round(progressPercent)}%
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-2">
                <div
                  className="bg-gradient-to-r from-orange-500 to-pink-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(progressPercent, 100)}%` }}
                ></div>
              </div>
            </div>
          )}

          {profile?.plan === 'pro' && (
            <p className="text-sm text-green-400">
              ✓ Pro Plan - Unlimited Decks
            </p>
          )}
        </div>

        {/* Recent Generations */}
        <div className="rounded-lg bg-gray-900 border border-gray-800">
          <div className="p-6 border-b border-gray-800">
            <h2 className="text-xl font-semibold text-white">Recent Generations</h2>
          </div>

          {generations.length === 0 ? (
            <div className="p-12 text-center">
              <div className="inline-block p-4 bg-gray-800 rounded-full mb-4">
                <svg
                  className="w-8 h-8 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6v6m0 0v6m0-6h6m0 0h6m0-6v6"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-white mb-2">
                No presentations yet
              </h3>
              <p className="text-gray-400 mb-6">
                Create your first AI-generated presentation deck to get started!
              </p>
              <Link
                href="/"
                className="inline-block px-6 py-3 text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 rounded-lg font-medium transition"
              >
                Create Your First Deck
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-gray-800 bg-gray-800/50">
                  <tr>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Date
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Prompt
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Slides
                    </th>
                    <th className="px-6 py-4 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                      Credits Used
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {generations.map((generation) => (
                    <tr
                      key={generation.id}
                      className="hover:bg-gray-800/50 transition"
                    >
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-300">
                          {formatDate(generation.created_at)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-gray-300">
                          {truncatePrompt(generation.prompt)}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="text-sm text-gray-300">
                          {generation.slide_count || '-'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400">
                          {generation.credits_used}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
