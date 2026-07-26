export type SlideType = 'title' | 'content' | 'comparison' | 'closing';

// Which kind of deck to build:
//  - 'designed'   → the classic AIDeck: text, bullets, icons, 20+ pro layouts
//  - 'full-image' → every slide is one full-bleed 16:9 AI image, script lives in the notes
export type DeckType = 'designed' | 'full-image';

// How much money each slide's picture is allowed to cost.
// 'none' skips image generation entirely (designed decks only — a full-image
// deck with no images would just be blank slides).
export type ImageQuality = 'none' | 'low' | 'medium' | 'high';

// Real gpt-image-1.5 per-image prices (verified July 2026).
// Designed decks render small 1024x1024 images; full-image decks use 1536x1024.
export const IMAGE_PRICES: Record<DeckType, Record<Exclude<ImageQuality, 'none'>, number>> = {
  designed: { low: 0.009, medium: 0.034, high: 0.133 },
  'full-image': { low: 0.013, medium: 0.05, high: 0.2 },
};

export function estimateImageCost(
  deckType: DeckType,
  slideCount: number,
  quality: ImageQuality
): number {
  if (quality === 'none') return 0;
  return IMAGE_PRICES[deckType][quality] * slideCount;
}

export interface SlidePoint {
  text: string;
  icon: string; // single emoji character (e.g. 🎯, 💡, 🚀)
}

export interface SlideData {
  type: SlideType;
  title: string;
  subtitle?: string;
  points?: SlidePoint[];
  speakerNotes: string;
  imagePrompt?: string;  // AI-generated description for DALL-E image generation
  imageData?: string;    // Base64-encoded image data (populated after DALL-E call)
}

export interface PresentationStructure {
  title: string;
  slides: SlideData[];
  visualStyle?: string; // shared art-direction line so every image in a full-image deck matches
}

export interface GenerateRequest {
  prompt: string;
  tone: string;
  slides: number;
  colorTheme: string;
  animations?: boolean;
  purpose?: string;
  deckType?: DeckType; // defaults to 'designed'
  secondsPerSlide?: number; // how long each slide stays on screen; drives note length
  imageQuality?: ImageQuality; // defaults to 'low' — never spend more without being asked
}

// A presenter speaks at roughly 138 words per minute, so seconds on screen
// converts straight into how many words the speaker notes should hold.
export const WORDS_PER_SECOND = 2.3;

export interface Pacing {
  seconds: number;
  words: number;
  minWords: number;
  maxWords: number;
  totalSeconds: number;
}

export function getPacing(secondsPerSlide: number, slideCount: number): Pacing {
  const seconds = Math.max(3, Math.min(600, Math.round(secondsPerSlide)));
  const words = Math.max(8, Math.round(seconds * WORDS_PER_SECOND));
  return {
    seconds,
    words,
    minWords: Math.max(5, Math.round(words * 0.8)),
    maxWords: Math.round(words * 1.2),
    totalSeconds: seconds * slideCount,
  };
}

export type ColorThemeName = 'navy-gold' | 'coral-energy' | 'forest-green' | 'charcoal-minimal';

export interface ColorTheme {
  primary: string;
  secondary: string;
  accent: string;
}
