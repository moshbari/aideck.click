import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { PresentationStructure, SlideData, ColorTheme, ColorThemeName } from './types';

// Track animation metadata per slide
// Key: slide index, Value: { cardCount, staticCount }
const slideAnimationMeta: Map<number, { cardCount: number; staticCount: number }> = new Map();

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

type LayoutType = 'cards-grid' | 'horizontal-bars' | 'numbered-points' | 'accent-header' | 'dark-cards';

function getLayoutForSlide(contentSlideIndex: number): LayoutType {
  const layouts: LayoutType[] = ['cards-grid', 'horizontal-bars', 'numbered-points', 'accent-header', 'dark-cards'];
  return layouts[contentSlideIndex % layouts.length];
}

// ─── TITLE SLIDE ───
function addTitleSlide(
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

  // Small accent circle — top left
  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: 0.4,
    y: 0.4,
    w: 0.8,
    h: 0.8,
    fill: { color: theme.secondary, transparency: 30 },
    line: { type: 'none' },
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

  // Title
  titleSlide.addText(slide.title, {
    x: MARGIN + 0.5,
    y: 1.4,
    w: SLIDE_WIDTH - 2 * MARGIN - 1,
    h: 1.5,
    fontSize: 42,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    wrap: true,
  });

  // Subtitle
  if (slide.subtitle) {
    titleSlide.addText(slide.subtitle, {
      x: MARGIN + 1,
      y: 3.3,
      w: SLIDE_WIDTH - 2 * MARGIN - 2,
      h: 0.9,
      fontSize: 18,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  titleSlide.addNotes(slide.speakerNotes);
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
    const cardColor = lightenColor(accentPalette[(contentIndex + index) % accentPalette.length], 0.75);

    // Card bg
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: cardWidth, h: cardHeight,
      fill: { color: cardColor },
      rectRadius: 0.08,
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Card text
    contentSlide.addText(point, {
      x: x + 0.2, y: y + 0.15, w: cardWidth - 0.4, h: cardHeight - 0.3,
      fontSize: 13, bold: true, fontFace: 'Calibri',
      color: darkenColor(accentPalette[(contentIndex + index) % accentPalette.length], 0.3),
      align: 'center', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes });
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

  // Horizontal bar items — animated pairs
  const points = slide.points || [];
  const barHeight = Math.min((SLIDE_HEIGHT - 1.1 - MARGIN) / points.length - 0.08, 0.7);
  const barWidth = SLIDE_WIDTH - MARGIN - 0.6;

  points.forEach((point, index) => {
    const y = 0.95 + index * (barHeight + 0.08);
    const barAccent = accentPalette[(contentIndex + index) % accentPalette.length];

    // Bar bg with left color accent
    contentSlide.addShape(pres.ShapeType.rect, {
      x: 0.35, y, w: barWidth, h: barHeight,
      fill: { color: 'FFFFFF' },
      line: { color: 'E8E8E8', width: 0.5 },
      shadow: createShadow(),
    });

    // Left colored accent on the bar
    contentSlide.addShape(pres.ShapeType.rect, {
      x: 0.35, y, w: 0.08, h: barHeight,
      fill: { color: barAccent },
      line: { type: 'none' },
    });

    // Bar text
    contentSlide.addText(point, {
      x: 0.7, y, w: barWidth - 0.5, h: barHeight,
      fontSize: 13, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  // For horizontal bars: each item = 3 shapes (bar bg + accent strip + text)
  // but animation pairs work differently — we need bg+text pairs.
  // So: bar bg is animated shape 1, accent strip is NOT animated (it's part of the visual),
  // Actually for this layout, let's count: bar bg + accent + text = 3 shapes per bar.
  // For animation, we treat it as: [bar_bg, accent_strip] appears on click, then text appears with.
  // Simpler: don't animate this layout (or animate as 3-shape groups).
  // DECISION: For horizontal bars, each card = 3 shapes. We'll pair (bg + accent) as one click group
  // and text as withEffect. But our animation system expects pairs.
  // Let's rework: combine accent into the bg by just using a colored left border instead.
  // Actually, the shapes are already added. Let's just not animate horizontal bars to keep it working.
  // We'll set cardCount=0 so animations skip this layout.
  slideAnimationMeta.set(slideIndex, { cardCount: 0, staticCount: staticShapes + points.length * 3 });
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

  // Numbered points — animated pairs (number badge = bg, text = text)
  const points = slide.points || [];
  const itemHeight = Math.min((SLIDE_HEIGHT - 1.0 - MARGIN) / points.length - 0.06, 0.65);

  points.forEach((point, index) => {
    const y = 0.9 + index * (itemHeight + 0.06);
    const numColor = accentPalette[(contentIndex + index) % accentPalette.length];

    // Number circle (bg shape)
    contentSlide.addShape(pres.ShapeType.ellipse, {
      x: MARGIN, y: y + (itemHeight - 0.45) / 2, w: 0.45, h: 0.45,
      fill: { color: numColor },
      line: { type: 'none' },
    });

    // Number text inside circle (we can't animate this separately, so make it part of the "bg")
    // Actually, PptxGenJS addText creates a separate shape. Let's overlay the number onto the circle.
    contentSlide.addText(String(index + 1), {
      x: MARGIN, y: y + (itemHeight - 0.45) / 2, w: 0.45, h: 0.45,
      fontSize: 16, bold: true, fontFace: 'Calibri',
      color: 'FFFFFF', align: 'center', valign: 'middle',
    });

    // Point text (text shape for animation)
    contentSlide.addText(point, {
      x: MARGIN + 0.65, y, w: SLIDE_WIDTH - MARGIN - 1.3, h: itemHeight,
      fontSize: 13, fontFace: 'Calibri', bold: true,
      color: '333333', align: 'left', valign: 'middle', wrap: true,
    });
  });

  // Each numbered point = 3 shapes (circle + number text + point text)
  // For animation: we won't animate these either (3 shapes per group doesn't fit our pair system)
  slideAnimationMeta.set(slideIndex, { cardCount: 0, staticCount: staticShapes + points.length * 3 });
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

    // Card bg — white with subtle border
    contentSlide.addShape(pres.ShapeType.rect, {
      x, y, w: cardWidth, h: cardHeight,
      fill: { color: 'FFFFFF' },
      rectRadius: 0.06,
      line: { color: 'E0E0E0', width: 0.5 },
      shadow: createShadow(),
    });

    // Card text
    contentSlide.addText(point, {
      x: x + 0.2, y: y + 0.15, w: cardWidth - 0.4, h: cardHeight - 0.3,
      fontSize: 13, bold: true, fontFace: 'Calibri',
      color: '333333', align: 'center', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes });
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

    // Card text
    contentSlide.addText(point, {
      x: x + 0.2, y: y + 0.15, w: cardWidth - 0.4, h: cardHeight - 0.3,
      fontSize: 13, bold: true, fontFace: 'Calibri',
      color: darkenColor(cardAccent, 0.3),
      align: 'center', valign: 'middle', wrap: true,
    });
  });

  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount: staticShapes });
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
    comparisonSlide.addText(point, {
      x: leftX + 0.15, y, w: colWidth - 0.3, h: itemHeight,
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
    comparisonSlide.addText(point, {
      x: rightX + 0.15, y, w: colWidth - 0.3, h: itemHeight,
      fontSize: 12, fontFace: 'Calibri', bold: true,
      color: darkenColor(theme.accent, 0.2), align: 'left', valign: 'middle', wrap: true,
    });
  });

  // Don't animate comparison slides (complex two-column structure)
  slideAnimationMeta.set(slideIndex, { cardCount: 0, staticCount: 999 });
  comparisonSlide.addNotes(slide.speakerNotes);
}

// ─── CLOSING SLIDE ───
function addClosingSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const closingSlide = pres.addSlide();
  closingSlide.background = { color: theme.primary };

  // Geometric accent — large tilted rectangle
  closingSlide.addShape(pres.ShapeType.rect, {
    x: -1, y: SLIDE_HEIGHT - 2, w: 3, h: 3,
    fill: { color: lightenColor(theme.primary, 0.15), transparency: 35 },
    line: { type: 'none' },
    rotate: -20,
  });

  // Accent circle
  closingSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 1.5, y: 0.3, w: 1.2, h: 1.2,
    fill: { color: theme.secondary, transparency: 30 },
    line: { type: 'none' },
  });

  // Accent bar
  closingSlide.addShape(pres.ShapeType.rect, {
    x: SLIDE_WIDTH / 2 - 1, y: 3.1,
    w: 2, h: 0.05,
    fill: { color: theme.secondary },
    line: { type: 'none' },
  });

  // Main message
  closingSlide.addText(slide.title, {
    x: MARGIN + 0.5,
    y: 1.3,
    w: SLIDE_WIDTH - 2 * MARGIN - 1,
    h: 1.6,
    fontSize: 40,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    wrap: true,
  });

  // CTA
  if (slide.subtitle) {
    closingSlide.addText(slide.subtitle, {
      x: MARGIN + 1,
      y: 3.4,
      w: SLIDE_WIDTH - 2 * MARGIN - 2,
      h: 0.8,
      fontSize: 18,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  closingSlide.addNotes(slide.speakerNotes);
}

// ─── ANIMATION XML GENERATION ───
// Fixed: proper ID sequencing, grpId, and bldLst for Keynote compatibility

function buildAnimationTimingXml(
  shapeIds: number[],
  staticCount: number,
  cardCount: number
): string {
  // Collect animated shape IDs for bldLst
  const animatedShapeIds: number[] = [];

  // ID counter — reserve 1 for tmRoot, 2 for mainSeq
  let ctnId = 2;
  const nextId = () => ++ctnId;

  let clickParBlocks = '';
  for (let card = 0; card < cardCount; card++) {
    const bgShapeIdx = staticCount + card * 2;
    const textShapeIdx = staticCount + card * 2 + 1;

    const bgSpId = shapeIds[bgShapeIdx];
    const textSpId = shapeIds[textShapeIdx];
    if (!bgSpId || !textSpId) continue;

    animatedShapeIds.push(bgSpId, textSpId);

    const outerParId = nextId();
    const bgInnerId = nextId();
    const bgEffectId = nextId();
    const bgSetId = nextId();
    const txtInnerId = nextId();
    const txtEffectId = nextId();
    const txtSetId = nextId();

    clickParBlocks += `
      <p:par>
        <p:cTn id="${outerParId}" fill="hold">
          <p:stCondLst><p:cond delay="0"/></p:stCondLst>
          <p:childTnLst>
            <p:par>
              <p:cTn id="${bgInnerId}" fill="hold">
                <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                <p:childTnLst>
                  <p:par>
                    <p:cTn id="${bgEffectId}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="clickEffect">
                      <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                      <p:childTnLst>
                        <p:set>
                          <p:cBhvr>
                            <p:cTn id="${bgSetId}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>
                            <p:tgtEl><p:spTgt spid="${bgSpId}"/></p:tgtEl>
                            <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>
                          </p:cBhvr>
                          <p:to><p:strVal val="visible"/></p:to>
                        </p:set>
                      </p:childTnLst>
                    </p:cTn>
                  </p:par>
                </p:childTnLst>
              </p:cTn>
            </p:par>
            <p:par>
              <p:cTn id="${txtInnerId}" fill="hold">
                <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                <p:childTnLst>
                  <p:par>
                    <p:cTn id="${txtEffectId}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" grpId="0" nodeType="withEffect">
                      <p:stCondLst><p:cond delay="0"/></p:stCondLst>
                      <p:childTnLst>
                        <p:set>
                          <p:cBhvr>
                            <p:cTn id="${txtSetId}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>
                            <p:tgtEl><p:spTgt spid="${textSpId}"/></p:tgtEl>
                            <p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst>
                          </p:cBhvr>
                          <p:to><p:strVal val="visible"/></p:to>
                        </p:set>
                      </p:childTnLst>
                    </p:cTn>
                  </p:par>
                </p:childTnLst>
              </p:cTn>
            </p:par>
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

    const timingXml = buildAnimationTimingXml(shapeIds, meta.staticCount, meta.cardCount);

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
        }
        contentSlideIndex++;
        break;
      }
      case 'comparison':
        addComparisonSlide(pres, slide, theme, slideIndex, accentPalette, contentSlideIndex);
        contentSlideIndex++;
        break;
      case 'closing':
        addClosingSlide(pres, slide, theme);
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
