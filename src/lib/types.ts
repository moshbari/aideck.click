export type SlideType = 'title' | 'content' | 'comparison' | 'closing';

export interface SlideData {
  type: SlideType;
  title: string;
  subtitle?: string;
  points?: string[];
  speakerNotes: string;
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
}

export type ColorThemeName = 'navy-gold' | 'coral-energy' | 'forest-green' | 'charcoal-minimal';

export interface ColorTheme {
  primary: string;
  secondary: string;
  accent: string;
}
