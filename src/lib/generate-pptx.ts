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

  // Title
  titleSlide.addText(slide.title, {
    x: MARGIN + 0.5,
    y: 1.2,
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

  // Horizontal bar items — animated pairs
  const points = slide.points || [];
  const barHeight = Math.min((SLIDE_HEIGHT - 1.1 - MARGIN) / points.length - 0.08, 0.7);
  const barWidth = SLIDE_WIDTH - MARGIN - 0.6;

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
  const staticCount = 2; // top accent band + title on band
  slideAnimationMeta.set(slideIndex, { cardCount: points.length, staticCount, shapesPerCard: 3 });
  comparisonSlide.addNotes(slide.speakerNotes);
}

// âââ CLOSING SLIDE âââ
function addClosingSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme,
  slideIndex: number,
  accentPalette: string[]
): void {
  const closingSlide = pres.addSlide();
  closingSlide.background = { color: theme.primary };

  let staticShapes = 0;

  // Geometric accent â large tilted rectangle bottom left
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

  // Accent circle â top right
  closingSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 1.5, y: 0.3, w: 1.2, h: 1.2,
    fill: { color: theme.secondary, transparency: 30 },
    line: { type: 'none' },
  });
  staticShapes++;

  // Small accent circle â bottom right
  closingSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 2.8, y: SLIDE_HEIGHT - 1.2, w: 0.5, h: 0.5,
    fill: { color: theme.accent, transparency: 40 },
    line: { type: 'none' },
  });
  staticShapes++;

  // Small decorative circle â left side
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
