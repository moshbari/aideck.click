export type SlideType = 'title' | 'content' | 'comparison' | 'closing';

// Which kind of deck to build:
//  - 'designed'   → the classic AIDeck: text, bullets, icons, 20+ pro layouts
//  - 'full-image' → every slide is one full-bleed 16:9 AI image, script lives in the notes
export type DeckType = 'designed' | 'full-image';

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
}

export type ColorThemeName = 'navy-gold' | 'coral-energy' | 'forest-green' | 'charcoal-minimal';

export interface ColorTheme {
  primary: string;
  secondary: string;
  accent: string;
}
