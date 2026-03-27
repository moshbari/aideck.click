import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { PresentationStructure, SlideData, ColorTheme, ColorThemeName } from './types';

// Track how many content cards (animated elements) each slide has
// Key: slide index (0-based), Value: number of animated card groups
const slideCardCounts: Map<number, number> = new Map();

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
  theme: ColorTheme,
  slideIndex: number
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

  // Track: static elements added so far = stripe(1) + title(1) = 2 shapes before cards
  // Each card = 2 shapes (background rect + text)
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

  // Track card count for animation post-processing
  slideCardCounts.set(slideIndex, points.length);

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

/**
 * Generate "Appear on Click" animation XML for a slide.
 * Each card group (bg rect + text) appears together on one click.
 * staticCount = number of shapes before the animated cards start.
 * cardCount = number of card groups (each group = 2 shapes: rect + text).
 */
function buildAnimationTimingXml(
  shapeIds: number[],
  staticCount: number,
  cardCount: number
): string {
  let ctnId = 1;
  const nextId = () => ++ctnId;

  let clickParBlocks = '';
  for (let card = 0; card < cardCount; card++) {
    // Each card = 2 shapes (background + text), starting after static shapes
    const bgShapeIdx = staticCount + card * 2;
    const textShapeIdx = staticCount + card * 2 + 1;

    const bgSpId = shapeIds[bgShapeIdx];
    const textSpId = shapeIds[textShapeIdx];
    if (!bgSpId || !textSpId) continue;

    const outerParId = nextId();

    // Background shape — clickEffect (triggers on click)
    const bgInnerId = nextId();
    const bgEffectId = nextId();
    const bgSetId = nextId();

    // Text shape — withEffect (appears simultaneously)
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
                    <p:cTn id="${bgEffectId}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect">
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
                    <p:cTn id="${txtEffectId}" presetID="1" presetClass="entr" presetSubtype="0" fill="hold" nodeType="withEffect">
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

  const mainSeqId = nextId();
  return `
    <p:timing>
      <p:tnLst>
        <p:par>
          <p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot">
            <p:childTnLst>
              <p:seq concurrent="1" nextAc="seek">
                <p:cTn id="${mainSeqId}" dur="indefinite" nodeType="mainSeq">
                  <p:childTnLst>${clickParBlocks}</p:childTnLst>
                </p:cTn>
                <p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>
                <p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst>
              </p:seq>
            </p:childTnLst>
          </p:cTn>
        </p:par>
      </p:tnLst>
    </p:timing>`;
}

/**
 * Post-process the PPTX buffer to inject click-based "Appear" animations
 * into content slides that have card groups.
 */
async function injectAnimations(buffer: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);

  for (const [slideIndex, cardCount] of slideCardCounts.entries()) {
    if (cardCount <= 0) continue;

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

    // Content slides have: stripe(1 shape) + title(1 shape) = 2 static shapes before cards
    const staticCount = 2;
    const timingXml = buildAnimationTimingXml(shapeIds, staticCount, cardCount);

    // Remove any existing timing, then inject new
    let newXml = xml.replace(/<p:timing>[\s\S]*?<\/p:timing>/, '');
    newXml = newXml.replace('</p:sld>', timingXml + '</p:sld>');

    zip.file(slideFile, newXml);
  }

  const outputBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  return Buffer.from(outputBuffer) as Buffer<ArrayBuffer>;
}

export async function generatePptx(
  structure: PresentationStructure,
  colorTheme: string,
  animations: boolean = false
): Promise<Buffer> {
  // Clear tracking from previous runs
  slideCardCounts.clear();

  const theme = getTheme(colorTheme);

  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'default', width: SLIDE_WIDTH, height: SLIDE_HEIGHT });

  // Add all slides — track index for animation mapping
  let slideIndex = 0;
  for (const slide of structure.slides) {
    switch (slide.type) {
      case 'title':
        addTitleSlide(pres, slide, theme);
        break;
      case 'content':
        addContentSlide(pres, slide, theme, slideIndex);
        break;
      case 'comparison':
        addComparisonSlide(pres, slide, theme);
        break;
      case 'closing':
        addClosingSlide(pres, slide, theme);
        break;
      default:
        addContentSlide(pres, slide, theme, slideIndex);
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
