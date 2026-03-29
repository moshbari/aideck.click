import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { PresentationStructure, SlideData, SlidePoint, ColorTheme, ColorThemeName } from './types';

// Helper to extract text from a point (supports both old string[] and new SlidePoint[] format)
function getPointText(point: SlidePoint | string): string {
  return typeof point === 'string' ? point : point.text;
}
function getPointIcon(point: SlidePoint | string): string {
  return typeof point === 'string' ? '▪' : (point.icon || '▪');
}

// Track animation metadata per slide
// Key: slide index, Value: { cardCount, staticCount, shapesPerCard }
const slideAnimationMeta: Map<number, { cardCount: number; staticCount: number; shapesPerCard: number }> = new Map();

const COLOR_THEMES: Record<ColorThemeName, ColorTheme> = {
  'navy-gold': {
    primary: '2F3C7E',
    secondary: 'F9E795',
    accent: 'F96167',
  },
  'coral-energy': {
    primary: 'F96167',
    secondary: 'F9E795',
    accent: '2F3C7E',
  },
  'forest-green': {
    primary: '2C5F2D',
    secondary: '97BC62',
    accent: 'F5F5F5',
  },
  'charcoal-minimal': {
    primary: '36454F',
    secondary: 'F2F2F2',
    accent: '212121',
  },
};

// Extended palettes for visual variety — 5 accent colors per theme
function getAccentPalette(theme: ColorTheme): string[] {
  return [
    theme.primary,
    theme.accent,
    blendColor(theme.primary, theme.accent, 0.5),
    blendColor(theme.primary, 'FFFFFF', 0.3),
    blendColor(theme.accent, theme.primary, 0.4),
  ];
}

// Simple hex color blending
function blendColor(hex1: string, hex2: string, ratio: number): string {
  const r1 = parseInt(hex1.substring(0, 2), 16);
  const g1 = parseInt(hex1.substring(2, 4), 16);
  const b1 = parseInt(hex1.substring(4, 6), 16);
  const r2 = parseInt(hex2.substring(0, 2), 16);
  const g2 = parseInt(hex2.substring(2, 4), 16);
  const b2 = parseInt(hex2.substring(4, 6), 16);
  const r = Math.round(r1 + (r2 - r1) * ratio);
  const g = Math.round(g1 + (g2 - g1) * ratio);
  const b = Math.round(b1 + (b2 - b1) * ratio);
  return [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Lighten a hex color
function lightenColor(hex: string, amount: number): string {
  return blendColor(hex, 'FFFFFF', amount);
}

// Darken a hex color
function darkenColor(hex: string, amount: number): string {
  return blendColor(hex, '000000', amount);
}

const SLIDE_WIDTH = 10;
const SLIDE_HEIGHT = 5.625;
const MARGIN = 0.5;

// Helper: add AI-generated image to a slide
// Returns 1 if image was added (for static shape counting), 0 otherwise
function addSlideImage(
  slide: any, // PptxGenJS slide object
  imageData: string | undefined,
  position: 'right-hero' | 'bottom-right' | 'bottom-left' | 'center-bg' | 'right-strip',
  opacity?: number
): number {
  if (!imageData) return 0;
  try {
    const imgSrc = `image/png;base64,${imageData}`;
    switch (position) {
      case 'right-hero':
        // Large image on right side (title/closing slides)
        slide.addImage({
          data: imgSrc,
          x: SLIDE_WIDTH - 3.8,
          y: (SLIDE_HEIGHT - 3.5) / 2,
          w: 3.5,
          h: 3.5,
          rounding: true,
        });
        return 1;
      case 'bottom-right':
        // Small-medium decorative image, bottom-right corner
        slide.addImage({
          data: imgSrc,
          x: SLIDE_WIDTH - 2.6,
          y: SLIDE_HEIGHT - 2.4,
          w: 2.2,
          h: 2.2,
          rounding: true,
        });
        return 1;
      case 'bottom-left':
        // Small decorative image, bottom-left
        slide.addImage({
          data: imgSrc,
          x: 0.3,
          y: SLIDE_HEIGHT - 2.2,
          w: 2.0,
          h: 2.0,
          rounding: true,
        });
        return 1;
      case 'center-bg':
        // Large centered background image
        slide.addImage({
          data: imgSrc,
          x: (SLIDE_WIDTH - 4) / 2,
          y: (SLIDE_HEIGHT - 4) / 2,
          w: 4,
          h: 4,
        });
        return 1;
      case 'right-strip':
        // Narrow strip on the right for horizontal bar layouts
        slide.addImage({
          data: imgSrc,
          x: SLIDE_WIDTH - 2.3,
          y: 0.8,
          w: 2.0,
          h: 2.0,
          rounding: true,
        });
        return 1;
      default:
        return 0;
    }
  } catch (err) {
    console.error('Failed to add image to slide:', err);
    return 0;
  }
}

function getTheme(themeName: string): ColorTheme {
  const theme = COLOR_THEMES[themeName as ColorThemeName];
  return theme || COLOR_THEMES['navy-gold'];
}

function createShadow() {
  return {
    type: 'outer' as const,
    blur: 8,
    offset: 3,
    angle: 135,
    color: '000000',
    opacity: 0.12,
  };
}

// ─── Layout types for content slides ───
// Each layout uses a different visual structure.
// IMPORTANT: For animations, each layout must:
//   1. Add "static" shapes first (background elements, title, decorations)
//   2. Then add animated shapes in pairs: [bg shape, text shape] per card
//   3. Return the count of static shapes via slideAnimationMeta

type LayoutType = 'cards-grid' | 'horizontal-bars' | 'numbered-points' | 'accent-header' | 'dark-cards'
  | 'timeline' | 'split-screen' | 'icon-row' | 'quote-spotlight' | 'stacked-pills'
  | 'big-number' | 'vertical-divider' | 'floating-bubbles' | 'left-sidebar' | 'gradient-banner'
  | 'photo-focus' | 'zigzag' | 'metric-dashboard' | 'pyramid-stack' | 'checklist';

// Fisher-Yates shuffle for randomizing layouts
function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Pre-shuffled layout order — generated once per presentation so every deck is unique
let shuffledLayouts: LayoutType[] = [];

function initShuffledLayouts(): void {
  const allLayouts: LayoutType[] = [
    'cards-grid', 'horizontal-bars', 'numbered-points', 'accent-header', 'dark-cards',
    'timeline', 'split-screen', 'icon-row', 'quote-spotlight', 'stacked-pills',
    'big-number', 'vertical-divider', 'floating-bubbles', 'left-sidebar', 'gradient-banner',
    'photo-focus', 'zigzag', 'metric-dashboard', 'pyramid-stack', 'checklist',
  ];
  shuffledLayouts = shuffleArray(allLayouts);
}

function getLayoutForSlide(contentSlideIndex: number): LayoutType {
  if (shuffledLayouts.length === 0) initShuffledLayouts();
  return shuffledLayouts[contentSlideIndex % shuffledLayouts.length];
}

// ─── TITLE SLIDE ───
function addTitleSlideA(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: theme.primary };

  // Large decorative geometric shape — bottom right
  titleSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH - 3.5,
    y: SLIDE_HEIGHT - 2.5,
    w: 4,
    h: 3,
    fill: { color: lightenColor(theme.primary, 0.15), transparency: 40 },
    line: { type: 'none' },
    rotate: 15,
  });

  // Medium decorative rectangle — top right
  titleSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH - 2.2,
    y: -0.5,
    w: 2.5,
    h: 2,
    fill: { color: lightenColor(theme.primary, 0.1), transparency: 50 },
    line: { type: 'none' },
    rotate: -10,
  });

  // Small accent circle — top left
  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: 0.4,
    y: 0.4,
    w: 0.8,
    h: 0.8,
    fill: { color: theme.secondary, transparency: 30 },
    line: { type: 'none' },
  });

  // Second small circle — bottom left
  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: 0.8,
    y: SLIDE_HEIGHT - 1.5,
    w: 0.5,
    h: 0.5,
    fill: { color: theme.accent, transparency: 40 },
    line: { type: 'none' },
  });

  // Third decorative circle — mid-right
  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 1.8,
    y: 1.8,
    w: 0.6,
    h: 0.6,
    fill: { color: theme.secondary, transparency: 45 },
    line: { type: 'none' },
  });

  // Diagonal accent stripe — bottom left to center
  titleSlide.addShape(pres.ShapeType.rect, {
    x: -1,
    y: SLIDE_HEIGHT - 0.8,
    w: 5,
    h: 0.08,
    fill: { color: theme.secondary, transparency: 35 },
    line: { type: 'none' },
    rotate: -5,
  });

  // Accent bar under title area
  titleSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH / 2 - 1.5,
    y: 3.0,
    w: 3,
    h: 0.06,
    fill: { color: theme.secondary },
    line: { type: 'none' },
  });

  // AI-generated image — right side hero
  const hasImage = !!slide.imageData;
  if (hasImage) {
    addSlideImage(titleSlide, slide.imageData, 'right-hero');
  }

  // Title — shift left if image present
  titleSlide.addText(slide.title, {
    x: MARGIN + 0.5,
    y: 1.2,
    w: hasImage ? SLIDE_WIDTH - 4.8 : SLIDE_WIDTH - 2 * MARGIN - 1,
    h: 1.5,
    fontSize: hasImage ? 36 : 42,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: hasImage ? 'left' : 'center',
    valign: 'middle',
    wrap: true,
  });

  // Subtitle — shift left if image present
  if (slide.subtitle) {
    titleSlide.addText(slide.subtitle, {
      x: hasImage ? MARGIN + 0.5 : MARGIN + 1,
      y: 3.3,
      w: hasImage ? SLIDE_WIDTH - 5 : SLIDE_WIDTH - 2 * MARGIN - 2,
      h: 0.9,
      fontSize: 18,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: hasImage ? 'left' : 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  titleSlide.addNotes(slide.speakerNotes);
}

// ─── TITLE SLIDE B: Bold Left ───
function addTitleSlideB(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: theme.primary };

  // Accent diagonal stripe from bottom-left to mid-right
  titleSlide.addShape(pres.ShapeType.rect, {
    x: -1.5,
    y: SLIDE_HEIGHT - 1.2,
    w: 8,
    h: 0.12,
    fill: { color: theme.secondary, transparency: 25 },
    line: { type: 'none' },
    rotate: -8,
  });

  // Decorative circles in top-right corner
  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 1.5,
    y: 0.3,
    w: 0.7,
    h: 0.7,
    fill: { color: lightenColor(theme.primary, 0.2), transparency: 30 },
    line: { type: 'none' },
  });

  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 2.2,
    y: 0.6,
    w: 0.5,
    h: 0.5,
    fill: { color: theme.accent, transparency: 40 },
    line: { type: 'none' },
  });

  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 1.0,
    y: 1.1,
    w: 0.4,
    h: 0.4,
    fill: { color: theme.secondary, transparency: 35 },
    line: { type: 'none' },
  });

  // AI image on right side if available
  const hasImage = !!slide.imageData;
  if (hasImage) {
    addSlideImage(titleSlide, slide.imageData, 'right-hero');
  }

  // Title HUGE (48pt) on the left half, left-aligned
  titleSlide.addText(slide.title, {
    x: MARGIN,
    y: 0.8,
    w: hasImage ? SLIDE_WIDTH - 4.5 : SLIDE_WIDTH / 2 - MARGIN - 0.5,
    h: 2.2,
    fontSize: 48,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'left',
    valign: 'top',
    wrap: true,
  });

  // Subtitle below title on the left
  if (slide.subtitle) {
    titleSlide.addText(slide.subtitle, {
      x: MARGIN,
      y: 3.1,
      w: hasImage ? SLIDE_WIDTH - 4.5 : SLIDE_WIDTH / 2 - MARGIN - 0.5,
      h: 1.2,
      fontSize: 18,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'left',
      valign: 'top',
      wrap: true,
    });
  }

  titleSlide.addNotes(slide.speakerNotes);
}

