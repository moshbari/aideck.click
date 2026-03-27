import PptxGenJS from 'pptxgenjs';
import { PresentationStructure, SlideData, ColorTheme, ColorThemeName } from './types';

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

function addTitleSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const titleSlide = pres.addSlide();
  titleSlide.background = { color: theme.primary };

  // Decorative circles
  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: 0.3,
    y: 0.3,
    w: 1.2,
    h: 1.2,
    fill: { color: theme.secondary, transparency: 40 },
    line: { type: 'none' },
  });

  titleSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 1.5,
    y: SLIDE_HEIGHT - 1.5,
    w: 1.4,
    h: 1.4,
    fill: { color: theme.accent, transparency: 30 },
    line: { type: 'none' },
  });

  // Title
  titleSlide.addText(slide.title, {
    x: MARGIN,
    y: 1.8,
    w: SLIDE_WIDTH - 2 * MARGIN,
    h: 1.2,
    fontSize: 44,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
  });

  // Subtitle
  if (slide.subtitle) {
    titleSlide.addText(slide.subtitle, {
      x: MARGIN,
      y: 3.2,
      w: SLIDE_WIDTH - 2 * MARGIN,
      h: 1,
      fontSize: 20,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
    });
  }

  // Speaker notes
  titleSlide.addNotes(slide.speakerNotes);
}

function addContentSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const contentSlide = pres.addSlide();
  contentSlide.background = { color: 'FFFFFF' };

  // Left colored stripe
  contentSlide.addShape(pres.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.15,
    h: SLIDE_HEIGHT,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });

  // Title
  contentSlide.addText(slide.title, {
    x: MARGIN,
    y: 0.3,
    w: SLIDE_WIDTH - 2 * MARGIN,
    h: 0.6,
    fontSize: 36,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: theme.primary,
    align: 'left',
    valign: 'middle',
  });

  // Content cards
  const points = slide.points || [];
  const itemCount = points.length;
  const colCount = itemCount <= 4 ? 2 : 3;
  const rowCount = Math.ceil(itemCount / colCount);

  const cardWidth = (SLIDE_WIDTH - 2 * MARGIN - 0.3) / colCount;
  const cardHeight = (SLIDE_HEIGHT - 1.2 - 2 * MARGIN) / rowCount;
  const cardGap = 0.15;

  points.forEach((point, index) => {
    const col = index % colCount;
    const row = Math.floor(index / colCount);

    const x = MARGIN + col * (cardWidth + cardGap);
    const y = 1.2 + row * (cardHeight + cardGap);

    // Card background
    contentSlide.addShape(pres.ShapeType.rect, {
      x,
      y,
      w: cardWidth,
      h: cardHeight,
      fill: { color: theme.secondary },
      line: { type: 'none' },
      shadow: createShadow(),
    });

    // Card text
    contentSlide.addText(point, {
      x: x + 0.15,
      y: y + 0.15,
      w: cardWidth - 0.3,
      h: cardHeight - 0.3,
      fontSize: 14,
      bold: true,
      fontFace: 'Calibri',
      color: theme.primary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  });

  // Speaker notes
  contentSlide.addNotes(slide.speakerNotes);
}

function addComparisonSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const comparisonSlide = pres.addSlide();
  comparisonSlide.background = { color: 'FFFFFF' };

  // Left colored stripe
  comparisonSlide.addShape(pres.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 0.15,
    h: SLIDE_HEIGHT,
    fill: { color: theme.primary },
    line: { type: 'none' },
  });

  // Title
  comparisonSlide.addText(slide.title, {
    x: MARGIN,
    y: 0.3,
    w: SLIDE_WIDTH - 2 * MARGIN,
    h: 0.6,
    fontSize: 36,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: theme.primary,
    align: 'left',
    valign: 'middle',
  });

  // Build two-column layout for comparison
  const points = slide.points || [];
  const contentWidth = (SLIDE_WIDTH - 2 * MARGIN - 0.3) / 2;
  const contentX1 = MARGIN;
  const contentX2 = MARGIN + contentWidth + 0.3;

  // Left column title
  comparisonSlide.addText('Left Column', {
    x: contentX1,
    y: 1.2,
    w: contentWidth,
    h: 0.4,
    fontSize: 18,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: theme.primary,
    align: 'center',
  });

  // Right column title
  comparisonSlide.addText('Right Column', {
    x: contentX2,
    y: 1.2,
    w: contentWidth,
    h: 0.4,
    fontSize: 18,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: theme.primary,
    align: 'center',
  });

  // Left column content
  const leftPoints = points.slice(0, Math.ceil(points.length / 2));
  let leftY = 1.7;
  leftPoints.forEach((point) => {
    comparisonSlide.addShape(pres.ShapeType.rect, {
      x: contentX1,
      y: leftY,
      w: contentWidth,
      h: 0.6,
      fill: { color: theme.secondary },
      line: { type: 'none' },
      shadow: createShadow(),
    });

    comparisonSlide.addText(point, {
      x: contentX1 + 0.1,
      y: leftY + 0.1,
      w: contentWidth - 0.2,
      h: 0.4,
      fontSize: 12,
      fontFace: 'Calibri',
      color: theme.primary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });

    leftY += 0.7;
  });

  // Right column content
  const rightPoints = points.slice(Math.ceil(points.length / 2));
  let rightY = 1.7;
  rightPoints.forEach((point) => {
    comparisonSlide.addShape(pres.ShapeType.rect, {
      x: contentX2,
      y: rightY,
      w: contentWidth,
      h: 0.6,
      fill: { color: theme.accent },
      line: { type: 'none' },
      shadow: createShadow(),
    });

    comparisonSlide.addText(point, {
      x: contentX2 + 0.1,
      y: rightY + 0.1,
      w: contentWidth - 0.2,
      h: 0.4,
      fontSize: 12,
      fontFace: 'Calibri',
      color: 'FFFFFF',
      align: 'center',
      valign: 'middle',
      wrap: true,
    });

    rightY += 0.7;
  });

  // Speaker notes
  comparisonSlide.addNotes(slide.speakerNotes);
}

