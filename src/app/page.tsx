'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { AideckProfile } from '@/lib/supabase/types';

// ─── Voice Dictation Hook ───
function useVoiceDictation(onTranscription: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopRecording = useCallback(() => {
    // Clear silence timer
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    // Stop animation frame
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    // Stop the media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    // Stop all tracks on the stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up audio analysis for silence detection
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      // Set up MediaRecorder
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        // Clean up audio context
        audioContext.close();

        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

        // Only transcribe if we have actual audio data (> 1KB to skip empty recordings)
        if (audioBlob.size < 1000) {
          return;
        }

        setIsTranscribing(true);
        try {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'recording.webm');

          const res = await fetch('/api/transcribe', {
            method: 'POST',
            body: formData,
          });

          if (!res.ok) {
            const data = await res.json().catch(() => null);
            throw new Error(data?.error || 'Transcription failed');
          }

          const data = await res.json();
          if (data.text && data.text.trim()) {
            onTranscription(data.text.trim());
          }
        } catch (err) {
          console.error('Transcription error:', err);
        } finally {
          setIsTranscribing(false);
        }
      };

      // Start recording
      mediaRecorder.start(250); // collect data every 250ms
      setIsRecording(true);

      // ─── Silence Detection (10 seconds of silence = auto-stop) ───
      const SILENCE_THRESHOLD = 15; // amplitude threshold (0-255 scale)
      const SILENCE_DURATION = 10000; // 10 seconds in ms
      let lastSoundTime = Date.now();

      const checkSilence = () => {
        if (!analyserRef.current) return;

        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteTimeDomainData(dataArray);

        // Check if there's sound above the threshold
        let maxAmplitude = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const amplitude = Math.abs(dataArray[i] - 128);
          if (amplitude > maxAmplitude) maxAmplitude = amplitude;
        }

        if (maxAmplitude > SILENCE_THRESHOLD) {
          lastSoundTime = Date.now();
        }

        // If silence for 10 seconds, stop recording
        if (Date.now() - lastSoundTime > SILENCE_DURATION) {
          stopRecording();
          return;
        }

        animFrameRef.current = requestAnimationFrame(checkSilence);
      };

      animFrameRef.current = requestAnimationFrame(checkSilence);
    } catch (err) {
      console.error('Microphone access error:', err);
      setIsRecording(false);
    }
  }, [onTranscription, stopRecording]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return { isRecording, isTranscribing, toggleRecording };
}

const DECK_TYPE_OPTIONS = [
  {
    value: 'designed' as const,
    icon: '🎨',
    label: 'Designed Text Slides',
    tagline: 'Headlines, bullet points, icons and 20+ pro layouts, with an AI image on every slide. Optional click animations.',
  },
  {
    value: 'full-image' as const,
    icon: '🖼️',
    label: 'Full-Slide Image Deck',
    tagline: 'Every slide is one full-screen 16:9 AI image — no text on screen at all. Your whole script sits in the presenter notes.',
  },
];

const TONE_OPTIONS = [
  { label: 'Professional', value: 'professional' },
  { label: 'Casual', value: 'casual' },
  { label: 'Fun & Colorful', value: 'creative' },
  { label: 'Corporate', value: 'professional' },
] as const;

const SLIDE_OPTIONS = [5, 8, 10, 15, 20, 30, 40, 60] as const;

// How long a slide stays on screen. This drives how many words go into the
// presenter notes — a 6-second slide can't carry a 150-word script.
const PACE_OPTIONS = [
  { seconds: 6, label: '6 sec', note: 'Rapid-fire' },
  { seconds: 10, label: '10 sec', note: 'Fast' },
  { seconds: 20, label: '20 sec', note: 'Brisk' },
  { seconds: 30, label: '30 sec', note: 'Standard' },
  { seconds: 60, label: '60 sec', note: 'Detailed' },
  { seconds: 120, label: '2 min', note: 'Deep dive' },
] as const;

const WORDS_PER_SECOND = 2.3; // ~138 words a minute, a natural speaking pace

// Real gpt-image-1.5 per-image prices (verified July 2026). Designed decks use
// small 1024x1024 images; full-slide image decks use 1536x1024.
const IMAGE_PRICES = {
  designed: { low: 0.009, medium: 0.034, high: 0.133 },
  'full-image': { low: 0.013, medium: 0.05, high: 0.2 },
} as const;

const IMAGE_QUALITY_OPTIONS = [
  { value: 'none' as const, label: 'No images', note: 'Text only, free' },
  { value: 'low' as const, label: 'Low', note: 'Cheapest' },
  { value: 'medium' as const, label: 'Medium', note: 'Sharper' },
  { value: 'high' as const, label: 'High', note: 'Best, priciest' },
];

