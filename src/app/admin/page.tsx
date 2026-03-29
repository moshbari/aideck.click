'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { AideckProfile } from '@/lib/supabase/types';
import { useTheme, ThemeName } from '@/lib/theme-provider';

const THEME_OPTIONS: { id: ThemeName; label: string; description: string; previewBg: string; previewBorder: string }[] = [
  {
    id: 'dark',
    label: 'Dark Mode (Default)',
    description: 'Dark background, orange-pink gradients, glow effects. Current production theme.',
    previewBg: '#030712',
    previewBorder: '#f97316',
  },
  {
    id: 'deckai',
    label: 'DeckAI Light',
    description: 'Clean white background, blue primary, burnt-orange accent. Professional & editorial.',
    previewBg: '#ffffff',
    previewBorder: '#003ec7',
  },
  {
    id: 'velvet',
    label: 'Velvet Rose',
    description: 'Warm light background with rich rose-red accents. Elegant & premium feel.',
    previewBg: '#fff5f5',
    previewBorder: '#be123c',
  },
  {
    id: 'kinetic',
    label: 'Kinetic Emerald',
    description: 'Light background with vibrant emerald-green accents. Fresh & energetic.',
    previewBg: '#f0fdf4',
    previewBorder: '#059669',
  },
  {
    id: 'indigo',
    label: 'Indigo Night',
    description: 'Light background with deep indigo-purple accents. Sophisticated & bold.',
    previewBg: '#eef2ff',
    previewBorder: '#7c3aed',
  },
  {
    id: 'monolith',
    label: 'Monolith',
    description: 'Ultra-dark background with white metallic accents. Minimal & cinematic.',
    previewBg: '#131315',
    previewBorder: '#ffffff',
  },
];

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();
  const { theme: currentTheme, setTheme } = useTheme();

  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [users, setUsers] = useState<AideckProfile[]>([]);
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalGenerations: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeMessage, setThemeMessage] = useState<string | null>(null);

  useEffect(() => {
    checkAuthAndLoadData();
  }, []);

  const checkAuthAndLoadData = async () => {
    try {
      setIsLoading(true);

      const { data: { user }, error: authError } = await supabase.auth.getUser();

      if (authError || !user) {
        router.push('/login');
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from('aideck_profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (profileError || !profile || profile.role !== 'admin') {
        router.push('/dashboard');
        return;
      }

      setIsAuthorized(true);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setIsLoading(false);
    }
  };

  const loadData = async () => {
    try {
      const { data: usersData, error: usersError } = await supabase
        .from('aideck_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (usersError) throw usersError;

      setUsers(usersData || []);

      const { count: totalCount } = await supabase
        .from('aideck_profiles')
        .select('*', { count: 'exact', head: true });

      const { count: activeCount } = await supabase
        .from('aideck_profiles')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');

      const { count: generationsCount } = await supabase
        .from('aideck_generations')
        .select('*', { count: 'exact', head: true });

      setStats({
        totalUsers: totalCount || 0,
        activeUsers: activeCount || 0,
        totalGenerations: generationsCount || 0,
      });

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setIsLoading(false);
    }
  };

  const handleThemeChange = async (newTheme: ThemeName) => {
    setThemeSaving(true);
    setThemeMessage(null);

    try {
      const res = await fetch('/api/admin/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme: newTheme }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to save theme');
      }

      // Update the live theme immediately
      setTheme(newTheme);
      const label = THEME_OPTIONS.find((o) => o.id === newTheme)?.label || newTheme;
      setThemeMessage(`Theme switched to "${label}" — all visitors will see this now.`);
    } catch (err) {
      setThemeMessage(
        err instanceof Error
          ? err.message
          : 'Failed to save theme. Make sure the aideck_site_settings table exists in Supabase.'
      );
    } finally {
      setThemeSaving(false);
    }
  };

  const handleToggleStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    setActionLoading(userId);

    try {
      const { error } = await supabase
        .from('aideck_profiles')
        .update({ status: newStatus })
        .eq('id', userId);

      if (error) throw error;

      setUsers(users.map(u => u.id === userId ? { ...u, status: newStatus as 'active' | 'inactive' } : u));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setActionLoading(null);
    }
  };

  const handleAddCredits = async (userId: string, userName: string) => {
    const amountStr = prompt(`Add credits to ${userName}:`);
    if (!amountStr) return;

    const amount = parseInt(amountStr, 10);
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid amount');
      return;
    }

    setActionLoading(userId);

    try {
      const user = users.find(u => u.id === userId);
      if (!user) throw new Error('User not found');

      const newCredits = user.credits + amount;

      const { error: updateError } = await supabase
        .from('aideck_profiles')
        .update({ credits: newCredits })
        .eq('id', userId);

      if (updateError) throw updateError;

      const { error: txError } = await supabase
        .from('aideck_credit_transactions')
        .insert({
          user_id: userId,
          amount,
          type: 'admin_adjustment',
          description: 'Admin credit adjustment',
        });

      if (txError) throw txError;

      setUsers(users.map(u => u.id === userId ? { ...u, credits: newCredits } : u));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add credits');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleRole = async (userId: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'user' : 'admin';
    setActionLoading(userId);

    try {
      const { error } = await supabase
        .from('aideck_profiles')
        .update({ role: newRole })
        .eq('id', userId);

      if (error) throw error;

      setUsers(users.map(u => u.id === userId ? { ...u, role: newRole as 'user' | 'admin' } : u));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update role');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
      router.push('/login');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign out');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-orange-500 to-pink-500 bg-clip-text text-transparent">
                AIDeck Admin
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="px-4 py-2 text-gray-300 hover:text-white transition"
              >
                &larr; Back to Dashboard
              </Link>
              <button
                onClick={handleSignOut}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-500/50 rounded-lg">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="text-gray-400 text-sm font-medium mb-2">Total Users</div>
            <div className="text-4xl font-bold">{stats.totalUsers}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="text-gray-400 text-sm font-medium mb-2">Active Users</div>
            <div className="text-4xl font-bold">{stats.activeUsers}</div>
          </div>
          <div className="bg-gray-900 border border-gray-800 rounded-lg p-6">
            <div className="text-gray-400 text-sm font-medium mb-2">Total Generations</div>
            <div className="text-4xl font-bold">{stats.totalGenerations}</div>
          </div>
        </div>

        {/* ═══ THEME SWITCHER ═══ */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-2">Site Theme (A/B Testing)</h2>
          <p className="text-gray-400 text-sm mb-6">
            Switch the theme for ALL visitors. Changes take effect immediately — great for split testing different looks.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                onClick={() => handleThemeChange(opt.id)}
                disabled={themeSaving}
                className={`relative p-5 rounded-xl border-2 text-left transition-all ${
                  currentTheme === opt.id
                    ? 'border-blue-500 ring-2 ring-blue-500/30'
                    : 'border-gray-700 hover:border-gray-600'
                } ${themeSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
              >
                {/* Active badge */}
                {currentTheme === opt.id && (
                  <span className="absolute top-3 right-3 text-xs font-bold bg-blue-500 text-white px-2 py-0.5 rounded-full">
                    ACTIVE
                  </span>
                )}

                {/* Preview strip */}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-lg border-2 flex items-center justify-center"
                    style={{ backgroundColor: opt.previewBg, borderColor: opt.previewBorder }}
                  >
                    {currentTheme === opt.id && (
                      <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  <div className="font-semibold text-lg">{opt.label}</div>
                </div>
                <p className="text-gray-400 text-sm">{opt.description}</p>
              </button>
            ))}
          </div>

          {/* Theme save feedback */}
          {themeMessage && (
            <div
              className={`p-3 rounded-lg text-sm ${
                themeMessage.includes('Failed') || themeMessage.includes('error')
                  ? 'bg-red-900/20 border border-red-500/50 text-red-400'
                  : 'bg-green-900/20 border border-green-500/50 text-green-400'
              }`}
            >
              {themeMessage}
            </div>
          )}

          {themeSaving && (
            <div className="text-sm text-gray-400 mt-2">Saving theme...</div>
          )}
        </div>

        {/* Add User Section */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">Add New User</h2>
          <div className="p-4 bg-gray-950 border border-gray-800 rounded-lg">
            <p className="text-gray-300 text-sm mb-2">
              To add users, they should sign up at <span className="text-orange-500 font-medium">aideck.click/signup</span>.
            </p>
            <p className="text-gray-400 text-sm">
              You can then manage their role and add credits using the table below.
            </p>
          </div>
        </div>

        {/* Users Table */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
          <div className="p-6 border-b border-gray-800">
            <h2 className="text-xl font-bold">Users</h2>
          </div>

          {users.length === 0 ? (
            <div className="p-6 text-center text-gray-400">
              No users found
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-950 border-b border-gray-800">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Name</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Email</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Role</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Credits</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Plan</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Decks Used</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Joined</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-400 uppercase">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-gray-950 transition">
                      <td className="px-6 py-4 text-sm">
                        {user.full_name || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-300">
                        {user.email}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                            user.status === 'active'
                              ? 'bg-green-500/20 text-green-400'
                              : 'bg-red-500/20 text-red-400'
                          }`}
                        >
                          {user.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className="text-gray-300">
                          {user.role}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {user.credits}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-medium ${
                            user.plan === 'pro'
                              ? 'bg-gradient-to-r from-orange-500/20 to-pink-500/20 text-orange-400'
                              : 'bg-gray-700/50 text-gray-300'
                          }`}
                        >
                          {user.plan}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {user.lifetime_free_decks_used} / {user.lifetime_free_decks_limit}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-400">
                        {new Date(user.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleToggleStatus(user.id, user.status)}
                            disabled={actionLoading === user.id}
                            className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionLoading === user.id ? '...' : `${user.status === 'active' ? 'Deactivate' : 'Activate'}`}
                          </button>
                          <button
                            onClick={() => handleAddCredits(user.id, user.full_name || user.email)}
                            disabled={actionLoading === user.id}
                            className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionLoading === user.id ? '...' : 'Add Credits'}
                          </button>
                          <button
                            onClick={() => handleToggleRole(user.id, user.role)}
                            disabled={actionLoading === user.id}
                            className="px-2 py-1 text-xs bg-gray-800 hover:bg-gray-700 text-white rounded transition disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {actionLoading === user.id ? '...' : `Make ${user.role === 'admin' ? 'User' : 'Admin'}`}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
