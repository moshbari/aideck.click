export type SlideType = 'title' | 'content' | 'comparison' | 'closing';

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
}

export interface GenerateRequest {
  prompt: string;
  tone: string;
  slides: number;
  colorTheme: string;
  animations?: boolean;
  purpose?: string;
}

export type ColorThemeName = 'navy-gold' | 'coral-energy' | 'forest-green' | 'charcoal-minimal';

export interface ColorTheme {
  primary: string;
  secondary: string;
  accent: string;
}