function addClosingSlide(
  pres: PptxGenJS,
  slide: SlideData,
  theme: ColorTheme
): void {
  const closingSlide = pres.addSlide();
  closingSlide.background = { color: theme.primary };

  // Decorative circles
  closingSlide.addShape(pres.ShapeType.ellipse, {
    x: -0.3,
    y: SLIDE_HEIGHT - 1.2,
    w: 1.5,
    h: 1.5,
    fill: { color: theme.secondary, transparency: 40 },
    line: { type: 'none' },
  });

  closingSlide.addShape(pres.ShapeType.ellipse, {
    x: SLIDE_WIDTH - 1,
    y: 0.2,
    w: 1.3,
    h: 1.3,
    fill: { color: theme.accent, transparency: 30 },
    line: { type: 'none' },
  });

  // Main message
  closingSlide.addText(slide.title, {
    x: MARGIN,
    y: 1.5,
    w: SLIDE_WIDTH - 2 * MARGIN,
    h: 1.5,
    fontSize: 44,
    bold: true,
    fontFace: 'Trebuchet MS',
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    wrap: true,
  });

  // CTA text
  if (slide.subtitle) {
    closingSlide.addText(slide.subtitle, {
      x: MARGIN,
      y: 3.3,
      w: SLIDE_WIDTH - 2 * MARGIN,
      h: 0.8,
      fontSize: 20,
      fontFace: 'Calibri',
      color: theme.secondary,
      align: 'center',
      valign: 'middle',
      wrap: true,
    });
  }

  // Speaker notes
  closingSlide.addNotes(slide.speakerNotes);
}

export async function generatePptx(
  structure: PresentationStructure,
  colorTheme: string
): Promise<Buffer> {
  const theme = getTheme(colorTheme);

  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'default', width: SLIDE_WIDTH, height: SLIDE_HEIGHT });

  // Add all slides
  for (const slide of structure.slides) {
    switch (slide.type) {
      case 'title':
        addTitleSlide(pres, slide, theme);
        break;
      case 'content':
        addContentSlide(pres, slide, theme);
        break;
      case 'comparison':
        addComparisonSlide(pres, slide, theme);
        break;
      case 'closing':
        addClosingSlide(pres, slide, theme);
        break;
      default:
        addContentSlide(pres, slide, theme);
    }
  }

  // Generate and return buffer
  const arrayBuffer = await pres.write({ outputType: 'arraybuffer' });
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
