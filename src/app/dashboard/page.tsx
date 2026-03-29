'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AideckProfile, AideckGeneration, AideckSavedPresentation } from '@/lib/supabase/types';

export default function DashboardPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<AideckProfile | null>(null);
  const [generations, setGenerations] = useState<AideckGeneration[]>([]);
  const [savedPresentations, setSavedPresentations] = useState<AideckSavedPresentation[]>([]);
  const [loadingPresentations, setLoadingPresentations] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [showPresentations, setShowPresentations] = useState(false);
  const [showGenerations, setShowGenerations] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [showPasswordSection, setShowPasswordSection] = useState(false);

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

  // Fetch saved presentations from R2
  useEffect(() => {
    const fetchPresentations = async () => {
      setLoadingPresentations(true);
      try {
        const res = await fetch('/api/presentations');
        if (res.ok) {
          const data = await res.json();
          const now = new Date();
          const valid = (data.presentations || []).filter(
            (p: AideckSavedPresentation) => new Date(p.expires_at) > now
          );
          setSavedPresentations(valid);
        }
      } catch (err) {
        console.error('Error fetching saved presentations:', err);
      } finally {
        setLoadingPresentations(false);
      }
    };

    fetchPresentations();
  }, []);

  const handleDownloadPresentation = async (id: string, filename: string) => {
    setDownloadingId(id);
    try {
      const res = await fetch(`/api/presentations?action=download&id=${id}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        if (res.status === 410) {
          // Expired — remove from local list
          setSavedPresentations((prev) => prev.filter((p) => p.id !== id));
          alert('This presentation has expired and been deleted.');
          return;
        }
        throw new Error(data?.error || 'Download failed');
      }

      const data = await res.json();
      // Open the signed download URL
      const link = document.createElement('a');
      link.href = data.url;
      link.download = data.filename || filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Download error:', err);
      alert('Failed to download. The file may have expired.');
    } finally {
      setDownloadingId(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const daysUntilExpiry = (expiresAt: string): number => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diffMs = expires.getTime() - now.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  const handleChangePassword = async () => {
    setPasswordMsg(null);

    if (!newPassword || !confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'Please fill in both fields.' });
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'Password must be at least 6 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'Passwords do not match.' });
      return;
    }

    setPasswordLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setPasswordMsg({ type: 'error', text: updateError.message });
      } else {
        setPasswordMsg({ type: 'success', text: 'Password updated successfully!' });
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => setShowPasswordSection(false), 2000);
      }
    } catch {
      setPasswordMsg({ type: 'error', text: 'An unexpected error occurred.' });
    } finally {
      setPasswordLoading(false);
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

        {/* Change Password Section */}
        <div className="mb-8 rounded-lg bg-gray-900 border border-gray-800">
          <button
            onClick={() => {
              setShowPasswordSection(!showPasswordSection);
              setPasswordMsg(null);
              setNewPassword('');
              setConfirmPassword('');
            }}
            className="w-full p-6 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span className="text-white font-medium">Change Password</span>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showPasswordSection ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showPasswordSection && (
            <div className="px-6 pb-6 border-t border-gray-800 pt-4">
              <div className="max-w-md space-y-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">New Password</label>
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="w-full px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
                  />
                </div>

                {passwordMsg && (
                  <p className={`text-sm ${passwordMsg.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
                    {passwordMsg.text}
                  </p>
                )}

                <button
                  onClick={handleChangePassword}
                  disabled={passwordLoading}
                  className="px-6 py-2.5 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {passwordLoading ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* My Saved Presentations (Cloud Storage) — Collapsible */}
        <div className="mb-8 rounded-lg bg-gray-900 border border-gray-800">
          <button
            onClick={() => setShowPresentations(!showPresentations)}
            className="w-full p-6 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
              <div>
                <span className="text-white font-semibold text-xl flex items-center gap-2">
                  My Presentations
                  {!loadingPresentations && savedPresentations.length > 0 && (
                    <span className="text-xs font-medium bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                      {savedPresentations.length}
                    </span>
                  )}
                </span>
                <p className="text-sm text-gray-500 mt-0.5">
                  Saved in the cloud for 25 days. Download them anytime!
                </p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showPresentations ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showPresentations && (
            <>
              {loadingPresentations ? (
                <div className="px-6 pb-6">
                  <div className="p-8 text-center border-t border-gray-800">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-orange-500 mx-auto mb-3"></div>
                    <p className="text-gray-400 text-sm">Loading your presentations...</p>
                  </div>
                </div>
              ) : savedPresentations.length === 0 ? (
                <div className="px-6 pb-6 border-t border-gray-800 pt-6">
                  <div className="text-center">
                    <div className="inline-block p-4 bg-gray-800 rounded-full mb-4">
                      <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                      </svg>
                    </div>
                    <h3 className="text-lg font-medium text-white mb-2">No saved presentations yet</h3>
                    <p className="text-gray-400 mb-6">
                      When you generate a new presentation, it will be automatically saved here for 25 days.
                    </p>
                    <Link
                      href="/"
                      className="inline-block px-6 py-3 text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 rounded-lg font-medium transition"
                    >
                      Create a Presentation
                    </Link>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-gray-800 border-t border-gray-800">
                  {savedPresentations.map((pres) => {
                    const days = daysUntilExpiry(pres.expires_at);
                    const isExpiringSoon = days <= 3;

                    return (
                      <div key={pres.id} className="p-5 hover:bg-gray-800/50 transition">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-white font-medium truncate">{pres.title}</h3>
                            {pres.description && (
                              <p className="text-sm text-gray-400 mt-1 line-clamp-2">{pres.description}</p>
                            )}
                            <div className="flex flex-wrap items-center gap-3 mt-2">
                              <span className="text-xs text-gray-500">
                                {formatDate(pres.created_at)}
                              </span>
                              {pres.slide_count && (
                                <span className="text-xs text-gray-500">
                                  {pres.slide_count} slides
                                </span>
                              )}
                              <span className="text-xs text-gray-500">
                                {formatFileSize(pres.file_size)}
                              </span>
                              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                isExpiringSoon
                                  ? 'bg-red-500/20 text-red-400'
                                  : 'bg-orange-500/20 text-orange-400'
                              }`}>
                                {days === 0 ? 'Expires today' : `${days} day${days !== 1 ? 's' : ''} left`}
                              </span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDownloadPresentation(pres.id, pres.filename); }}
                            disabled={downloadingId === pres.id}
                            className="shrink-0 px-4 py-2 text-sm font-medium text-white bg-gradient-to-r from-orange-500 to-pink-500 hover:from-orange-600 hover:to-pink-600 rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {downloadingId === pres.id ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-white"></div>
                                <span>Loading...</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                </svg>
                                <span>Download</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        {/* Recent Generations — Collapsible */}
        <div className="rounded-lg bg-gray-900 border border-gray-800">
          <button
            onClick={() => setShowGenerations(!showGenerations)}
            className="w-full p-6 flex items-center justify-between text-left"
          >
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-orange-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <div>
                <span className="text-white font-semibold text-xl flex items-center gap-2">
                  Recent Generations
                  {generations.length > 0 && (
                    <span className="text-xs font-medium bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full">
                      {generations.length}
                    </span>
                  )}
                </span>
                <p className="text-sm text-gray-500 mt-0.5">
                  Your recent AI-generated presentation history.
                </p>
              </div>
            </div>
            <svg
              className={`w-5 h-5 text-gray-400 transition-transform ${showGenerations ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showGenerations && (
            <>
              {generations.length === 0 ? (
                <div className="px-6 pb-6 border-t border-gray-800 pt-6">
                  <div className="text-center">
                    <div className="inline-block p-4 bg-gray-800 rounded-full mb-4">
                      <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m0 0h6m0-6v6" />
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
                </div>
              ) : (
                <div className="overflow-x-auto border-t border-gray-800">
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
            </>
          )}
        </div>
      </main>
    </div>
  );
}