function formatCost(dollars: number): string {
  if (dollars === 0) return 'free';
  if (dollars < 0.01) return '<1¢';
  if (dollars < 1) return `${Math.round(dollars * 100)}¢`;
  return `$${dollars.toFixed(2)}`;
}

function formatRuntime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  if (mins === 0) return `${secs} sec`;
  if (secs === 0) return `${mins} min`;
  return `${mins} min ${secs} sec`;
}

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

const ImageDeckLoadingMessages = [
  'Planning your story...',
  'Writing your script...',
  'Painting slide images...',
  'This one takes a little longer...',
  'Almost done...',
];

export default function Home() {
  const [prompt, setPrompt] = useState('');
  const [deckTypeIndex, setDeckTypeIndex] = useState(0);
  const [toneIndex, setToneIndex] = useState(0);
  const [slides, setSlides] = useState(10);
  const [secondsPerSlide, setSecondsPerSlide] = useState(30);
  const [imageQuality, setImageQuality] = useState<'none' | 'low' | 'medium' | 'high'>('low');
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

  // Voice dictation: append transcribed text as a new paragraph
  const handleTranscription = useCallback((text: string) => {
    setPrompt((prev) => {
      if (!prev.trim()) return text;
      return prev.trimEnd() + '\n\n' + text;
    });
  }, []);

  const { isRecording, isTranscribing, toggleRecording } = useVoiceDictation(handleTranscription);

  const deckType = DECK_TYPE_OPTIONS[deckTypeIndex].value;
  const isImageDeck = deckType === 'full-image';
  const activeLoadingMessages = isImageDeck ? ImageDeckLoadingMessages : LoadingMessages;

  // What the pacing choice actually means, shown live under the picker
  const wordsPerSlide = Math.max(8, Math.round(secondsPerSlide * WORDS_PER_SECOND));
  const totalRuntime = formatRuntime(secondsPerSlide * slides);

  // A full-slide image deck can't have "no images" — it would be blank slides
  const availableQualities = isImageDeck
    ? IMAGE_QUALITY_OPTIONS.filter((q) => q.value !== 'none')
    : IMAGE_QUALITY_OPTIONS;
  const effectiveQuality = isImageDeck && imageQuality === 'none' ? 'low' : imageQuality;
  const costFor = (q: 'none' | 'low' | 'medium' | 'high') =>
    q === 'none' ? 0 : IMAGE_PRICES[deckType][q] * slides;
  const imageCost = costFor(effectiveQuality);

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
      index = (index + 1) % activeLoadingMessages.length;
      setLoadingMessageIndex(index);
    }, 2000);
    return interval;
  };

  const generateDeck = async () => {
    if (!prompt.trim()) {
      setError('Please describe your presentation');
      return;
    }

    // Must be logged in to generate
    if (!user || !profile) {
      setError('Please sign up or log in to generate your free deck!');
      return;
    }

    // Credit/free deck check
    const hasFreeDeck = profile.lifetime_free_decks_used < profile.lifetime_free_decks_limit;
    const hasCredits = profile.credits > 0;
    if (!hasFreeDeck && !hasCredits) {
      setError(profile.plan === 'free'
        ? "You've used your 2 free decks. Visit your dashboard to buy credits and upgrade!"
        : "You're out of credits. Visit your dashboard to buy more!");
      return;
    }
    if (profile.status === 'inactive') {
      setError('Your account has been deactivated. Please contact support.');
      return;
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
          secondsPerSlide,
          imageQuality: effectiveQuality,
          colorTheme: COLOR_OPTIONS[colorIndex].value,
          animations: isImageDeck ? false : animations,
          deckType,
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
          animations: isImageDeck ? false : animations,
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
      <div className="relative overflow-hidden px-4 pt-20 pb-8 sm:pt-32 sm:pb-12">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-5xl sm:text-6xl md:text-7xl font-bold tracking-tight mb-6 leading-tight">
            <span className="bg-gradient-to-r from-orange-400 via-orange-500 to-pink-500 bg-clip-text text-transparent">
              Speak. Click. Present.
            </span>
          </h1>
          <p className="text-lg sm:text-xl text-gray-300 mb-6 leading-relaxed max-w-2xl mx-auto">
            Dictate your idea or type it out. AI writes every slide, picks from
            20+ pro layouts, generates unique images, and adds click animations
            with presenter cues. Or pick the full-slide image deck — pure 16:9
            visuals with your whole script in the notes. Download and present.
          </p>
          <p className="text-sm sm:text-base font-semibold text-orange-400 mb-12">
            Try it free — your first 2 decks are on us. No credit card needed.
          </p>

          {/* Demo Video */}
          <div className="mx-auto max-w-3xl">
            <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
              <iframe
                src="https://www.tella.tv/video/create-presentation-slides-with-ai-in-seconds-9lb9/embed?b=0&title=0&a=1&loop=0&autoPlay=false&t=0&muted=0&wt=0"
                allowFullScreen
                allow="autoplay; encrypted-media; fullscreen"
                className="absolute inset-0 w-full h-full rounded-2xl"
                style={{ border: 'none' }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Generator Section */}
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Presentation Type — pick this first, it changes what you get */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-300 mb-3">
            Presentation Type
          </label>
          <div className="grid sm:grid-cols-2 gap-3">
            {DECK_TYPE_OPTIONS.map((option, i) => (
              <button
                key={option.value}
                onClick={() => setDeckTypeIndex(i)}
                className={`text-left p-5 rounded-2xl border transition-all ${
                  deckTypeIndex === i
                    ? 'bg-gradient-to-br from-orange-500/20 to-pink-500/20 border-orange-500/60 shadow-lg'
                    : 'bg-gray-900 border-gray-800 hover:border-gray-700'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{option.icon}</span>
                  <span className={`font-bold ${deckTypeIndex === i ? 'text-white' : 'text-gray-200'}`}>
                    {option.label}
                  </span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{option.tagline}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Textarea with Mic Button */}
        <div className="mb-8 relative">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe your presentation... or click the mic to dictate with your voice!"
            className="w-full h-32 bg-gray-900 border border-gray-800 rounded-2xl px-6 py-4 pr-16 text-white placeholder-gray-500 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 resize-none"
          />
          {/* Mic Button */}
          <button
            type="button"
            onClick={toggleRecording}
            disabled={isTranscribing}
            title={isRecording ? 'Stop recording (auto-stops after 10s silence)' : isTranscribing ? 'Transcribing...' : 'Click to dictate with your voice'}
            className={`absolute right-3 top-3 w-10 h-10 rounded-full flex items-center justify-center transition-all ${
              isRecording
                ? 'bg-red-500 hover:bg-red-600 animate-pulse shadow-lg shadow-red-500/40'
                : isTranscribing
                  ? 'bg-orange-500/50 cursor-not-allowed'
                  : 'bg-gray-800 hover:bg-gray-700 border border-gray-700 hover:border-orange-500'
            }`}
          >
            {isTranscribing ? (
              <svg className="w-5 h-5 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : isRecording ? (
              <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3V4.5a3 3 0 116 0v8.25a3 3 0 01-3 3z" />
              </svg>
            )}
          </button>
          {/* Recording indicator text */}
          {isRecording && (
            <div className="absolute right-16 top-4 flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-xs text-red-400 font-medium">Recording...</span>
            </div>
          )}
          {isTranscribing && (
            <div className="absolute right-16 top-4 flex items-center gap-2">
              <span className="text-xs text-orange-400 font-medium">Transcribing...</span>
            </div>
          )}
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

        {/* Options Row 2b: Time on screen per slide — this sets the script length */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-300 mb-1">
            Time on Screen per Slide
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Sets how long each slide is up — and how many words go into its presenter notes.
          </p>
          <div className="flex flex-wrap gap-3">
            {PACE_OPTIONS.map((option) => (
              <button
                key={option.seconds}
                onClick={() => setSecondsPerSlide(option.seconds)}
                className={`px-5 py-2.5 rounded-full font-medium transition-all ${
                  secondsPerSlide === option.seconds
                    ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-lg'
                    : 'bg-gray-900 text-gray-300 border border-gray-800 hover:border-gray-700'
                }`}
              >
                {option.label}
                <span className={`ml-2 text-xs ${secondsPerSlide === option.seconds ? 'text-white/80' : 'text-gray-500'}`}>
                  {option.note}
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 p-3 rounded-xl bg-gray-900 border border-gray-800 text-xs text-gray-400 leading-relaxed">
            <span className="text-orange-400 font-semibold">~{wordsPerSlide} words</span> of script per slide
            {' · '}
            <span className="text-orange-400 font-semibold">{slides} slides</span>
            {' · '}
            total runtime <span className="text-orange-400 font-semibold">{totalRuntime}</span>
            {secondsPerSlide <= 10 && (
              <span className="block mt-1 text-gray-500">
                Rapid-fire pacing keeps one idea per slide — you&apos;ll want plenty of slides to cover a topic.
              </span>
            )}
            {isImageDeck && slides >= 30 && (
              <span className="block mt-1 text-gray-500">
                {slides} AI images take a few minutes to paint. Keep this tab open.
              </span>
            )}
          </div>
        </div>

        {/* Options Row 2c: Image quality — the only thing here that costs money */}
        <div className="mb-8">
          <label className="block text-sm font-semibold text-gray-300 mb-1">
            Image Quality
          </label>
          <p className="text-xs text-gray-500 mb-3">
            {isImageDeck
              ? 'Every slide is one big AI image, so this is what the deck costs to make.'
              : 'Each slide gets a small AI illustration. Turn images off for a free, text-only deck.'}
          </p>
          <div className="flex flex-wrap gap-3">
            {availableQualities.map((option) => (
              <button
                key={option.value}
                onClick={() => setImageQuality(option.value)}
                className={`px-5 py-2.5 rounded-full font-medium transition-all ${
                  effectiveQuality === option.value
                    ? 'bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-lg'
                    : 'bg-gray-900 text-gray-300 border border-gray-800 hover:border-gray-700'
                }`}
              >
                {option.label}
                <span className={`ml-2 text-xs ${effectiveQuality === option.value ? 'text-white/80' : 'text-gray-500'}`}>
                  {formatCost(costFor(option.value))}
                </span>
              </button>
            ))}
          </div>
          <div className={`mt-3 p-3 rounded-xl border text-xs leading-relaxed ${
            imageCost >= 1
              ? 'bg-orange-900/20 border-orange-700/50 text-orange-200'
              : 'bg-gray-900 border-gray-800 text-gray-400'
          }`}>
            {imageCost === 0 ? (
              <>No images will be generated — this deck costs <span className="font-semibold">nothing</span> to make.</>
            ) : (
              <>
                This deck will generate <span className="text-orange-400 font-semibold">{slides} images</span>
                {' at '}
                <span className="text-orange-400 font-semibold">{effectiveQuality}</span> quality
                {' ≈ '}
                <span className="text-orange-400 font-semibold">{formatCost(imageCost)}</span> in image costs.
              </>
            )}
            {imageCost >= 1 && (
              <span className="block mt-1 font-semibold">
                That&apos;s a big one — drop to Low or use fewer slides if you don&apos;t need the detail.
              </span>
            )}
          </div>
        </div>

        {/* Options Row 3: Color Theme */}
        <div className="mb-10">
          <label className="block text-sm font-semibold text-gray-300 mb-1">
            Color Theme
          </label>
          <p className="text-xs text-gray-500 mb-3">
            {isImageDeck
              ? 'Sets the color palette your slide images are painted in.'
              : 'Sets the colors used across your slide designs.'}
          </p>
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

        {/* Options Row 5: Click Animations — designed decks only.
            A full-slide image has nothing to animate, so we explain what you get instead. */}
        {isImageDeck ? (
          <div className="mb-10 p-4 bg-gray-900 border border-gray-800 rounded-xl">
            <span className="text-sm font-semibold text-gray-300">🖼️ Full-Slide Image Deck</span>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              Each slide is a single full-screen 16:9 image with no text on it. Your complete
              word-for-word script goes into the presenter notes, so you talk while the picture
              does the showing. No click animations needed.
              <span className="text-orange-400 ml-1">Takes a bit longer to build.</span>
            </p>
          </div>
        ) : (
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
        )}

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-orange-900/20 border border-orange-700/50 rounded-xl text-orange-200 text-sm flex items-start gap-3">
            <span className="text-xl mt-0.5">💡</span>
            <span>{error}</span>
          </div>
        )}

        {/* Generate Button or Download Button */}
        {!generatedFile ? (
          user ? (
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
                  <span>{activeLoadingMessages[loadingMessageIndex]}</span>
                </div>
              ) : (
                'Generate Deck'
              )}
            </button>
          ) : (
            <a
              href="/signup"
              className="block w-full py-4 px-6 rounded-xl font-bold text-lg text-center transition-all transform hover:scale-105 bg-gradient-to-r from-orange-500 via-orange-400 to-pink-500 text-white shadow-xl hover:shadow-2xl animate-gradient"
            >
              Sign Up Free to Generate
            </a>
          )
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
            <h3 className="text-xl font-semibold mb-2">Speak or Type</h3>
            <p className="text-gray-400">
              Describe your topic in the text box — or just click the mic and
              talk. No keyboard needed.
            </p>
          </div>
          <div className="bg-gray-900 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
              2
            </div>
            <h3 className="text-xl font-semibold mb-2">AI Designs Everything</h3>
            <p className="text-gray-400">
              20+ pro layouts, AI-generated images, click animations, and
              speaker notes — all built automatically.
            </p>
          </div>
          <div className="bg-gray-900 rounded-2xl p-8 text-center">
            <div className="w-12 h-12 bg-gradient-to-r from-orange-500 to-pink-500 rounded-full flex items-center justify-center text-white font-bold text-xl mx-auto mb-4">
              3
            </div>
            <h3 className="text-xl font-semibold mb-2">Download & Present</h3>
            <p className="text-gray-400">
              Get a polished .pptx file ready for PowerPoint, Keynote, or
              Google Slides. Present with confidence.
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
