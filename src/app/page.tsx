'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AideckProfile } from '@/lib/supabase/types';

const TONE_OPTIONS = [
  { label: 'Professional', value: 'professional' },
  { label: 'Casual', value: 'casual' },
  { label: 'Fun & Colorful', value: 'creative' },
  { label: 'Corporate', value: 'professional' },
] as const;

const SLIDE_OPTIONS = [5, 8, 10, 15] as const;

const COLOR_OPTIONS = [
  { label: 'Navy & Gold', value: 'navy-gold' },
  { label: 'Coral Energy', value: 'coral-energy' },
  { label: 'Forest Green', value: 'forest-green' },
  { label: 'Charcoal Minimal', value: 'charcoal-minimal' },
] as const;

const PURPOSE_OPTIONS = [
  { label: 'Sales Pitch', value: 'sales-pitch' },
  { label: 'Authority & Trust', value: 'authority-trust' },
  { label: 'Training', value: 'training' },
  { label: 'Internal Update', value: 'internal-update' },
  { label: 'Conference Talk', value: 'conference-talk' },
] as const;

const LoadingMessages = [
  'Planning your slides...',
  'Writing content...',
  'Designing layouts...',
  'Adding animations...',
  'Almost done...',
];

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [toneIndex, setToneIndex] = useState(0);
  const [slides, setSlides] = useState(10);
  const [colorIndex, setColorIndex] = useState(0);
  const [purposeIndex, setPurposeIndex] = useState<number | null>(null);
  const [animations, setAnimations] = useState(true); // ON by default
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [generatedFile, setGeneratedFile] = useState<string | null>(null);
  const [generatedFilename, setGeneratedFilename] = useState<string>('presentation.pptx');
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<AideckProfile | null>(null);

  // Auth check + restore last prompt from localStorage
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (u) {
        setUser({ id: u.id, email: u.email || '' });
        supabase
          .from('aideck_profiles')
          .select('*')
          .eq('id', u.id)
          .single()
          .then(({ data }) => {
            if (data) setProfile(data as AideckProfile);
          });
      }
    });

    // Restore last prompt from localStorage
    try {
      const saved = localStorage.getItem('aideck_last_prompt');
      if (saved) setPrompt(saved);
      const savedFile = localStorage.getItem('aideck_last_file');
      if (savedFile) setGeneratedFile(savedFile);
    } catch {}
  }, []);

  const startLoadingAnimation = () => {
    let index = 0;
    const interval = setInterval(() => {
      index = (index + 1) % LoadingMessages.length;
      setLoadingMessageIndex(index);
    }, 2000);
    return interval;
  };

  const generateDeck = async () => {
    if (!prompt.trim()) {
      setError('Please describe your presentation');
      return;
    }

    // Credit/free deck check
    if (profile) {
      const hasFreeDeck = profile.lifetime_free_decks_used < profile.lifetime_free_decks_limit;
      const hasCredits = profile.credits > 0;
      if (!hasFreeDeck && !hasCredits) {
        setError(profile.plan === 'free'
          ? "You've used your 2 free decks. Sign in to your dashboard to buy credits and upgrade!"
          : "You're out of credits. Visit your dashboard to buy more!");
        return;
      }
      if (profile.status === 'inactive') {
        setError('Your account has been deactivated. Please contact support.');
        return;
      }
    }

    setIsLoading(true);
    setError(null);
    const interval = startLoadingAnimation();

    try {
      // Save prompt to localStorage
      try { localStorage.setItem('aideck_last_prompt', prompt); } catch {}

      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          tone: TONE_OPTIONS[toneIndex].value,
          slides,
          colorTheme: COLOR_OPTIONS[colorIndex].value,
          animations,
          ...(purposeIndex !== null && { purpose: PURPOSE_OPTIONS[purposeIndex].value }),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to generate deck');
      }

      // Get the smart filename from response headers
      const filename = res.headers.get('X-Presentation-Filename')
        ? decodeURIComponent(res.headers.get('X-Presentation-Filename')!)
        : 'presentation.pptx';

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      setGeneratedFile(url);
      setGeneratedFilename(filename);

      // Save file URL to localStorage
      try { localStorage.setItem('aideck_last_file', url); } catch {}

      // Track generation in Supabase if logged in
      if (user && profile) {
        const supabase = createClient();
        const { data: gen } = await supabase.from('aideck_generations').insert({
          user_id: user.id,
          prompt,
          tone: TONE_OPTIONS[toneIndex].value,
          purpose: purposeIndex !== null ? PURPOSE_OPTIONS[purposeIndex].value : null,
          slide_count: slides,
          color_theme: COLOR_OPTIONS[colorIndex].value,
          animations,
          credits_used: (profile.plan === 'free' && profile.lifetime_free_decks_used < profile.lifetime_free_decks_limit) ? 0 : 1,
        }).select().single();

        const useFreeDeck = profile.plan === 'free'
          && profile.lifetime_free_decks_used < profile.lifetime_free_decks_limit;

        if (useFreeDeck) {
          // Use a free deck slot
          const newUsed = profile.lifetime_free_decks_used + 1;
          await supabase.from('aideck_profiles').update({ lifetime_free_decks_used: newUsed }).eq('id', user.id);
          setProfile({ ...profile, lifetime_free_decks_used: newUsed });
        } else {
          // Deduct a paid credit (works for both free-plan users with credits AND pro users)
          const newCredits = profile.credits - 1;
          await supabase.from('aideck_profiles').update({ credits: newCredits }).eq('id', user.id);
          await supabase.from('aideck_credit_transactions').insert({
            user_id: user.id,
            amount: -1,
            type: 'usage',
            description: 'Deck generation',
            generation_id: gen?.id || null,
          });
          setProfile({ ...profile, credits: newCredits });
        }
      }
    } catch (err) {
      console.error(err);
      // Show friendly error messages instead of raw technical details
      const rawMsg = err instanceof Error ? err.message : '';
      let friendlyMsg = "Something didn't go as planned — but no worries! Please try again in a moment.";
      if (rawMsg.includes('truncat') || rawMsg.includes('fewer slides')) {
        friendlyMsg = "That was a lot of content! Try selecting fewer slides or turning off animations, then try again.";
      } else if (rawMsg.includes('parse') || rawMsg.includes('JSON')) {
        friendlyMsg = "Our AI got a little creative with its response. Please try again — it usually works on the next attempt!";
      } else if (rawMsg.includes('timeout') || rawMsg.includes('504') || rawMsg.includes('529')) {
        friendlyMsg = "Things are a bit busy right now. Give it a moment and try again — your presentation will be worth the wait!";
      } else if (rawMsg.includes('rate') || rawMsg.includes('429')) {
        friendlyMsg = "We're getting a lot of requests right now. Please wait a minute and try again.";
      } else if (rawMsg.includes('401') || rawMsg.includes('auth')) {
        friendlyMsg = "There's a configuration issue on our end. We're working on it — please try again shortly.";
      }
      setError(friendlyMsg);
    } finally {
      clearInterval(interval);
      setIsLoading(false);
      setLoadingMessageIndex(0);
    }
  };

  const downloadFile = () => {
    if (generatedFile) {
      const link = document.createElement('a');
      link.href = generatedFile;
      link.download = generatedFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* WarriorPlus Tracking Pixels */}
      <img src="https://warriorplus.com/o2/btn/pn100011001/m2qnrz/ymcjxw/461001" height="1" width="1" style={{ visibility: 'hidden', position: 'absolute' }} alt="" />
      <img src="https://warriorplus.com/o2/btn/pn100011001/m2qnrz/ymcjxw/461002" height="1" width="1" style={{ visibility: 'hidden', position: 'absolute' }} alt="" />
      <img src="https://warriorplus.com/o2/btn/pn100011001/m2qnrz/ymcjxw/461003" height="1" width="1" style={{ visibility: 'hidden', position: 'absolute' }} alt="" />
      <img src="https://warriorplus.com/o2/btn/pn100011001/m2qnrz/ymcjxw/461000" height="1" width="1" style={{ visibility: 'hidden', position: 'absolute' }} alt="" />

      {/* Top Navigation */}
      <nav className="flex items-center justify-between px-6 py-4 border-b border-gray-900">
        <span className="text-xl font-bold bg-gradient-to-r from-orange-400 to-pink-500 bg-clip-text text-transparent">
          AIDeck
        </span>
        <div className="flex items-center gap-4">
          {user ? (
            <>
              {profile && (
                <span className="text-sm text-gray-400">
                  {profile.credits > 0
                    ? `${profile.credits} credits`
                    : profile.plan === 'free'
                      ? `${Math.max(0, profile.lifetime_free_decks_limit - profile.lifetime_free_decks_used)} free decks left`
                      : '0 credits'}
                </span>
              )}
              <a
                href="/dashboard"
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                Dashboard
              </a>
              <button
                onClick={async () => {
                  const supabase = createClient();
                  await supabase.auth.signOut();
                  setUser(null);
                  setProfile(null);
                }}
                className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
              >
                Sign Out
              </button>
            </>
          ) : (
            <>
              <a
                href="/login"
                className="text-sm text-gray-300 hover:text-white transition-colors"
              >
                Sign In
              </a>
              <a
                href="/signup"
                className="text-sm px-4 py-1.5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 text-white font-medium hover:shadow-lg transition-shadow"
              >
                Sign Up Free
              </a>
            </>
          )}
        </div>
      </nav>

      {/* Hero Section */}
      <div className="relative overflow-hidden px-4 py-20 sm:py-32">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-6 leading-tight">
            AI Presentations in{' '}
            <span className="bg-gradient-to-r from-orange-400 via-orange-500 to-pink-500 bg-clip-text text-transparent">
              One Click
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-gray-300 mb-12 leading-relaxed max-w-2xl mx-auto">
            Type what you want. Get a polished deck with animations and speaker
            notes. Done.
          </p>
        </div>
      </div>

      {/* Generator Section */}
      <div className="mx-auto max-w-2xl px-4 py-16">
        {/* Textarea */}
        <div className="mb-8">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your presentation... e.g., Create a 10-slide pitch deck about our new product launch for investors"
            className="w-full h-32 bg-gray-900 border border-gray-800 rounded-2xl px-6 py-4 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 resize-none"
          />
        </div>

        {/* Options Row 1: Tone */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-300 mb-3">
            Tone
          </label>
          <div className="flex flex-wrap gap-3">
            {TONE_OPTIONS.map((option, i) => (
              <button
                key={option.label}
                onClick={() => setToneIndex(i)}
                className={`px-5 py-2.5 rounded-full font-medium transition-all ${
                  toneIndex === i
                    ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-lg'
                    : 'bg-gray-900 text-gray-300 border border-gray-800 hover:border-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Options Row 2: Slides */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-300 mb-3">
            Number of Slides
          </label>
          <div className="flex flex-wrap gap-3">
            {SLIDE_OPTIONS.map((option) => (
              <button
                key={option}
                onClick={() => setSlides(option)}
                className={`px-5 py-2.5 rounded-full font-medium transition-all ${
                  slides === option
                    ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-lg'
                    : 'bg-gray-900 text-gray-300 border border-gray-800 hover:border-gray-700'
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {/* Options Row 3: Color Theme */}
        <div className="mb-10">
          <label className="block text-sm font-semibold text-gray-300 mb-3">
            Color Theme
          </label>
          <div className="flex flex-wrap gap-3">
            {COLOR_OPTIONS.map((option, i) => (
              <button
                key={option.label}
                onClick={() => setColorIndex(i)}
                className={`px-5 py-2.5 rounded-full font-medium transition-all ${
                  colorIndex === i
                    ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-lg'
                    : 'bg-gray-900 text-gray-300 border border-gray-800 hover:border-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Options Row 4: Purpose (optional) */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-300 mb-1">
            Purpose
            <span className="text-gray-500 font-normal ml-2">optional</span>
          </label>
          <p className="text-xs text-gray-500 mb-3">Helps tailor structure and language to your use case.</p>
          <div className="flex flex-wrap gap-3">
            {PURPOSE_OPTIONS.map((option, i) => (
              <button
                key={option.label}
                onClick={() => setPurposeIndex(purposeIndex === i ? null : i)}
                className={`px-5 py-2.5 rounded-full font-medium transition-all ${
                  purposeIndex === i
                    ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-lg'
                    : 'bg-gray-900 text-gray-300 border border-gray-800 hover:border-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Options Row 5: Click Animations */}
        <div className="mb-10">
          <label className="flex items-start gap-3 cursor-pointer group">
            <div className="relative mt-0.5">
              <input
                type="checkbox"
                checked={animations}
                onChange={(e) => setAnimations(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-gray-800 border border-gray-700 rounded-full peer-checked:bg-gradient-to-r peer-checked:from-orange-500 peer-checked:to-pink-500 transition-all"></div>
              <div className="absolute left-0.5 top-0.5 w-5 h-5 bg-gray-400 rounded-full peer-checked:translate-x-5 peer-checked:bg-white transition-all"></div>
            </div>
            <div>
              <span className="text-sm font-semibold text-gray-300 group-hover:text-white transition-colors">
                Click Animations & Presenter Cues
              </span>
              <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                Elements appear one-by-one on each click. Presenter notes include [CLICK] cues matching each animation.
                <span className="text-orange-400 ml-1">Uses more API credits.</span>
              </p>
            </div>
          </label>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-orange-900/20 border border-orange-700/50 rounded-xl text-orange-200 text-sm flex items-start gap-3">
            <span className="text-xl mt-0.5">💡</span>
            <span>{error}</span>
          </div>
        )}

        {/* Generate Button or Download Button */}
        {!generatedFile ? (
          <button
            onClick={generateDeck}
            disabled={isLoading}
            className="w-full py-4 px-6 rounded-xl font-bold text-lg transition-all transform hover:scale-105 disabled:opacity-75 disabled:cursor-not-allowed bg-gradient-to-r from-orange-500 via-orange-400 to-pink-500 text-white shadow-xl hover:shadow-2xl animate-gradient"
          >
            {isLoading ? (
              <div className="flex items-center justify-center gap-2">
                <div className="flex gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-white animate-bounce-dot"></span>
                  <span className="inline-block w-2 h-2 rounded-full bg-white animate-bounce-dot delay-100"></span>
                  <span className="inline-block w-2 h-2 rounded-full bg-white animate-bounce-dot delay-200"></span>
                </div>
                <span>{LoadingMessages[loadingMessageIndex]}</span>
              </div>
            ) : (
              'Generate Deck'
            )}
          </button>
        ) : (
          <div className="flex gap-3">
            <button
              onClick={downloadFile}
              className="flex-1 py-4 px-6 rounded-xl font-bold text-lg bg-gradient-to-r from-orange-500 via-orange-400 to-pink-500 text-white shadow-xl hover:shadow-2xl transition-all transform hover:scale-105"
            >
              Download Deck
            </button>
            <button
              onClick={() => {
                setGeneratedFile(null);
                setGeneratedFilename('presentation.pptx');
                setPrompt('');
                setLoadingMessageIndex(0);
                setError(null);
                setAnimations(true);
                setPurposeIndex(null);
                try {
                  localStorage.removeItem('aideck_last_prompt');
                  localStorage.removeItem('aideck_last_file');
                } catch {}
              }}
              className="flex-1 py-4 px-6 rounded-xl font-bold text-lg bg-gray-900 border border-gray-800 text-white hover:border-gray-700 transition-all"
            >
              Create Another
            </button>
          </div>
        )}
      </div>

      {/* How It Works Section */}
      <div className="mx-auto max-w-4xl px-4 py-20">
        <h2 className="text-4xl font-bold text-center mb-16">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          <div className="bg-gray-900 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
              1
            </div>
            <h3 className="text-xl font-semibold mb-2">Describe</h3>
            <p className="text-gray-400">
              Tell us about your presentation topic and what you want to
              communicate.
            </p>
          </div>
          <div className="bg-gray-900 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
              2
            </div>
            <h3 className="text-xl font-semibold mb-2">Generate</h3>
            <p className="text-gray-400">
              Our AI creates a fully designed deck with animations and speaker
              notes.
            </p>
          </div>
          <div className="bg-gray-900 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
              3
            </div>
            <h3 className="text-xl font-semibold mb-2">Present</h3>
            <p className="text-gray-400">
              Download your presentation and present with confidence.
            </p>
          </div>
        </div>
      </div>

      {/* Pricing Section */}
      <div className="mx-auto max-w-4xl px-4 py-20">
        <h2 className="text-4xl font-bold text-center mb-4">Simple Pricing</h2>
        <p className="text-center text-gray-400 mb-16">No monthly subscriptions. Buy once, use credits when you need them.</p>
        <div className="grid md:grid-cols-3 gap-8">
          {/* Free Tier */}
          <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800">
            <h3 className="text-2xl font-bold mb-2">Free</h3>
            <p className="text-gray-400 mb-6">Try it out</p>
            <div className="mb-8">
              <span className="text-4xl font-bold">$0</span>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="text-gray-300 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                2 lifetime decks
              </li>
              <li className="text-gray-300 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                All themes &amp; layouts
              </li>
              <li className="text-gray-300 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                Click animations
              </li>
            </ul>
            <a href="/signup" className="block w-full py-2 px-4 rounded-lg border border-gray-700 text-white hover:bg-gray-800 transition-colors text-center">
              Sign Up Free
            </a>
          </div>

          {/* Pro Access Tier */}
          <div className="relative bg-gradient-to-br from-orange-500/20 to-pink-500/20 rounded-2xl p-8 border border-orange-500/30 transform scale-105">
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
              <span className="bg-gradient-to-r from-orange-500 to-pink-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                Best Value
              </span>
            </div>
            <h3 className="text-2xl font-bold mb-2 mt-6">Pro Access</h3>
            <p className="text-gray-300 mb-6">One-time purchase</p>
            <div className="mb-8">
              <span className="text-4xl font-bold">$29</span>
              <span className="text-gray-300 ml-2">once</span>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="text-gray-200 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                15 credits included
              </li>
              <li className="text-gray-200 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                All features unlocked
              </li>
              <li className="text-gray-200 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                No subscription ever
              </li>
            </ul>
            <a href="https://warriorplus.com/o2/buy/m2qnrz/ymcjxw/fjh1d4" target="_blank" rel="noopener noreferrer" className="block w-full py-2 px-4 rounded-lg bg-gradient-to-r from-orange-500 to-pink-500 text-white font-semibold hover:shadow-lg transition-shadow text-center">
              Get Pro Access
            </a>
          </div>

          {/* Credit Packs */}
          <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800">
            <h3 className="text-2xl font-bold mb-2">Credit Packs</h3>
            <p className="text-gray-400 mb-3">Pick your pack. Click to buy.</p>
            <p className="text-xs text-gray-500 mb-6">1 credit = 1 presentation. The bigger the pack, the more you save.</p>

            <div className="space-y-3">
              {/* 50 Credits — Base */}
              <a href="https://warriorplus.com/o2/buy/m2qnrz/ymcjxw/v2z309" target="_blank" rel="noopener noreferrer" className="block p-4 rounded-xl border border-gray-700 hover:border-orange-500/50 bg-gray-800/40 hover:bg-gray-800 transition-all group">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-white font-bold text-lg">50 Credits</span>
                    <p className="text-gray-500 text-xs mt-0.5">$0.20 per credit</p>
                  </div>
                  <span className="text-white font-bold text-xl group-hover:text-orange-400 transition-colors">$10</span>
                </div>
              </a>

              {/* 100 Credits — Save 15% */}
              <a href="https://warriorplus.com/o2/buy/m2qnrz/ymcjxw/kbm5vk" target="_blank" rel="noopener noreferrer" className="block p-4 rounded-xl border border-gray-700 hover:border-orange-500/50 bg-gray-800/40 hover:bg-gray-800 transition-all group">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold text-lg">100 Credits</span>
                      <span className="text-[10px] font-bold bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded-full uppercase tracking-wide">Save 15%</span>
                    </div>
                    <p className="text-gray-500 text-xs mt-0.5"><span className="line-through">$20</span> <span className="text-green-400 font-medium">You save $3</span></p>
                  </div>
                  <span className="text-white font-bold text-xl group-hover:text-orange-400 transition-colors">$17</span>
                </div>
              </a>

              {/* 250 Credits — Best Deal, Save 30% */}
              <a href="https://warriorplus.com/o2/buy/m2qnrz/ymcjxw/j2l652" target="_blank" rel="noopener noreferrer" className="relative block p-4 rounded-xl border-2 border-orange-500/60 bg-gradient-to-r from-orange-500/10 to-pink-500/10 hover:from-orange-500/20 hover:to-pink-500/20 transition-all group overflow-hidden">
                <div className="absolute top-0 right-0 bg-gradient-to-r from-orange-500 to-pink-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-lg uppercase tracking-wider">Best Deal</div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-white font-bold text-lg">250 Credits</span>
                      <span className="text-[10px] font-bold bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full uppercase tracking-wide">Save 30%</span>
                    </div>
                    <p className="text-gray-400 text-xs mt-0.5"><span className="line-through">$50</span> <span className="text-green-400 font-semibold">You save $15!</span></p>
                  </div>
                  <span className="text-white font-bold text-2xl group-hover:text-orange-400 transition-colors">$35</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-gray-900 py-8 px-4">
        <div className="mx-auto max-w-4xl text-center text-gray-500">
          <p>
            Built with care by AIDeck &bull; &copy; {new Date().getFullYear()} AIDeck.
            All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