// ─── TITLE SLIDE C: Center Spotlight ───
function addTitleSlideC(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: darkenColor(theme.primary, 0.5) };

  // Large subtle glowing circle in center with transparency
  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH / 2 - 2.5,
    y: SLIDE_HEIGHT / 2 - 1.8,
    w: 5,
    h: 3.6,
    fill: { color: lightenColor(theme.primary, 0.1), transparency: 85 },
    line: { type: 'none' },
  });

  // Small accent dots scattered decoratively
  const dotPositions = [
    { x: 0.8, y: 0.6 },
    { x: SLIDE_WIDTH - 1.2, y: 1.0 },
    { x: 1.5, y: SLIDE_HEIGHT - 1.0 },
    { x: SLIDE_WIDTH - 1.8, y: SLIDE_HEIGHT - 0.7 },
    { x: SLIDE_WIDTH / 2 - 0.5, y: 0.4 },
  ];

  dotPositions.forEach((pos) => {
    titleSlide.addShape(pres.ShapeType.ellipse, {
      x: pos.x,
      y: pos.y,
      w: 0.35,
      h: 0.35,
      fill: { color: theme.secondary, transparency: 50 },
      line: { type: 'none' },
    });
  });

  // AI image if available, small and positioned bottom-right
  const hasImage = !!slide.imageData;
  if (hasImage) {
    addSlideImage(titleSlide, slide.imageData, 'bottom-right');
  }

  // Title perfectly centered, large (44pt)
  titleSlide.addText(slide.title, {
    x: MARGIN,
    y: 1.2,
    w: SLIDE_WIDTH - 2 * MARGIN,
    h: 1.8,
    fontSize: 44,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    wrap: true,
  });

  // Subtitle centered below
  if (slide.subtitle) {
    titleSlide.addText(slide.subtitle, {
      x: MARGIN + 0.5,
      y: 3.2,
      w: SLIDE_WIDTH - 2 * MARGIN - 1,
      h: 1.2,
      fontSize: 16,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  titleSlide.addNotes(slide.speakerNotes);
}

// ─── TITLE SLIDE D: Split Diagonal ───
function addTitleSlideD(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const titleSlide = pres.addSlide();

  // Left half primary color
  titleSlide.addShape(pres.ShapeType.rect, {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH / 2,
    h: SLIDE_HEIGHT,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });

  // Right half darkened primary
  titleSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH / 2,
    y: 0,
    w: SLIDE_WIDTH / 2,
    h: SLIDE_HEIGHT,
    fill: { color: darkenColor(theme.primary, 0.25) },
    line: { type: 'none' },
  });

  // Thin diagonal accent line (approximate with a rotated thin rect)
  titleSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH / 2 - 0.08,
    y: -1,
    w: 0.16,
    h: SLIDE_HEIGHT + 2,
    fill: { color: theme.secondary },
    line: { type: 'none' },
    rotate: 15,
  });

  // Small geometric decorations
  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: 0.5,
    y: 0.4,
    w: 0.6,
    h: 0.6,
    fill: { color: theme.accent, transparency: 40 },
    line: { type: 'none' },
  });

  titleSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH - 1.2,
    y: SLIDE_HEIGHT - 1.0,
    w: 0.5,
    h: 0.5,
    fill: { color: lightenColor(theme.primary, 0.15), transparency: 50 },
    line: { type: 'none' },
    rotate: 25,
  });

  // AI image on right half if available
  const hasImage = !!slide.imageData;
  if (hasImage) {
    addSlideImage(titleSlide, slide.imageData, 'right-hero');
  }

  // Title crosses both halves, centered
  titleSlide.addText(slide.title, {
    x: MARGIN,
    y: 1.5,
    w: SLIDE_WIDTH - 2 * MARGIN,
    h: 1.6,
    fontSize: 40,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    wrap: true,
  });

  // Subtitle below
  if (slide.subtitle) {
    titleSlide.addText(slide.subtitle, {
      x: MARGIN,
      y: 3.3,
      w: SLIDE_WIDTH - 2 * MARGIN,
      h: 1.0,
      fontSize: 17,
      fontFace: 'Calibri',
      color: 'FFFFFF',
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  titleSlide.addNotes(slide.speakerNotes);
}

// ─── TITLE SLIDE WRAPPER ───
function addTitleSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const variants = [addTitleSlideA, addTitleSlideB, addTitleSlideC, addTitleSlideD];
  const pick = variants[Math.floor(Math.random() * variants.length)];
  pick(pres, slide, theme);
}

// ─── LAYOUT A: Cards Grid ───
// White bg, colored top band, cards in 2-col grid with cycling accent colors
function addCardsGridSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Top accent band
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_WIDTH, h: 0.08,
    fill: { color: accentPalette[contentIndex % accentPalette.length] },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.25, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Thin underline beneath title
  contentSlide.addShape(pres.ShapeType.rect, {
    x: MARGIN, y: 0.9, w: 2.5, h: 0.04,
    fill: { color: theme.accent },
    line: { type: 'none' },
  });
  staticShapes++;

  // Slide number badge — bottom right
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI-generated image — behind content as decoration
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Content cards — animated pairs
  const points = slide.points || [];
  const colCount = points.length <= 4 ? 2 : 3;
  const rowCount = Math.ceil(points.length / colCount);
  const cardGap = 0.15;
  const cardWidth = (SLIDE_WIDTH - 2 * MARGIN - (colCount - 1) * cardGap) / colCount;
  const availableHeight = SLIDE_HEIGHT - 1.2 - MARGIN;
  const cardHeight = Math.min((availableHeight - (rowCount - 1) * cardGap) / rowCount, 1.8);

  points.forEach((point, index) => {
    const col = index % colCount;
    const row = Math.floor(index / colCount);
    const x = MARGIN + col * (cardWidth + cardGap);
    const y = 1.15 + row * (cardHeight + cardGap);
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];
    const cardColor = lightenColor(accentColor, 0.75);

    // Card bg
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: cardWidth, h: cardHeight,
      fill: { color: cardColor },
      rectRadius: 0.08,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Icon circle at top of card
    const iconSize = 0.5;
    contentSlide.addText(getPointIcon(point), {
      x: x + (cardWidth - iconSize) / 2,
      y: y + 0.12,
      w: iconSize,
      h: iconSize,
      fontSize: 18,
      fontFace: 'Segoe UI Emoji',
      align: 'center',
      valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Card text — shifted down to make room for icon
    contentSlide.addText(getPointText(point), {
      x: x + 0.15, y: y + iconSize + 0.15, w: cardWidth - 0.3, h: cardHeight - iconSize - 0.3,
      fontSize: 12, bold: true, fontFace: 'Calibri',
      color: darkenColor(accentColor, 0.3),
      align: 'center', valign: 'top', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT B: Horizontal Bars ───
// White bg, full-width horizontal bars with left colored accent strip
function addHorizontalBarsSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'F8F8F8' };

  let staticShapes = 0;

  // Left accent stripe
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: SLIDE_HEIGHT,
    fill: { color: accentPalette[contentIndex % accentPalette.length] },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN + 0.1, y: 0.2, w: SLIDE_WIDTH - MARGIN - 0.5, h: 0.55,
    fontSize: 26, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI-generated image — right strip decoration
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'right-strip');

  // Horizontal bar items — animated pairs
  const points = slide.points || [];
  const hasImg = !!slide.imageData;
  const barHeight = Math.min((SLIDE_HEIGHT - 1.1 - MARGIN) / points.length - 0.08, 0.7);
  const barWidth = hasImg ? SLIDE_WIDTH - MARGIN - 2.8 : SLIDE_WIDTH - MARGIN - 0.6;

  points.forEach((point, index) => {
    const y = 0.95 + index * (barHeight + 0.08);
    const barAccent = accentPalette[(contentIndex + index) % accentPalette.length];

    // Bar bg with colored left border
    contentSlide.addShape(pres.ShapeType.rect, {
      x: 0.35, y, w: barWidth, h: barHeight,
      fill: { color: lightenColor(barAccent, 0.9) },
      line: { color: barAccent, width: 2.5 },
      shadow: createShadow(),
    });

    // Icon circle on left side of bar
    const iconSize = Math.min(barHeight - 0.08, 0.45);
    contentSlide.addText(getPointIcon(point), {
      x: 0.45,
      y: y + (barHeight - iconSize) / 2,
      w: iconSize,
      h: iconSize,
      fontSize: 15,
      fontFace: 'Segoe UI Emoji',
      align: 'center',
      valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: barAccent },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Bar text — shifted right for icon
    contentSlide.addText(getPointText(point), {
      x: 0.45 + iconSize + 0.15, y, w: barWidth - iconSize - 0.6, h: barHeight,
      fontSize: 13, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  // Each item = 3 shapes (bar bg + icon + text) — animation pairs use bg + text
  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT C: Numbered Points ───
// Large number badge + text, stacked vertically
function addNumberedPointsSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Right side colored panel
  contentSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH - 0.4, y: 0, w: 0.4, h: SLIDE_HEIGHT,
    fill: { color: lightenColor(accentPalette[contentIndex % accentPalette.length], 0.6) },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - MARGIN - 0.8, h: 0.55,
    fontSize: 26, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI-generated image — bottom-left decoration
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-left');

  // Numbered points — animated pairs (number badge = bg, text = text)
  const points = slide.points || [];
  const itemHeight = Math.min((SLIDE_HEIGHT - 1.0 - MARGIN) / points.length - 0.06, 0.65);

  points.forEach((point, index) => {
    const y = 0.9 + index * (itemHeight + 0.06);
    const numColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Icon badge — emoji in colored circle
    contentSlide.addText(getPointIcon(point), {
      x: MARGIN, y: y + (itemHeight - 0.5) / 2, w: 0.5, h: 0.5,
      fontSize: 18, fontFace: 'Segoe UI Emoji',
      color: 'FFFFFF', align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: numColor },
      line: { type: 'none' },
    });

    // Point text
    contentSlide.addText(getPointText(point), {
      x: MARGIN + 0.7, y, w: SLIDE_WIDTH - MARGIN - 1.4, h: itemHeight,
      fontSize: 13, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  // Each item = 2 shapes (icon badge + point text) — proper animation pairs
  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT D: Accent Header ───
// Colored header band with white title, then cards below on light bg
function addAccentHeaderSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'F5F5F5' };

  let staticShapes = 0;

  // Colored header band
  const headerColor = accentPalette[contentIndex % accentPalette.length];
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_WIDTH, h: 1.0,
    fill: { color: headerColor },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title on header
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.1, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.8,
    fontSize: 26, bold: true, fontFace: 'Trebuchet MS',
    color: 'FFFFFF', align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI-generated image — bottom-right decoration
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Content cards below header
  const points = slide.points || [];
  const colCount = points.length <= 4 ? 2 : 3;
  const rowCount = Math.ceil(points.length / colCount);
  const cardGap = 0.12;
  const cardWidth = (SLIDE_WIDTH - 2 * MARGIN - (colCount - 1) * cardGap) / colCount;
  const availableHeight = SLIDE_HEIGHT - 1.25 - MARGIN;
  const cardHeight = Math.min((availableHeight - (rowCount - 1) * cardGap) / rowCount, 1.6);

  points.forEach((point, index) => {
    const col = index % colCount;
    const row = Math.floor(index / colCount);
    const x = MARGIN + col * (cardWidth + cardGap);
    const y = 1.2 + row * (cardHeight + cardGap);

    // Card bg — white with colored top border
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: cardWidth, h: cardHeight,
      fill: { color: 'FFFFFF' },
      rectRadius: 0.06,
      line: { color: 'E0E0E0', width: 0.5 },
      shadow: createShadow(),
    });

    // Colored top strip on card
    contentSlide.addShape(pres.ShapeType.rect, {
      x: x + 0.06, y, w: cardWidth - 0.12, h: 0.05,
      fill: { color: headerColor },
      line: { type: 'none' },
    });

    // Icon at top of card
    const iconSize = 0.45;
    contentSlide.addText(getPointIcon(point), {
      x: x + (cardWidth - iconSize) / 2,
      y: y + 0.12,
      w: iconSize,
      h: iconSize,
      fontSize: 16,
      fontFace: 'Segoe UI Emoji',
      align: 'center',
      valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: lightenColor(headerColor, 0.15) },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Card text — shifted down for icon
    contentSlide.addText(getPointText(point), {
      x: x + 0.15, y: y + iconSize + 0.18, w: cardWidth - 0.3, h: cardHeight - iconSize - 0.35,
      fontSize: 12, bold: true, fontFace: 'Calibri',
      color: '333333', align: 'center', valign: 'top', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT E: Dark Cards ───
// Dark bg, light colored cards, dramatic contrast
function addDarkCardsSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: darkenColor(theme.primary, 0.4) };

  let staticShapes = 0;

  // Bottom accent bar
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: SLIDE_HEIGHT - 0.06, w: SLIDE_WIDTH, h: 0.06,
    fill: { color: theme.secondary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.25, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: 'FFFFFF', align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Title underline
  contentSlide.addShape(pres.ShapeType.rect, {
    x: MARGIN, y: 0.9, w: 1.8, h: 0.04,
    fill: { color: theme.secondary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '888888', align: 'right',
  });
  staticShapes++;

  // AI-generated image — bottom-right decoration
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Light cards on dark bg
  const points = slide.points || [];
  const colCount = points.length <= 4 ? 2 : 3;
  const rowCount = Math.ceil(points.length / colCount);
  const cardGap = 0.15;
  const cardWidth = (SLIDE_WIDTH - 2 * MARGIN - (colCount - 1) * cardGap) / colCount;
  const availableHeight = SLIDE_HEIGHT - 1.2 - MARGIN - 0.1;
  const cardHeight = Math.min((availableHeight - (rowCount - 1) * cardGap) / rowCount, 1.7);

  points.forEach((point, index) => {
    const col = index % colCount;
    const row = Math.floor(index / colCount);
    const x = MARGIN + col * (cardWidth + cardGap);
    const y = 1.15 + row * (cardHeight + cardGap);
    const cardAccent = accentPalette[(contentIndex + index) % accentPalette.length];

    // Card bg
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: cardWidth, h: cardHeight,
      fill: { color: lightenColor(cardAccent, 0.8) },
      rectRadius: 0.08,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Icon circle at top of card (contrasting on light card)
    const iconSize = 0.5;
    contentSlide.addText(getPointIcon(point), {
      x: x + (cardWidth - iconSize) / 2,
      y: y + 0.1,
      w: iconSize,
      h: iconSize,
      fontSize: 18,
      fontFace: 'Segoe UI Emoji',
      align: 'center',
      valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: cardAccent },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Card text — shifted down for icon
    contentSlide.addText(getPointText(point), {
      x: x + 0.15, y: y + iconSize + 0.12, w: cardWidth - 0.3, h: cardHeight - iconSize - 0.25,
      fontSize: 12, bold: true, fontFace: 'Calibri',
      color: darkenColor(cardAccent, 0.3),
      align: 'center', valign: 'top', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT F: Timeline ───
// Vertical connecting line with circle nodes and text beside each node
function addTimelineSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Subtle top gradient bar
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_WIDTH, h: 0.06,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.55,
    fontSize: 26, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // Vertical timeline line
  const points = slide.points || [];
  const lineX = 1.3;
  const startY = 1.0;
  const itemSpacing = Math.min((SLIDE_HEIGHT - startY - 0.3) / points.length, 0.85);
  const endY = startY + (points.length - 1) * itemSpacing;

  contentSlide.addShape(pres.ShapeType.rect, {
    x: lineX - 0.02, y: startY, w: 0.04, h: endY - startY + 0.3,
    fill: { color: lightenColor(theme.primary, 0.6) },
    line: { type: 'none' },
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Timeline nodes and text
  points.forEach((point, index) => {
    const y = startY + index * itemSpacing;
    const nodeColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Circle node on the line
    const nodeSize = 0.45;
    contentSlide.addText(getPointIcon(point), {
      x: lineX - nodeSize / 2, y: y, w: nodeSize, h: nodeSize,
      fontSize: 15, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: nodeColor },
      line: { color: 'FFFFFF', width: 2 },
      color: 'FFFFFF',
    });

    // Connector dash from node to text
    contentSlide.addShape(pres.ShapeType.rect, {
      x: lineX + nodeSize / 2 + 0.05, y: y + nodeSize / 2 - 0.015, w: 0.3, h: 0.03,
      fill: { color: lightenColor(nodeColor, 0.4) },
      line: { type: 'none' },
    });

    // Text to the right
    contentSlide.addText(getPointText(point), {
      x: lineX + nodeSize / 2 + 0.45, y: y - 0.05,
      w: SLIDE_WIDTH - lineX - nodeSize - 1.5, h: nodeSize + 0.1,
      fontSize: 13, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT G: Split Screen ───
// Left half is a solid color panel, right half is white with content cards
function addSplitScreenSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Left colored panel (40% width)
  const panelWidth = SLIDE_WIDTH * 0.38;
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: panelWidth, h: SLIDE_HEIGHT,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Decorative circle on left panel
  contentSlide.addShape(pres.ShapeType.ellipse, {
    x: panelWidth - 1.2, y: SLIDE_HEIGHT - 1.8, w: 2, h: 2,
    fill: { color: lightenColor(theme.primary, 0.12), transparency: 40 },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title on left panel (white text)
  contentSlide.addText(slide.title, {
    x: 0.4, y: 0.6, w: panelWidth - 0.8, h: 1.8,
    fontSize: 24, bold: true, fontFace: 'Trebuchet MS',
    color: 'FFFFFF', align: 'left', valign: 'top', wrap: true,
  });
  staticShapes++;

  // Accent underline on panel
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0.4, y: 2.5, w: 1.5, h: 0.05,
    fill: { color: theme.secondary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: 0.4, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: lightenColor(theme.primary, 0.5), align: 'left',
  });
  staticShapes++;

  // AI image on left panel bottom
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-left');

  // Content items on right side
  const points = slide.points || [];
  const rightX = panelWidth + 0.35;
  const rightW = SLIDE_WIDTH - panelWidth - 0.7;
  const itemHeight = Math.min((SLIDE_HEIGHT - 0.8) / points.length - 0.1, 0.8);

  points.forEach((point, index) => {
    const y = 0.4 + index * (itemHeight + 0.1);
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Card bg with left accent border
    contentSlide.addShape(pres.ShapeType.rect, {
      x: rightX, y, w: rightW, h: itemHeight,
      fill: { color: lightenColor(accentColor, 0.92) },
      rectRadius: 0.06,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Icon
    const iconSize = Math.min(itemHeight - 0.12, 0.45);
    contentSlide.addText(getPointIcon(point), {
      x: rightX + 0.15, y: y + (itemHeight - iconSize) / 2,
      w: iconSize, h: iconSize,
      fontSize: 15, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Text
    contentSlide.addText(getPointText(point), {
      x: rightX + 0.15 + iconSize + 0.15, y,
      w: rightW - iconSize - 0.55, h: itemHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT H: Icon Row ───
// Large icons in a horizontal row across the slide, text beneath each
function addIconRowSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: lightenColor(theme.primary, 0.93) };

  let staticShapes = 0;

  // Bottom accent bar
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: SLIDE_HEIGHT - 0.08, w: SLIDE_WIDTH, h: 0.08,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title centered at top
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.25, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'center', valign: 'middle',
  });
  staticShapes++;

  // Thin underline
  contentSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH / 2 - 1.2, y: 0.9, w: 2.4, h: 0.04,
    fill: { color: theme.accent },
    line: { type: 'none' },
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image — center background watermark
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Icon columns — evenly spaced across width
  const points = slide.points || [];
  const colCount = points.length;
  const colWidth = (SLIDE_WIDTH - 2 * MARGIN) / colCount;
  const iconSize = Math.min(colWidth * 0.55, 1.1);

  points.forEach((point, index) => {
    const centerX = MARGIN + index * colWidth + colWidth / 2;
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Large icon circle
    contentSlide.addText(getPointIcon(point), {
      x: centerX - iconSize / 2, y: 1.2,
      w: iconSize, h: iconSize,
      fontSize: Math.round(iconSize * 22), fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
      shadow: createShadow(),
    });

    // Small connector line under icon
    contentSlide.addShape(pres.ShapeType.rect, {
      x: centerX - 0.015, y: 1.2 + iconSize + 0.08,
      w: 0.03, h: 0.25,
      fill: { color: lightenColor(accentColor, 0.4) },
      line: { type: 'none' },
    });

    // Text below icon
    contentSlide.addText(getPointText(point), {
      x: centerX - colWidth / 2 + 0.1, y: 1.2 + iconSize + 0.4,
      w: colWidth - 0.2, h: SLIDE_HEIGHT - 1.2 - iconSize - 0.9,
      fontSize: 11, fontFace: 'Calibri', bold: true,
      color: '444444', align: 'center', valign: 'top', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT I: Quote Spotlight ───
// Big bold statement/quote at top, supporting details as small cards below
function addQuoteSpotlightSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: theme.primary };

  let staticShapes = 0;

  // Large decorative quote mark — top left
  contentSlide.addText('\u201C', {
    x: 0.2, y: -0.3, w: 1.5, h: 1.5,
    fontSize: 120, fontFace: 'Georgia',
    color: lightenColor(theme.primary, 0.15),
    align: 'left', valign: 'top',
  });
  staticShapes++;

  // Title as the spotlight quote — large and centered
  contentSlide.addText(slide.title, {
    x: MARGIN + 0.3, y: 0.3, w: SLIDE_WIDTH - 2 * MARGIN - 0.6, h: 1.5,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: 'FFFFFF', align: 'center', valign: 'middle', wrap: true,
  });
  staticShapes++;

  // Accent bar below quote
  contentSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH / 2 - 1, y: 1.9, w: 2, h: 0.05,
    fill: { color: theme.secondary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: lightenColor(theme.primary, 0.4), align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Supporting detail cards — horizontal row below the quote
  const points = slide.points || [];
  const cardGap = 0.15;
  const totalCardWidth = SLIDE_WIDTH - 2 * MARGIN;
  const cardWidth = (totalCardWidth - (points.length - 1) * cardGap) / points.length;
  const cardHeight = SLIDE_HEIGHT - 2.3 - 0.5;

  points.forEach((point, index) => {
    const x = MARGIN + index * (cardWidth + cardGap);
    const y = 2.2;
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Semi-transparent card
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: cardWidth, h: cardHeight,
      fill: { color: lightenColor(theme.primary, 0.1), transparency: 25 },
      rectRadius: 0.08,
      line: { type: 'none' },
    });

    // Icon at top of card
    const iconSize = 0.42;
    contentSlide.addText(getPointIcon(point), {
      x: x + (cardWidth - iconSize) / 2, y: y + 0.15,
      w: iconSize, h: iconSize,
      fontSize: 16, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Card text
    contentSlide.addText(getPointText(point), {
      x: x + 0.1, y: y + iconSize + 0.25,
      w: cardWidth - 0.2, h: cardHeight - iconSize - 0.45,
      fontSize: 11, fontFace: 'Calibri', bold: true,
      color: 'FFFFFF', align: 'center', valign: 'top', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT J: Stacked Pills ───
// Rounded pill-shaped bars stacked vertically with gradient-like fills
function addStackedPillsSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FAFAFA' };

  let staticShapes = 0;

  // Top-right decorative rounded rect
  contentSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH - 2.5, y: -0.5, w: 3, h: 1.5,
    fill: { color: lightenColor(theme.primary, 0.85) },
    rectRadius: 0.4,
    line: { type: 'none' },
    rotate: -8,
  });
  staticShapes++;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 26, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Colored dot before title
  contentSlide.addShape(pres.ShapeType.ellipse, {
    x: MARGIN - 0.25, y: 0.42, w: 0.16, h: 0.16,
    fill: { color: theme.accent },
    line: { type: 'none' },
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Stacked pill bars
  const points = slide.points || [];
  const hasImg = !!slide.imageData;
  const pillHeight = Math.min((SLIDE_HEIGHT - 1.2 - 0.4) / points.length - 0.1, 0.65);
  const pillWidth = hasImg ? SLIDE_WIDTH - MARGIN - 3.0 : SLIDE_WIDTH - 2 * MARGIN;

  points.forEach((point, index) => {
    const y = 1.05 + index * (pillHeight + 0.1);
    const pillColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Pill background — big rounded rect
    contentSlide.addShape(pres.ShapeType.rect, {
      x: MARGIN, y, w: pillWidth, h: pillHeight,
      fill: { color: lightenColor(pillColor, 0.78) },
      rectRadius: pillHeight / 2, // Fully rounded ends = pill shape
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Icon circle on left end of pill
    const iconSize = Math.min(pillHeight - 0.08, 0.48);
    contentSlide.addText(getPointIcon(point), {
      x: MARGIN + 0.12, y: y + (pillHeight - iconSize) / 2,
      w: iconSize, h: iconSize,
      fontSize: 15, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: pillColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Text inside pill
    contentSlide.addText(getPointText(point), {
      x: MARGIN + 0.12 + iconSize + 0.15, y,
      w: pillWidth - iconSize - 0.55, h: pillHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: darkenColor(pillColor, 0.25), align: 'left', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT K: Big Number ───
// White bg, large stat display on left (colored circle with icon), points stacked on right
function addBigNumberSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Left 40% big number display
  const points = slide.points || [];
  const leftWidth = SLIDE_WIDTH * 0.38;
  const accentColor = accentPalette[contentIndex % accentPalette.length];

  // Large decorative circle on left
  const circleSize = 2.2;
  contentSlide.addShape(pres.ShapeType.ellipse, {
    x: (leftWidth - circleSize) / 2, y: SLIDE_HEIGHT / 2 - circleSize / 2,
    w: circleSize, h: circleSize,
    fill: { color: lightenColor(accentColor, 0.85) },
    line: { type: 'none' },
  });
  staticShapes++;

  // Large icon in circle center
  const iconSize = 1.0;
  contentSlide.addText(points.length > 0 ? getPointIcon(points[0]) : '▪', {
    x: (leftWidth - iconSize) / 2, y: SLIDE_HEIGHT / 2 - iconSize / 2,
    w: iconSize, h: iconSize,
    fontSize: 40, fontFace: 'Segoe UI Emoji',
    align: 'center', valign: 'middle',
    shape: pres.ShapeType.ellipse,
    fill: { color: accentColor },
    line: { type: 'none' },
    color: 'FFFFFF',
  });
  staticShapes++;

  // Right side content points (stacked)
  const rightX = leftWidth + MARGIN;
  const rightW = SLIDE_WIDTH - rightX - MARGIN;
  const itemHeight = Math.min((SLIDE_HEIGHT - 1.2) / points.length - 0.08, 0.7);

  points.forEach((point, index) => {
    const y = 1.05 + index * (itemHeight + 0.08);
    const itemAccent = accentPalette[(contentIndex + index) % accentPalette.length];

    // Item bg card
    contentSlide.addShape(pres.ShapeType.rect, {
      x: rightX, y, w: rightW, h: itemHeight,
      fill: { color: lightenColor(itemAccent, 0.92) },
      rectRadius: 0.06,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Item icon
    const itemIconSize = Math.min(itemHeight - 0.1, 0.42);
    contentSlide.addText(getPointIcon(point), {
      x: rightX + 0.12, y: y + (itemHeight - itemIconSize) / 2,
      w: itemIconSize, h: itemIconSize,
      fontSize: 14, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: itemAccent },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Item text
    contentSlide.addText(getPointText(point), {
      x: rightX + 0.12 + itemIconSize + 0.12, y,
      w: rightW - itemIconSize - 0.5, h: itemHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT L: Vertical Divider ───
// White bg, thin vertical accent line down center, points alternate left/right
function addVerticalDividerSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Vertical divider line in center
  const centerX = SLIDE_WIDTH / 2;
  contentSlide.addShape(pres.ShapeType.rect, {
    x: centerX - 0.02, y: 1.0, w: 0.04, h: SLIDE_HEIGHT - 1.4,
    fill: { color: accentPalette[contentIndex % accentPalette.length] },
    line: { type: 'none' },
  });
  staticShapes++;

  // Points alternating left and right of divider
  const points = slide.points || [];
  const colWidth = centerX - MARGIN - 0.1;
  const itemHeight = Math.min((SLIDE_HEIGHT - 1.2) / points.length - 0.08, 0.7);

  points.forEach((point, index) => {
    const y = 1.05 + index * (itemHeight + 0.08);
    const itemAccent = accentPalette[(contentIndex + index) % accentPalette.length];
    const isLeft = index % 2 === 0;
    const x = isLeft ? MARGIN : centerX + 0.1;

    // Item bg card
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: colWidth, h: itemHeight,
      fill: { color: lightenColor(itemAccent, 0.92) },
      rectRadius: 0.06,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Item icon
    const itemIconSize = Math.min(itemHeight - 0.1, 0.38);
    const iconX = isLeft ? x + 0.1 : x + colWidth - itemIconSize - 0.1;
    contentSlide.addText(getPointIcon(point), {
      x: iconX, y: y + (itemHeight - itemIconSize) / 2,
      w: itemIconSize, h: itemIconSize,
      fontSize: 13, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: itemAccent },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Item text
    const textX = isLeft ? x + itemIconSize + 0.15 : x + 0.1;
    const textW = isLeft ? colWidth - itemIconSize - 0.3 : colWidth - itemIconSize - 0.3;
    contentSlide.addText(getPointText(point), {
      x: textX, y,
      w: textW, h: itemHeight,
      fontSize: 11, fontFace: 'Calibri', bold: true,
      color: '333333', align: isLeft ? 'left' : 'right', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT M: Floating Bubbles ───
// Light gray bg, points in rounded bubble shapes with staggered rows
function addFloatingBubblesSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'F5F5F5' };

  let staticShapes = 0;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Layout bubbles in grid with alternating row offsets
  const points = slide.points || [];
  const colCount = Math.min(3, Math.ceil(Math.sqrt(points.length)));
  const bubbleWidth = (SLIDE_WIDTH - 2 * MARGIN - 0.2) / colCount;
  const bubbleHeight = 0.8;
  const contentArea = SLIDE_HEIGHT - 1.2 - MARGIN;
  const rowCount = Math.ceil(points.length / colCount);

  points.forEach((point, index) => {
    const col = index % colCount;
    const row = Math.floor(index / colCount);
    let x = MARGIN + col * (bubbleWidth + 0.1);
    let y = 1.05 + row * (bubbleHeight + 0.15);

    // Stagger alternate rows slightly
    if (row % 2 === 1) {
      x += bubbleWidth / 4;
    }

    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Bubble bg (rounded rect)
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: bubbleWidth - 0.1, h: bubbleHeight,
      fill: { color: lightenColor(accentColor, 0.85) },
      rectRadius: 0.25,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Bubble icon
    const iconSize = 0.35;
    contentSlide.addText(getPointIcon(point), {
      x: x + (bubbleWidth - iconSize - 0.1) / 2, y: y + 0.08,
      w: iconSize, h: iconSize,
      fontSize: 13, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Bubble text
    contentSlide.addText(getPointText(point), {
      x: x + 0.08, y: y + 0.48,
      w: bubbleWidth - 0.16, h: bubbleHeight - 0.5,
      fontSize: 10, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'center', valign: 'top', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT N: Left Sidebar ───
// Left 25% solid sidebar with vertical title, right 75% has stacked content cards
function addLeftSidebarSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Left colored sidebar (25% width)
  const sidebarWidth = SLIDE_WIDTH * 0.25;
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: sidebarWidth, h: SLIDE_HEIGHT,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title on sidebar — vertical text
  contentSlide.addText(slide.title, {
    x: 0.2, y: 0.5, w: sidebarWidth - 0.4, h: SLIDE_HEIGHT - 1,
    fontSize: 24, bold: true, fontFace: 'Trebuchet MS',
    color: 'FFFFFF', align: 'center', valign: 'middle',
    rotate: 270, wrap: true,
  });
  staticShapes++;

  // Slide number on sidebar
  contentSlide.addText(String(slideIndex + 1), {
    x: 0.1, y: SLIDE_HEIGHT - 0.6, w: sidebarWidth - 0.2, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: lightenColor(theme.primary, 0.4), align: 'center',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Content items on right side
  const points = slide.points || [];
  const rightX = sidebarWidth + MARGIN;
  const rightW = SLIDE_WIDTH - rightX - MARGIN;
  const itemHeight = Math.min((SLIDE_HEIGHT - 0.8) / points.length - 0.08, 0.7);

  points.forEach((point, index) => {
    const y = 0.4 + index * (itemHeight + 0.08);
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Content card bg
    contentSlide.addShape(pres.ShapeType.rect, {
      x: rightX, y, w: rightW, h: itemHeight,
      fill: { color: lightenColor(accentColor, 0.92) },
      rectRadius: 0.06,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Card icon
    const iconSize = Math.min(itemHeight - 0.1, 0.42);
    contentSlide.addText(getPointIcon(point), {
      x: rightX + 0.12, y: y + (itemHeight - iconSize) / 2,
      w: iconSize, h: iconSize,
      fontSize: 14, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Card text
    contentSlide.addText(getPointText(point), {
      x: rightX + 0.12 + iconSize + 0.12, y,
      w: rightW - iconSize - 0.5, h: itemHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT O: Gradient Banner ───
// White bg, each point sits on full-width colored banner strips stacked vertically
function addGradientBannerSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Banner strips for each point
  const points = slide.points || [];
  const bannerHeight = Math.min((SLIDE_HEIGHT - 1.2) / points.length - 0.08, 0.75);

  points.forEach((point, index) => {
    const y = 1.05 + index * (bannerHeight + 0.08);
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];
    const isLight = index % 2 === 0;
    const bannerColor = isLight ? lightenColor(accentColor, 0.88) : lightenColor(accentColor, 0.75);

    // Full-width banner bg
    contentSlide.addShape(pres.ShapeType.rect, {
      x: 0, y, w: SLIDE_WIDTH, h: bannerHeight,
      fill: { color: bannerColor },
      line: { type: 'none' },
    });

    // Banner icon
    const iconSize = Math.min(bannerHeight - 0.1, 0.45);
    contentSlide.addText(getPointIcon(point), {
      x: MARGIN, y: y + (bannerHeight - iconSize) / 2,
      w: iconSize, h: iconSize,
      fontSize: 15, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Banner text
    contentSlide.addText(getPointText(point), {
      x: MARGIN + iconSize + 0.15, y,
      w: SLIDE_WIDTH - MARGIN - iconSize - 0.35, h: bannerHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: darkenColor(accentColor, 0.3), align: 'left', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT P: Photo Focus ───
// Left half is AI image (if available), right half has stacked points; fallback to two-column layout
function addPhotoFocusSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  const points = slide.points || [];
  const hasImage = !!slide.imageData;

  if (hasImage) {
    // Image on left half
    const imageWidth = SLIDE_WIDTH * 0.48;
    staticShapes += addSlideImage(contentSlide, slide.imageData, 'center-bg');
    // Manually place image box for visual containment
    contentSlide.addShape(pres.ShapeType.rect, {
      x: MARGIN, y: 1.0, w: imageWidth - MARGIN * 2, h: SLIDE_HEIGHT - 1.4,
      fill: { type: 'none' },
      line: { color: lightenColor(theme.primary, 0.7), width: 1 },
      rectRadius: 0.08,
    });
    staticShapes++;

    // Content on right half
    const rightX = SLIDE_WIDTH * 0.5;
    const rightW = SLIDE_WIDTH - rightX - MARGIN;
    const itemHeight = Math.min((SLIDE_HEIGHT - 1.2) / points.length - 0.08, 0.7);

    points.forEach((point, index) => {
      const y = 1.05 + index * (itemHeight + 0.08);
      const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

      // Content card bg
      contentSlide.addShape(pres.ShapeType.rect, {
        x: rightX, y, w: rightW, h: itemHeight,
        fill: { color: lightenColor(accentColor, 0.92) },
        rectRadius: 0.06,
        line: { type: 'none' },
        shadow: createShadow(),
      });

      // Card icon
      const iconSize = Math.min(itemHeight - 0.1, 0.42);
      contentSlide.addText(getPointIcon(point), {
        x: rightX + 0.12, y: y + (itemHeight - iconSize) / 2,
        w: iconSize, h: iconSize,
        fontSize: 14, fontFace: 'Segoe UI Emoji',
        align: 'center', valign: 'middle',
        shape: pres.ShapeType.ellipse,
        fill: { color: accentColor },
        line: { type: 'none' },
        color: 'FFFFFF',
      });

      // Card text
      contentSlide.addText(getPointText(point), {
        x: rightX + 0.12 + iconSize + 0.12, y,
        w: rightW - iconSize - 0.5, h: itemHeight,
        fontSize: 12, fontFace: 'Calibri', bold: true,
        color: '333333', align: 'left', valign: 'middle', wrap: true,
      });
    });
  } else {
    // Fallback: two-column card layout without image
    const colWidth = (SLIDE_WIDTH - 2 * MARGIN - 0.15) / 2;
    const itemHeight = Math.min((SLIDE_HEIGHT - 1.2) / Math.ceil(points.length / 2) - 0.08, 0.8);

    points.forEach((point, index) => {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = MARGIN + col * (colWidth + 0.15);
      const y = 1.05 + row * (itemHeight + 0.08);
      const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

      // Card bg
      contentSlide.addShape(pres.ShapeType.rect, {
        x, y, w: colWidth, h: itemHeight,
        fill: { color: lightenColor(accentColor, 0.92) },
        rectRadius: 0.06,
        line: { type: 'none' },
        shadow: createShadow(),
      });

      // Card icon
      const iconSize = Math.min(itemHeight - 0.1, 0.4);
      contentSlide.addText(getPointIcon(point), {
        x: x + (colWidth - iconSize) / 2, y: y + 0.12,
        w: iconSize, h: iconSize,
        fontSize: 14, fontFace: 'Segoe UI Emoji',
        align: 'center', valign: 'middle',
        shape: pres.ShapeType.ellipse,
        fill: { color: accentColor },
        line: { type: 'none' },
        color: 'FFFFFF',
      });

      // Card text
      contentSlide.addText(getPointText(point), {
        x: x + 0.1, y: y + iconSize + 0.15,
        w: colWidth - 0.2, h: itemHeight - iconSize - 0.3,
        fontSize: 11, fontFace: 'Calibri', bold: true,
        color: '333333', align: 'center', valign: 'top', wrap: true,
      });
    });
  }

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT Q: Zigzag ───
// White bg, points alternate left/right with connecting diagonal lines
function addZigzagSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Zigzag points
  const points = slide.points || [];
  const cardWidth = (SLIDE_WIDTH - 2 * MARGIN) * 0.6;
  const itemHeight = Math.min((SLIDE_HEIGHT - 1.2) / points.length - 0.08, 0.75);
  const centerX = SLIDE_WIDTH / 2;

  points.forEach((point, index) => {
    const y = 1.05 + index * (itemHeight + 0.08);
    const isLeft = index % 2 === 0;
    const x = isLeft ? MARGIN : SLIDE_WIDTH - cardWidth - MARGIN;
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Card bg
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: cardWidth, h: itemHeight,
      fill: { color: lightenColor(accentColor, 0.88) },
      rectRadius: 0.08,
      line: { color: accentColor, width: 1.5 },
      shadow: createShadow(),
    });

    // Card icon
    const iconSize = Math.min(itemHeight - 0.1, 0.42);
    const iconX = isLeft ? x + 0.12 : x + cardWidth - iconSize - 0.12;
    contentSlide.addText(getPointIcon(point), {
      x: iconX, y: y + (itemHeight - iconSize) / 2,
      w: iconSize, h: iconSize,
      fontSize: 14, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Card text
    const textX = isLeft ? x + iconSize + 0.15 : x + 0.12;
    const textW = isLeft ? cardWidth - iconSize - 0.3 : cardWidth - iconSize - 0.3;
    contentSlide.addText(getPointText(point), {
      x: textX, y,
      w: textW, h: itemHeight,
      fontSize: 11, fontFace: 'Calibri', bold: true,
      color: '333333', align: isLeft ? 'left' : 'right', valign: 'middle', wrap: true,
    });

    // Connecting diagonal line to next card (if not last)
    if (index < points.length - 1) {
      const nextIsLeft = (index + 1) % 2 === 0;
      const lineStartX = isLeft ? x + cardWidth : x;
      const lineStartY = y + itemHeight;
      const lineEndX = nextIsLeft ? MARGIN + cardWidth : SLIDE_WIDTH - cardWidth - MARGIN;
      const lineEndY = y + itemHeight + 0.08;

      contentSlide.addShape(pres.ShapeType.rect, {
        x: Math.min(lineStartX, lineEndX) - 0.02,
        y: lineStartY,
        w: Math.abs(lineEndX - lineStartX) + 0.04,
        h: Math.abs(lineEndY - lineStartY) + 0.04,
        fill: { type: 'none' },
        line: { color: lightenColor(accentColor, 0.5), width: 1, dashType: 'dash' },
      });
      staticShapes++;
    }
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT R: Metric Dashboard ───
// Title + insight at top, points as equal-width metric cards in a row at bottom
function addMetricDashboardSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: lightenColor(theme.primary, 0.95) };

  let staticShapes = 0;

  // Top accent bar
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_WIDTH, h: 0.06,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Metric dashboard cards at bottom
  const points = slide.points || [];
  const cardGap = 0.2;
  const cardWidth = (SLIDE_WIDTH - 2 * MARGIN - (points.length - 1) * cardGap) / points.length;
  const cardHeight = 1.2;
  const cardY = SLIDE_HEIGHT - cardHeight - MARGIN;

  points.forEach((point, index) => {
    const x = MARGIN + index * (cardWidth + cardGap);
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Metric card bg
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y: cardY, w: cardWidth, h: cardHeight,
      fill: { color: 'FFFFFF' },
      rectRadius: 0.06,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Colored top border
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y: cardY, w: cardWidth, h: 0.08,
      fill: { color: accentColor },
      line: { type: 'none' },
    });

    // Card icon
    const iconSize = 0.35;
    contentSlide.addText(getPointIcon(point), {
      x: x + (cardWidth - iconSize) / 2, y: cardY + 0.15,
      w: iconSize, h: iconSize,
      fontSize: 13, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Card text
    contentSlide.addText(getPointText(point), {
      x: x + 0.08, y: cardY + 0.58,
      w: cardWidth - 0.16, h: cardHeight - 0.66,
      fontSize: 10, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'center', valign: 'top', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT S: Pyramid Stack ───
// White bg, points arranged as stacked bars getting progressively wider (funnel/hierarchy)
function addPyramidStackSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  let staticShapes = 0;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Pyramid/funnel bars
  const points = slide.points || [];
  const maxWidth = SLIDE_WIDTH - 2 * MARGIN;
  const minWidth = maxWidth * 0.3;
  const itemHeight = Math.min((SLIDE_HEIGHT - 1.2) / points.length - 0.08, 0.75);
  const centerX = SLIDE_WIDTH / 2;

  points.forEach((point, index) => {
    const progress = index / (points.length - 1 || 1);
    const barWidth = minWidth + (maxWidth - minWidth) * progress;
    const x = centerX - barWidth / 2;
    const y = 1.05 + index * (itemHeight + 0.08);
    const accentColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Pyramid bar
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: barWidth, h: itemHeight,
      fill: { color: lightenColor(accentColor, 0.85) },
      rectRadius: 0.06,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Bar icon
    const iconSize = Math.min(itemHeight - 0.1, 0.42);
    contentSlide.addText(getPointIcon(point), {
      x: x + 0.15, y: y + (itemHeight - iconSize) / 2,
      w: iconSize, h: iconSize,
      fontSize: 14, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: accentColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Bar text
    contentSlide.addText(getPointText(point), {
      x: x + 0.15 + iconSize + 0.12, y,
      w: barWidth - iconSize - 0.5, h: itemHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: darkenColor(accentColor, 0.25), align: 'left', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── LAYOUT T: Checklist ───
// Light bg, each point has a large green checkmark circle on left with text beside it
function addChecklistSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: lightenColor(theme.primary, 0.96) };

  let staticShapes = 0;

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN, y: 0.2, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.6,
    fontSize: 28, bold: true, fontFace: 'Trebuchet MS',
    color: theme.primary, align: 'left', valign: 'middle',
  });
  staticShapes++;

  // Slide number
  contentSlide.addText(String(slideIndex + 1), {
    x: SLIDE_WIDTH - 0.8, y: SLIDE_HEIGHT - 0.6, w: 0.5, h: 0.4,
    fontSize: 10, fontFace: 'Calibri', color: '999999', align: 'right',
  });
  staticShapes++;

  // AI image
  staticShapes += addSlideImage(contentSlide, slide.imageData, 'bottom-right');

  // Checklist items
  const points = slide.points || [];
  const itemHeight = Math.min((SLIDE_HEIGHT - 1.2) / points.length - 0.08, 0.75);

  points.forEach((point, index) => {
    const y = 1.05 + index * (itemHeight + 0.08);
    const checkColor = '4CAF50'; // Green checkmark color

    // Checkmark circle bg
    const checkSize = Math.min(itemHeight - 0.08, 0.55);
    contentSlide.addText('✓', {
      x: MARGIN, y: y + (itemHeight - checkSize) / 2,
      w: checkSize, h: checkSize,
      fontSize: 24, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: checkColor },
      line: { type: 'none' },
      color: 'FFFFFF',
    });

    // Item text beside checkmark
    contentSlide.addText(getPointText(point), {
      x: MARGIN + checkSize + 0.2, y,
      w: SLIDE_WIDTH - MARGIN - checkSize - 0.5, h: itemHeight,
      fontSize: 13, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  contentSlide.addNotes(slide.speakerNotes);
}

// ─── COMPARISON SLIDE (improved) ───
function addComparisonSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[],
  contentIndex: number
): void {
  const comparisonSlide = pres.addSlide();
  comparisonSlide.background = { color: 'FFFFFF' };

  // Top accent band
  comparisonSlide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: SLIDE_WIDTH, h: 0.9,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });

  // Title on band
  comparisonSlide.addText(slide.title, {
    x: MARGIN, y: 0.1, w: SLIDE_WIDTH - 2 * MARGIN, h: 0.7,
    fontSize: 26, bold: true, fontFace: 'Trebuchet MS',
    color: 'FFFFFF', align: 'left', valign: 'middle',
  });

  // AI-generated image — bottom-right decoration
  addSlideImage(comparisonSlide, slide.imageData, 'bottom-right');

  // Two-column layout
  const points = slide.points || [];
  const colWidth = (SLIDE_WIDTH - 2 * MARGIN - 0.3) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colWidth + 0.3;
  const leftPoints = points.slice(0, Math.ceil(points.length / 2));
  const rightPoints = points.slice(Math.ceil(points.length / 2));

  const itemHeight = Math.min((SLIDE_HEIGHT - 1.4 - MARGIN) / Math.max(leftPoints.length, rightPoints.length) - 0.08, 0.65);

  leftPoints.forEach((point, index) => {
    const y = 1.2 + index * (itemHeight + 0.08);
    comparisonSlide.addShape(pres.ShapeType.rect, {
      x: leftX, y, w: colWidth, h: itemHeight,
      fill: { color: lightenColor(theme.primary, 0.85) },
      rectRadius: 0.06,
      line: { type: 'none' },
      shadow: createShadow(),
    });
    // Icon
    const iconSz = Math.min(itemHeight - 0.08, 0.38);
    comparisonSlide.addText(getPointIcon(point), {
      x: leftX + 0.1, y: y + (itemHeight - iconSz) / 2, w: iconSz, h: iconSz,
      fontSize: 13, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: theme.primary }, line: { type: 'none' }, color: 'FFFFFF',
    });
    comparisonSlide.addText(getPointText(point), {
      x: leftX + 0.1 + iconSz + 0.1, y, w: colWidth - iconSz - 0.4, h: itemHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: theme.primary, align: 'left', valign: 'middle', wrap: true,
    });
  });

  rightPoints.forEach((point, index) => {
    const y = 1.2 + index * (itemHeight + 0.08);
    comparisonSlide.addShape(pres.ShapeType.rect, {
      x: rightX, y, w: colWidth, h: itemHeight,
      fill: { color: lightenColor(theme.accent, 0.8) },
      rectRadius: 0.06,
      line: { type: 'none' },
      shadow: createShadow(),
    });
    // Icon
    const iconSz = Math.min(itemHeight - 0.08, 0.38);
    comparisonSlide.addText(getPointIcon(point), {
      x: rightX + 0.1, y: y + (itemHeight - iconSz) / 2, w: iconSz, h: iconSz,
      fontSize: 13, fontFace: 'Segoe UI Emoji',
      align: 'center', valign: 'middle',
      shape: pres.ShapeType.ellipse,
      fill: { color: theme.accent }, line: { type: 'none' }, color: 'FFFFFF',
    });
    comparisonSlide.addText(getPointText(point), {
      x: rightX + 0.1 + iconSz + 0.1, y, w: colWidth - iconSz - 0.4, h: itemHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: darkenColor(theme.accent, 0.2), align: 'left', valign: 'middle', wrap: true,
    });
  });

  // Each point (left + right) = 3 shapes (bg rect + icon + text) — proper animation triples
  const staticCount = 2 + (slide.imageData ? 1 : 0); // top accent band + title on band + optional image
  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount, shapesPerCard: 3 });
  comparisonSlide.addNotes(slide.speakerNotes);
}

// ─── CLOSING SLIDE ───
function addClosingSlideA(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[]
): void {
  const closingSlide = pres.addSlide();
  closingSlide.background = { color: theme.primary };

  let staticShapes = 0;

  // Geometric accent — large tilted rectangle bottom left
  closingSlide.addShape(pres.ShapeType.rect, {
    x: -1, y: SLIDE_HEIGHT - 2, w: 3, h: 3,
    fill: { color: lightenColor(theme.primary, 0.15), transparency: 35 },
    line: { type: 'none' },
    rotate: -20,
  });
  staticShapes++;

  // Large tilted rectangle top right (mirror effect)
  closingSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH - 2.5, y: -1, w: 3, h: 2.5,
    fill: { color: lightenColor(theme.primary, 0.1), transparency: 45 },
    line: { type: 'none' },
    rotate: 15,
  });
  staticShapes++;

  // Accent circle — top right
  closingSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 1.5, y: 0.3, w: 1.2, h: 1.2,
    fill: { color: theme.secondary, transparency: 30 },
    line: { type: 'none' },
  });
  staticShapes++;

  // Small accent circle — bottom right
  closingSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 2.8, y: SLIDE_HEIGHT - 1.2, w: 0.5, h: 0.5,
    fill: { color: theme.accent, transparency: 40 },
    line: { type: 'none' },
  });
  staticShapes++;

  // Small decorative circle — left side
  closingSlide.addShape(pres.ShapeType.ellipse, {
    x: 1.5, y: 0.5, w: 0.4, h: 0.4,
    fill: { color: theme.secondary, transparency: 50 },
    line: { type: 'none' },
  });
  staticShapes++;

  // Diagonal accent stripe
  closingSlide.addShape(pres.ShapeType.rect, {
    x: -0.5, y: 0.7, w: 4, h: 0.06,
    fill: { color: theme.secondary, transparency: 35 },
    line: { type: 'none' },
    rotate: 8,
  });
  staticShapes++;

  // AI-generated image — right hero
  staticShapes += addSlideImage(closingSlide, slide.imageData, 'right-hero');

  // Main message
  closingSlide.addText(slide.title, {
    x: MARGIN + 0.5,
    y: 0.4,
    w: SLIDE_WIDTH - 2 * MARGIN - 1,
    h: 1.2,
    fontSize: 36,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    wrap: true,
  });
  staticShapes++;

  // Accent bar below title
  closingSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH / 2 - 1, y: 1.65,
    w: 2, h: 0.05,
    fill: { color: theme.secondary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Animated takeaway points (if points exist)
  const points = slide.points || [];
  if (points.length > 0) {
    const startY = 1.95;
    const pointHeight = 0.65;
    const pointGap = 0.12;
    const pointWidth = SLIDE_WIDTH - 2 * MARGIN - 1.5;
    const pointX = (SLIDE_WIDTH - pointWidth) / 2;

    points.forEach((point, index) => {
      const y = startY + index * (pointHeight + pointGap);
      const accentColor = accentPalette[index % accentPalette.length];

      // Semi-transparent card background
      closingSlide.addShape(pres.ShapeType.rect, {
        x: pointX, y, w: pointWidth, h: pointHeight,
        fill: { color: lightenColor(theme.primary, 0.12), transparency: 20 },
        rectRadius: 0.08,
        line: { type: 'none' },
      });

      // Icon on left
      const iconSize = 0.42;
      closingSlide.addText(getPointIcon(point), {
        x: pointX + 0.15,
        y: y + (pointHeight - iconSize) / 2,
        w: iconSize,
        h: iconSize,
        fontSize: 16,
        fontFace: 'Segoe UI Emoji',
        align: 'center',
        valign: 'middle',
        shape: pres.ShapeType.ellipse,
        fill: { color: accentColor },
        line: { type: 'none' },
        color: 'FFFFFF',
      });

      // Point text
      closingSlide.addText(getPointText(point), {
        x: pointX + 0.15 + iconSize + 0.15,
        y,
        w: pointWidth - iconSize - 0.55,
        h: pointHeight,
        fontSize: 14,
        bold: true,
        fontFace: 'Calibri',
        color: 'FFFFFF',
        align: 'left',
        valign: 'middle',
        wrap: true,
      });
    });

    // Register animation metadata: each point = 3 shapes (bg + icon + text)
    slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes, shapesPerCard: 3 });
  }

  // CTA subtitle at bottom
  if (slide.subtitle) {
    const ctaY = points.length > 0
      ? 1.95 + points.length * (0.65 + 0.12) + 0.1
      : 3.4;
    closingSlide.addText(slide.subtitle, {
      x: MARGIN + 1,
      y: Math.min(ctaY, SLIDE_HEIGHT - 1.1),
      w: SLIDE_WIDTH - 2 * MARGIN - 2,
      h: 0.7,
      fontSize: 17,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  closingSlide.addNotes(slide.speakerNotes);
}

// ─── CLOSING SLIDE B: CTA Card ───
function addClosingSlideB(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[]
): void {
  const closingSlide = pres.addSlide();
  closingSlide.background = { color: theme.primary };

  let staticShapes = 0;

  // Subtle geometric decoration
  closingSlide.addShape(pres.ShapeType.rect, {
    x: -1,
    y: SLIDE_HEIGHT - 1.5,
    w: 2.5,
    h: 2,
    fill: { color: lightenColor(theme.primary, 0.12), transparency: 50 },
    line: { type: 'none' },
    rotate: -15,
  });
  staticShapes++;

  // Clean centered white card (rectRadius 0.15) in the middle
  const cardW = (SLIDE_WIDTH - 2 * MARGIN) * 0.7;
  const cardX = (SLIDE_WIDTH - cardW) / 2;
  const cardH = 3.2;
  const cardY = (SLIDE_HEIGHT - cardH) / 2;

  closingSlide.addShape(pres.ShapeType.rect, {
    x: cardX,
    y: cardY,
    w: cardW,
    h: cardH,
    fill: { color: 'FFFFFF' },
    rectRadius: 0.15,
    line: { type: 'none' },
    shadow: createShadow(),
  });
  staticShapes++;

  // Title at top of card
  closingSlide.addText(slide.title, {
    x: cardX + 0.3,
    y: cardY + 0.25,
    w: cardW - 0.6,
    h: 0.6,
    fontSize: 28,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: theme.primary,
    align: 'center',
    valign: 'middle',
    wrap: true,
  });
  staticShapes++;

  // Takeaway points inside card
  const points = slide.points || [];
  if (points.length > 0) {
    const pointStartY = cardY + 1.0;
    const pointH = 0.5;
    const pointGap = 0.15;

    points.forEach((point, index) => {
      const y = pointStartY + index * (pointH + pointGap);

      // Point background circle
      closingSlide.addShape(pres.ShapeType.ellipse, {
        x: cardX + 0.25,
        y: y + (pointH - 0.35) / 2,
        w: 0.35,
        h: 0.35,
        fill: { color: accentPalette[index % accentPalette.length] },
        line: { type: 'none' },
      });

      // Point text
      closingSlide.addText(getPointText(point), {
        x: cardX + 0.7,
        y,
        w: cardW - 1.0,
        h: pointH,
        fontSize: 13,
        fontFace: 'Calibri',
        color: '#333333',
        align: 'left',
        valign: 'middle',
        wrap: true,
      });
    });

    // Register animation metadata: each point = 3 shapes
    slideAnimationMeta.set(slideIndex, {
      cardCount: points.length,
      staticCount: staticShapes,
      shapesPerCard: 3,
    });
  }

  // CTA subtitle at bottom of card in accent color
  if (slide.subtitle) {
    closingSlide.addText(slide.subtitle, {
      x: cardX + 0.3,
      y: cardY + cardH - 0.55,
      w: cardW - 0.6,
      h: 0.45,
      fontSize: 16,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  closingSlide.addNotes(slide.speakerNotes);
}

// ─── CLOSING SLIDE C: Thank You + Contact ───
function addClosingSlideC(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[]
): void {
  const closingSlide = pres.addSlide();
  closingSlide.background = { color: theme.primary };

  let staticShapes = 0;

  // Large "Thank You" text at top (using slide.title)
  closingSlide.addText(slide.title, {
    x: MARGIN,
    y: 0.3,
    w: SLIDE_WIDTH - 2 * MARGIN,
    h: 0.9,
    fontSize: 40,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    wrap: true,
  });
  staticShapes++;

  // Accent bar
  closingSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH / 2 - 1.5,
    y: 1.3,
    w: 3,
    h: 0.06,
    fill: { color: theme.secondary },
    line: { type: 'none' },
  });
  staticShapes++;

  // Takeaway points as small horizontal pill-shaped bars below
  const points = slide.points || [];
  if (points.length > 0) {
    const pointStartY = 1.8;
    const pointH = 0.55;
    const pointGap = 0.15;
    const pointW = SLIDE_WIDTH - 2 * MARGIN - 1;
    const pointX = (SLIDE_WIDTH - pointW) / 2;

    points.forEach((point, index) => {
      const y = pointStartY + index * (pointH + pointGap);
      const accentColor = accentPalette[index % accentPalette.length];

      // Pill background
      closingSlide.addShape(pres.ShapeType.rect, {
        x: pointX,
        y,
        w: pointW,
        h: pointH,
        fill: { color: lightenColor(theme.primary, 0.12), transparency: 15 },
        rectRadius: 0.25,
        line: { type: 'none' },
      });

      // Icon on left
      const iconSize = 0.38;
      closingSlide.addText(getPointIcon(point), {
        x: pointX + 0.15,
        y: y + (pointH - iconSize) / 2,
        w: iconSize,
        h: iconSize,
        fontSize: 16,
        fontFace: 'Segoe UI Emoji',
        align: 'center',
        valign: 'middle',
        color: accentColor,
      });

      // Point text
      closingSlide.addText(getPointText(point), {
        x: pointX + 0.6,
        y,
        w: pointW - 0.75,
        h: pointH,
        fontSize: 13,
        bold: true,
        fontFace: 'Calibri',
        color: 'FFFFFF',
        align: 'left',
        valign: 'middle',
        wrap: true,
      });
    });

    // Register animation metadata: each point = 3 shapes
    slideAnimationMeta.set(slideIndex, {
      cardCount: points.length,
      staticCount: staticShapes,
      shapesPerCard: 3,
    });
  }

  // Subtitle at very bottom as contact/CTA line
  if (slide.subtitle) {
    closingSlide.addText(slide.subtitle, {
      x: MARGIN,
      y: SLIDE_HEIGHT - 0.7,
      w: SLIDE_WIDTH - 2 * MARGIN,
      h: 0.6,
      fontSize: 16,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  closingSlide.addNotes(slide.speakerNotes);
}

// ─── CLOSING SLIDE D: Key Takeaways Grid ───
function addClosingSlideD(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[]
): void {
  const closingSlide = pres.addSlide();
  closingSlide.background = { color: theme.primary };

  let staticShapes = 0;

  // Title at top
  closingSlide.addText(slide.title, {
    x: MARGIN,
    y: 0.3,
    w: SLIDE_WIDTH - 2 * MARGIN,
    h: 0.7,
    fontSize: 32,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    wrap: true,
  });
  staticShapes++;

  // Points displayed in a 2x2 card grid (semi-transparent cards) with icons
  const points = slide.points || [];
  if (points.length > 0) {
    const gridStartY = 1.3;
    const cardW = (SLIDE_WIDTH - 3 * MARGIN) / 2;
    const cardH = 1.5;
    const cardGap = 0.3;

    points.slice(0, 4).forEach((point, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const x = MARGIN + col * (cardW + cardGap);
      const y = gridStartY + row * (cardH + cardGap);
      const accentColor = accentPalette[index % accentPalette.length];

      // Card background (semi-transparent)
      closingSlide.addShape(pres.ShapeType.rect, {
        x,
        y,
        w: cardW,
        h: cardH,
        fill: { color: lightenColor(theme.primary, 0.12), transparency: 25 },
        rectRadius: 0.1,
        line: { type: 'none' },
      });

      // Icon at top
      closingSlide.addText(getPointIcon(point), {
        x: x + (cardW - 0.4) / 2,
        y: y + 0.15,
        w: 0.4,
        h: 0.4,
        fontSize: 18,
        fontFace: 'Segoe UI Emoji',
        align: 'center',
        valign: 'middle',
        color: accentColor,
      });

      // Point text below icon
      closingSlide.addText(getPointText(point), {
        x: x + 0.15,
        y: y + 0.6,
        w: cardW - 0.3,
        h: 0.8,
        fontSize: 12,
        bold: true,
        fontFace: 'Calibri',
        color: 'FFFFFF',
        align: 'center',
        valign: 'middle',
        wrap: true,
      });
    });

    // Register animation metadata: each point = 3 shapes
    slideAnimationMeta.set(slideIndex, {
      cardCount: Math.min(points.length, 4),
      staticCount: staticShapes,
      shapesPerCard: 3,
    });
  }

  // Strong final CTA message at bottom (subtitle)
  if (slide.subtitle) {
    closingSlide.addText(slide.subtitle, {
      x: MARGIN + 0.5,
      y: SLIDE_HEIGHT - 0.8,
      w: SLIDE_WIDTH - 2 * MARGIN - 1,
      h: 0.6,
      fontSize: 18,
      bold: true,
      fontFace: 'Trebuchet MS',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  closingSlide.addNotes(slide.speakerNotes);
}

// ─── CLOSING SLIDE WRAPPER ───
function addClosingSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[]
): void {
  const variants = [addClosingSlideA, addClosingSlideB, addClosingSlideC, addClosingSlideD];
  const pick = variants[Math.floor(Math.random() * variants.length)];
  pick(pres, slide, theme, slideIndex, accentPalette);
}

// ─── ANIMATION XML GENERATION ───
// Fixed: proper ID sequencing, grpId, and bldLst for Keynote compatibility

function buildAnimationTimingXml(
  shapeIds: number[],
  staticCount: number,
  cardCount: number,
  shapesPerCard: number = 3
): string {
  // Collect animated shape IDs for bldLst
  const animatedShapeIds: number[] = [];

  // ID counter — reserve 1 for tmRoot, 2 for mainSeq
  let ctnId = 2;
  const nextId = () => ++ctnId;

  let clickParBlocks = '';
  for (let card = 0; card < cardCount; card++) {
    // Gather all shape IDs for this card (bg, icon, text — or bg, text for legacy)
    const cardShapeIds: number[] = [];
    for (let s = 0; s < shapesPerCard; s++) {
      const idx = staticCount + card * shapesPerCard + s;
      const spId = shapeIds[idx];
      if (spId) cardShapeIds.push(spId);
    }
    if (cardShapeIds.length === 0) continue;

    animatedShapeIds.push(...cardShapeIds);

    const outerParId = nextId();

    // Build child par blocks for each shape in the card
    let shapeParBlocks = '';
    cardShapeIds.forEach((spId, i) => {
      const innerId = nextId();
      const effectId = nextId();
      const setId = nextId();
      // First shape is clickEffect, rest are withEffect (appear simultaneously)
      const nodeType = i === 0 ? 'clickEffect' : 'withEffect';

      shapeParBlocks += `
            <p:par>
              <p:cTn id="${innerId}" fill="hold">
                <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                <p:childTnLst>
                  <p:par>
                    <p:cTn id="${effectId}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="${nodeType}">
                      <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                      <p:childTnLst>
                        <p:set>
                          <p:cBhvr>
                            <p:cTn id="${setId}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>
                            <p:tgtEl><p:spTgt spid="${spId}"/></p:tgtEl>
                            <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>
                          </p:cBhvr>
                          <p:to><p:strVal val="visible"/></p:to>
                        </p:set>
                      </p:childTnLst>
                    </p:cTn>
                  </p:par>
                </p:childTnLst>
              </p:cTn>
            </p:par>`;
    });

    clickParBlocks += `
      <p:par>
        <p:cTn id="${outerParId}" fill="hold">
          <p:stCondLst><p:cond delay="0"/></p:stCondLst>
          <p:childTnLst>${shapeParBlocks}
          </p:childTnLst>
        </p:cTn>
      </p:par>`;
  }

  // Build the bldLst section — required for Keynote compatibility
  let bldLstEntries = '';
  for (const spid of animatedShapeIds) {
    bldLstEntries += `<p:bldP spid="${spid}" grpId="0" animBg="1"/>`;
  }
  const bldLst = bldLstEntries ? `<p:bldLst>${bldLstEntries}</p:bldLst>` : '';

  return `
    <p:timing>
      <p:tnLst>
        <p:par>
          <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">
            <p:childTnLst>
              <p:seq concurrent="1" nextAc="seek">
                <p:cTn id="2" dur="indefinite" nodeType="mainSeq">
                  <p:childTnLst>${clickParBlocks}</p:childTnLst>
                </p:cTn>
                <p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>
                <p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>
              </p:seq>
            </p:childTnLst>
          </p:cTn>
        </p:par>
      </p:tnLst>
      ${bldLst}
    </p:timing>`;
}

// ─── ANIMATION INJECTION ───
async function injectAnimations(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  for (const [slideIndex, meta] of slideAnimationMeta.entries()) {
    if (meta.cardCount <= 0) continue;

    const slideFile = `ppt/slides/slide${slideIndex + 1}.xml`;
    const fileEntry = zip.file(slideFile);
    if (!fileEntry) continue;

    const xml = await fileEntry.async('string');

    // Extract all shape IDs in order
    const spBlocks = xml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) || [];
    const shapeIds = spBlocks
      .map((block) => {
        const match = block.match(/<p:cNvPr id="(\d+)"/);
        return match ? parseInt(match[1]) : null;
      })
      .filter((id): id is number => id !== null);

    const timingXml = buildAnimationTimingXml(shapeIds, meta.staticCount, meta.cardCount, meta.shapesPerCard);

    // Remove any existing timing, then inject new
    let newXml = xml.replace(/<p:timing>[\s\S]*?<\/p:timing>/, '');
    newXml = newXml.replace('</p:sld>', timingXml + '</p:sld>');

    zip.file(slideFile, newXml);
  }

  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(outputBuffer) as Buffer<ArrayBuffer>;
}

// ─── MAIN EXPORT ───
export async function generatePptx(
  structure: PresentationStructure,
  colorTheme: string,
  animations: boolean = false
): Promise<Buffer> {
  slideAnimationMeta.clear();
  initShuffledLayouts(); // Randomize layout order for this presentation

  const theme = getTheme(colorTheme);
  const accentPalette = getAccentPalette(theme);

  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'default', width: SLIDE_WIDTH, height: SLIDE_HEIGHT });

  let slideIndex = 0;
  let contentSlideIndex = 0; // tracks only content slides for layout cycling

  for (const slide of structure.slides) {
    switch (slide.type) {
      case 'title':
        addTitleSlide(pres, slide, theme);
        break;
      case 'content': {
        const layout = getLayoutForSlide(contentSlideIndex);
        switch (layout) {
          case 'cards-grid':
            addCardsGridSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'horizontal-bars':
            addHorizontalBarsSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'numbered-points':
            addNumberedPointsSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'accent-header':
            addAccentHeaderSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'dark-cards':
            addDarkCardsSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'timeline':
            addTimelineSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'split-screen':
            addSplitScreenSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'icon-row':
            addIconRowSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'quote-spotlight':
            addQuoteSpotlightSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'stacked-pills':
            addStackedPillsSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'big-number':
            addBigNumberSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'vertical-divider':
            addVerticalDividerSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'floating-bubbles':
            addFloatingBubblesSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'left-sidebar':
            addLeftSidebarSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'gradient-banner':
            addGradientBannerSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'photo-focus':
            addPhotoFocusSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'zigzag':
            addZigzagSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'metric-dashboard':
            addMetricDashboardSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'pyramid-stack':
            addPyramidStackSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
          case 'checklist':
            addChecklistSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
            break;
        }
        contentSlideIndex++;
        break;
      }
      case 'comparison':
        addComparisonSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
        contentSlideIndex++;
        break;
      case 'closing':
        addClosingSlide(pres, slide, theme, slideIndex, accentPalette);
        break;
      default: {
        const fallbackLayout = getLayoutForSlide(contentSlideIndex);
        if (fallbackLayout === 'dark-cards') {
          addDarkCardsSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
        } else {
          addCardsGridSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
        }
        contentSlideIndex++;
      }
    }
    slideIndex++;
  }

  // Generate base buffer
  const arrayBuffer = await pres.write({ outputType: 'arraybuffer' });
  let buffer = Buffer.from(arrayBuffer as ArrayBuffer);

  // If animations enabled, post-process to inject click-based animations
  if (animations) {
    buffer = await injectAnimations(buffer) as Buffer<ArrayBuffer>;
  }

  return buffer;
}
