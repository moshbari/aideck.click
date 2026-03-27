'use client';

import { useState } from 'react';

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
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [generatedFile, setGeneratedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

    setIsLoading(true);
    setError(null);
    const interval = startLoadingAnimation();

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          tone: TONE_OPTIONS[toneIndex].value,
          slides,
          colorTheme: COLOR_OPTIONS[colorIndex].value,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || 'Failed to generate deck');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      setGeneratedFile(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error generating deck. Please try again.');
      console.error(err);
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
      link.download = 'presentation.pptx';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white">
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

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-red-900/30 border border-red-700 rounded-xl text-red-300 text-sm">
            {error}
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
                setPrompt('');
                setLoadingMessageIndex(0);
                setError(null);
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
        <h2 className="text-4xl font-bold text-center mb-16">Simple Pricing</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {/* Free Tier */}
          <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800">
            <h3 className="text-2xl font-bold mb-2">Free</h3>
            <p className="text-gray-400 mb-6">Get started</p>
            <div className="mb-8">
              <span className="text-4xl font-bold">$0</span>
              <span className="text-gray-400 ml-2">/month</span>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="text-gray-300 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                2 decks/month
              </li>
              <li className="text-gray-500 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gray-700 mr-3 shrink-0"></span>
                Basic themes
              </li>
              <li className="text-gray-500 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gray-700 mr-3 shrink-0"></span>
                Limited customization
              </li>
            </ul>
            <button className="w-full py-2 px-4 rounded-lg border border-gray-700 text-white hover:bg-gray-800 transition-colors">
              Get Started
            </button>
          </div>

          {/* Pro Tier */}
          <div className="relative bg-gradient-to-br from-orange-500/20 to-pink-500/20 rounded-2xl p-8 border border-orange-500/30 transform scale-105">
            <div className="absolute top-0 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
              <span className="bg-gradient-to-r from-orange-500 to-pink-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                Most Popular
              </span>
            </div>
            <h3 className="text-2xl font-bold mb-2 mt-6">Pro</h3>
            <p className="text-gray-300 mb-6">For creators</p>
            <div className="mb-8">
              <span className="text-4xl font-bold">$9</span>
              <span className="text-gray-300 ml-2">/month</span>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="text-gray-200 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                Unlimited decks
              </li>
              <li className="text-gray-200 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                All themes
              </li>
              <li className="text-gray-200 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                Full customization
              </li>
            </ul>
            <button className="w-full py-2 px-4 rounded-lg bg-gradient-to-r from-orange-500 to-pink-500 text-white font-semibold hover:shadow-lg transition-shadow">
              Start Free Trial
            </button>
          </div>

          {/* Team Tier */}
          <div className="bg-gray-900 rounded-2xl p-8 border border-gray-800">
            <h3 className="text-2xl font-bold mb-2">Team</h3>
            <p className="text-gray-400 mb-6">For organizations</p>
            <div className="mb-8">
              <span className="text-4xl font-bold">$29</span>
              <span className="text-gray-400 ml-2">/month</span>
            </div>
            <ul className="space-y-3 mb-8">
              <li className="text-gray-300 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                Everything in Pro
              </li>
              <li className="text-gray-300 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                Team collaboration
              </li>
              <li className="text-gray-300 flex items-center">
                <span className="w-5 h-5 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 mr-3 shrink-0"></span>
                Brand customization
              </li>
            </ul>
            <button className="w-full py-2 px-4 rounded-lg border border-gray-700 text-white hover:bg-gray-800 transition-colors">
              Contact Sales
            </button>
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
