import PptxGenJS from 'pptxgenjs';
import { PresentationStructure } from './types';
import { getTheme } from './generate-pptx';

// Same 16:9 canvas the designed decks use
const SLIDE_WIDTH = 10;
const SLIDE_HEIGHT = 5.625;

/**
 * Full-Slide Image Deck.
 *
 * Every slide is a single edge-to-edge 16:9 image — no titles, no bullets, no
 * shapes. The entire spoken script lives in the presenter notes, so the
 * audience watches the picture while the presenter talks.
 *
 * Images arrive pre-cropped to 16:9 JPEG (see prepareFullSlideImage in the
 * generate route), so they drop straight onto the canvas with no distortion.
 */
export async function generateImagePptx(
  structure: PresentationStructure,
  colorTheme: string
): Promise<Buffer> {
  const theme = getTheme(colorTheme);

  const pres = new PptxGenJS();
  pres.defineLayout({ name: 'default', width: SLIDE_WIDTH, height: SLIDE_HEIGHT });
  pres.layout = 'default';

  for (const slide of structure.slides) {
    const s = pres.addSlide();

    if (slide.imageData) {
      // Full-bleed image — fills the whole slide, corner to corner
      s.background = { color: '000000' };
      s.addImage({
        data: `image/jpeg;base64,${slide.imageData}`,
        x: 0,
        y: 0,
        w: SLIDE_WIDTH,
        h: SLIDE_HEIGHT,
      });
    } else {
      // Image generation failed for this slide — fall back to a clean themed
      // card with the slide's headline so the deck is never blank.
      s.background = { color: theme.primary };
      s.addText(slide.title || structure.title, {
        x: 0.8,
        y: SLIDE_HEIGHT / 2 - 1,
        w: SLIDE_WIDTH - 1.6,
        h: 2,
        fontSize: 40,
        bold: true,
        color: theme.secondary,
        align: 'center',
        valign: 'middle',
        fontFace: 'Arial',
      });
    }

    // The script — this is the whole point of this deck type
    s.addNotes(slide.speakerNotes || '');
  }

  const arrayBuffer = await pres.write({ outputType: 'arraybuffer' });
  return Buffer.from(arrayBuffer as ArrayBuffer);
}
