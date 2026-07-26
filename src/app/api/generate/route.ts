import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import sharp from 'sharp';
import { generatePptx } from '@/lib/generate-pptx';
import { generateImagePptx } from '@/lib/generate-image-pptx';
import { askClaudeForJson, usingSubscription } from '@/lib/claude-cli';
import {
  DeckType,
  GenerateRequest,
  ImageQuality,
  Pacing,
  PresentationStructure,
  SlideData,
  estimateImageCost,
  getPacing,
} from '@/lib/types';
import { uploadToR2, generateSmartFilename, generateDescription } from '@/lib/r2';
import { createClient } from '@supabase/supabase-js';

// Full-slide image decks paint one large picture per slide, and a rapid-fire
// deck can be 60 slides — these runs need real headroom.
export const maxDuration = 800;

// Color themes that are supported
const VALID_THEMES = ['navy-gold', 'coral-energy', 'forest-green', 'charcoal-minimal'];

// The two kinds of deck a user can ask for
const VALID_DECK_TYPES: DeckType[] = ['designed', 'full-image'];

// Image spend is opt-in: anything above 'low' has to be chosen deliberately.
const VALID_IMAGE_QUALITIES: ImageQuality[] = ['none', 'low', 'medium', 'high'];
const DEFAULT_IMAGE_QUALITY: ImageQuality =
  (process.env.FULL_IMAGE_QUALITY as ImageQuality) || 'low';

// Valid tones for reading level guidance
const VALID_TONES = [
  'professional',
  'casual',
  'creative',
  'academic',
  'inspirational',
  'technical',
];

function validateGenerateRequest(body: any): { valid: boolean; error?: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const { prompt, tone, slides, colorTheme, deckType } = body;

  // Validate deckType (optional — defaults to the classic designed deck)
  if (deckType !== undefined && !VALID_DECK_TYPES.includes(deckType)) {
    return {
      valid: false,
      error: `deckType must be one of: ${VALID_DECK_TYPES.join(', ')}`,
    };
  }

  // Validate prompt
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return { valid: false, error: 'prompt is required and must be a non-empty string' };
  }

  if (prompt.length > 2000) {
    return { valid: false, error: 'prompt must not exceed 2000 characters' };
  }

  // Validate tone
  if (!tone || typeof tone !== 'string' || !VALID_TONES.includes(tone.toLowerCase())) {
    return {
      valid: false,
      error: `tone must be one of: ${VALID_TONES.join(', ')}`,
    };
  }

  // Validate slides — fast-paced decks (6s a slide) need a lot of them
  if (!Number.isInteger(slides) || slides < 3 || slides > 60) {
    return { valid: false, error: 'slides must be an integer between 3 and 60' };
  }

  // Validate secondsPerSlide (optional — how long each slide stays on screen)
  const { secondsPerSlide, imageQuality } = body;
  if (secondsPerSlide !== undefined) {
    if (!Number.isInteger(secondsPerSlide) || secondsPerSlide < 3 || secondsPerSlide > 600) {
      return { valid: false, error: 'secondsPerSlide must be an integer between 3 and 600' };
    }
  }

  // Validate imageQuality (optional — controls how much the pictures cost)
  if (imageQuality !== undefined && !VALID_IMAGE_QUALITIES.includes(imageQuality)) {
    return {
      valid: false,
      error: `imageQuality must be one of: ${VALID_IMAGE_QUALITIES.join(', ')}`,
    };
  }

  // A full-slide image deck with no images is just blank slides
  if (imageQuality === 'none' && deckType === 'full-image') {
    return {
      valid: false,
      error: 'A Full-Slide Image Deck needs images — choose Low, Medium or High quality',
    };
  }

  // Validate colorTheme
  if (!colorTheme || typeof colorTheme !== 'string' || !VALID_THEMES.includes(colorTheme)) {
    return {
      valid: false,
      error: `colorTheme must be one of: ${VALID_THEMES.join(', ')}`,
    };
  }

  return { valid: true };
}

const PURPOSE_INSTRUCTIONS: Record<string, string> = {
  'sales-pitch': `PURPOSE — SALES PITCH:
- Structure: Problem → Solution → Benefits → Social proof → Pricing/ROI → Call to action
- Use persuasive, benefit-driven language. Focus on the audience's pain points and how you solve them.
- Include data, metrics, and results where possible. Make the ROI obvious.
- Speaker notes should anticipate objections and include rebuttals.
- End with a clear, compelling call to action.`,

  'authority-trust': `PURPOSE — AUTHORITY & TRUST BUILDING:
- Structure: Credibility → Expertise demonstration → Case studies/results → Thought leadership → Engagement
- Lead with credentials, experience, and track record. Show don't tell.
- Use specific numbers, client names (if appropriate), and concrete outcomes.
- Speaker notes should include anecdotes and proof points that build confidence.
- Tone should be confident but not arrogant — knowledgeable and approachable.`,

  'training': `PURPOSE — TRAINING / EDUCATIONAL:
- Structure: Learning objectives → Concept explanation → Examples → Practice/application → Key takeaways
- Break complex topics into digestible steps. One concept per slide.
- Use clear definitions and real-world examples. Avoid overwhelming the audience.
- Speaker notes should include extra explanations, analogies, and "check for understanding" prompts.
- Include recap/summary points. Make it easy to follow along.`,

  'internal-update': `PURPOSE — INTERNAL TEAM UPDATE:
- Structure: Context/status → Progress highlights → Challenges/blockers → Next steps → Discussion points
- Be direct and efficient. Team members want facts, not fluff.
- Highlight what changed, what's on track, and what needs attention.
- Speaker notes should include background context for new team members.
- Keep slides scannable — use short bullet points with clear status indicators.`,

  'conference-talk': `PURPOSE — CONFERENCE / PUBLIC TALK:
- Structure: Hook/story → Problem framing → Key insights → Evidence/demos → Memorable takeaway
- Open with a compelling hook — a story, surprising stat, or provocative question.
- Each slide should support ONE big idea. Less text, more impact.
- Speaker notes should be conversational and include timing cues and audience engagement moments.
- End with a memorable, quotable takeaway the audience will remember.`,
};

// ─── PACING ───
// "Six seconds a slide" (the Jason Fladlian style) only works if the script is
// written to fit six seconds. This turns the chosen time-on-screen into a hard
// word budget the writer has to hit.
function buildPacingInstructions(pacing: Pacing, deckType: DeckType): string {
  const mins = Math.floor(pacing.totalSeconds / 60);
  const secs = pacing.totalSeconds % 60;
  const runtime = mins > 0 ? `${mins} min${secs ? ` ${secs} sec` : ''}` : `${secs} sec`;

  const lines = [
    `PACING — THIS IS A HARD RULE:`,
    `- Each slide stays on screen for exactly ${pacing.seconds} seconds.`,
    `- So the speaker notes for EVERY slide must be about ${pacing.words} words — never fewer than ${pacing.minWords} and never more than ${pacing.maxWords}.`,
    `- ${pacing.words} words is what a presenter actually says out loud in ${pacing.seconds} seconds at a natural pace. Count your words.`,
    `- The finished deck runs about ${runtime} start to finish. Pace the story so it fits that length.`,
  ];

  if (pacing.seconds <= 12) {
    lines.push(
      `- This is a RAPID-FIRE deck. One single idea per slide. No slide tries to say two things.`,
      `- Write short, punchy, spoken sentences. No long clauses, no lists inside the notes.`,
      `- Momentum matters more than depth — each slide hands off to the next.`
    );
    if (deckType === 'designed') {
      lines.push(`- Because the slide is only up for ${pacing.seconds} seconds, give it 1-3 short bullet points MAXIMUM. Nobody can read six bullets in ${pacing.seconds} seconds.`);
    }
  } else if (pacing.seconds <= 25) {
    lines.push(`- This is a brisk deck. One clear idea per slide, said tightly.`);
    if (deckType === 'designed') {
      lines.push(`- Keep it to 2-4 short bullet points per slide so the audience can actually read them in ${pacing.seconds} seconds.`);
    }
  } else {
    lines.push(`- There is room to explain, give an example, or tell a short story on each slide.`);
    if (deckType === 'designed') {
      lines.push(`- Use 4-6 bullet points per slide.`);
    }
  }

  return lines.join('\n');
}

async function callClaudeAPI(
  prompt: string,
  tone: string,
  numberOfSlides: number,
  animations: boolean,
  pacing: Pacing,
  purpose?: string
): Promise<PresentationStructure> {
  const animationInstructions = animations
    ? `SPEAKER NOTES WITH CLICK CUES:
- The presentation uses click-based animations where each bullet point appears one at a time when the presenter clicks.
- Write speaker notes that include [CLICK] before each new point so the presenter knows when to click.
- Format: Start with a brief intro sentence (visible on slide load), then [CLICK] before each bullet point's talking point.
- Example format:
  "Let's look at the key challenges.

  [CLICK] First, the cost of getting started is higher than most people expect. You need to budget for tools before you earn anything.

  [CLICK] Second, the learning curve is steep. Each skill takes months to develop."
- Each [CLICK] paragraph should be 1-3 sentences that expand on the bullet point shown on screen.`
    : `SPEAKER NOTES (NO ANIMATION CUES):
- Write speaker notes as a flowing, natural script the presenter can read aloud.
- Do NOT include [CLICK], animation references, or transition cues.
- Write in clear paragraphs. Each paragraph covers one key idea from the slide.
- The notes should read like a conversation — as if the presenter is talking to the audience naturally.`;

  const systemPrompt = `You are an expert presentation designer. Create a structured presentation outline from the user's prompt.

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks, no extra text.

JSON FORMAT:
{
  "title": "Presentation Title",
  "slides": [
    {
      "type": "title|content|comparison|closing",
      "title": "Slide Title",
      "subtitle": "Optional subtitle (title and closing slides only)",
      "points": [
        { "text": "Point text here", "icon": "🎯" },
        { "text": "Another point", "icon": "💡" }
      ],
      "speakerNotes": "Full presenter script for this slide...",
      "imagePrompt": "A flat-style illustration of..."
    }
  ]
}

IMAGE PROMPT RULES — VERY IMPORTANT:
- Every slide MUST include an "imagePrompt" field
- The imagePrompt is a description that will be sent to DALL-E to generate a unique illustration for that slide
- Write it as a clear, vivid description of a FLAT-STYLE or MINIMALIST illustration that matches the slide content
- Keep prompts under 80 words
- Style guide: "flat vector illustration, clean modern style, simple shapes, no text, no words, no letters"
- Match the topic: a slide about money → illustration of coins/charts; a slide about teamwork → people collaborating
- Do NOT include any text or words in the image description — the images must be purely visual/graphic
- Each slide's image should be different and unique to that slide's content

SLIDE RULES:
1. Generate exactly ${numberOfSlides} slides total
2. First slide: type "title" — main topic as title, optional subtitle
3. Middle slides: type "content" — 4-6 bullet points in "points" array
4. You may include one "comparison" slide if it fits the topic
5. Last slide: type "closing" — strong ending or call-to-action. MUST include 3-4 "points" with icons (key takeaways or action steps) that animate on click, plus a subtitle as the final CTA line
6. Titles: max 8 words, clear and direct
7. Bullet points: max 10 words each, punchy and scannable

${buildPacingInstructions(pacing, 'designed')}

ICONS — VERY IMPORTANT:
- Every point MUST include an "icon" field with a SINGLE emoji that represents that point's meaning
- Choose meaningful, diverse emojis — do NOT repeat the same icon on the same slide
- Pick from visually clear emojis: 🎯 🚀 💡 ⭐ 🔑 📊 💰 🏆 ✅ 📈 🎓 🔒 ⚡ 🌟 💎 🎨 📱 🌍 🤝 📌 🔥 💪 🧠 📋 🛡️ ⏰ 🎉 🔧 💬 📣 🌱 🏗️ 📦 🎯 💻 🔍 📚 🧩 ⚙️ 🗺️
- Match the icon to the content — a point about money gets 💰, security gets 🔒, speed gets ⚡, etc.

READING LEVEL — IMPORTANT:
- ALL speaker notes MUST be written at a 5th grade reading level
- Use short sentences. Use simple words. Avoid jargon unless the topic requires it.
- Break complex ideas into small, easy-to-understand pieces.
- Write like you're explaining to someone who is smart but new to the topic.

${animationInstructions}

TONE: "${tone}"
- professional: Clean, clear business language. Still keep it at 5th grade reading level in notes.
- casual: Friendly and conversational. Like talking to a friend.
- creative: Vivid descriptions, colorful language, still simple and clear.
- academic: Can use topic-specific terms but explain them simply in notes.
- inspirational: Motivating, powerful short statements. Emotional and direct.
- technical: Precise terms allowed but notes should still be easy to follow.

QUALITY GUIDELINES:
- Notes should add value beyond what's on the slide — explain, give examples, tell stories
- Write notes in proper paragraphs with line breaks between ideas
- Stay inside the word budget above; that budget is what keeps the deck on time

${purpose && PURPOSE_INSTRUCTIONS[purpose] ? PURPOSE_INSTRUCTIONS[purpose] : ''}

Return the JSON object directly.`;

  try {
    const structure: PresentationStructure = await askClaudeForJson(systemPrompt, prompt);

    // Validate structure
    if (!structure.title || typeof structure.title !== 'string') {
      throw new Error('Claude response missing required "title" field');
    }

    if (!Array.isArray(structure.slides) || structure.slides.length === 0) {
      throw new Error('Claude response must include at least one slide');
    }

    // Validate each slide
    for (const slide of structure.slides) {
      if (!slide.type || !slide.title || !slide.speakerNotes) {
        throw new Error(
          'Each slide must have type, title, and speakerNotes fields'
        );
      }

      if (!['title', 'content', 'comparison', 'closing'].includes(slide.type)) {
        throw new Error(`Invalid slide type: ${slide.type}`);
      }

      if (typeof slide.title !== 'string' || slide.title.trim().length === 0) {
        throw new Error('Each slide must have a non-empty title');
      }

      if (typeof slide.speakerNotes !== 'string') {
        throw new Error('Each slide must have speakerNotes as a string');
      }

      if (slide.points && !Array.isArray(slide.points)) {
        throw new Error('Slide points must be an array');
      }

      // Normalize points: accept both string[] (legacy) and {text, icon}[] formats
      if (slide.points) {
        slide.points = slide.points.map((p: any) => {
          if (typeof p === 'string') {
            return { text: p, icon: '▪' };
          }
          if (typeof p === 'object' && p.text) {
            return { text: String(p.text), icon: p.icon || '▪' };
          }
          return { text: String(p), icon: '▪' };
        });
      }
    }

    return structure;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error calling Claude API: ${String(error)}`);
  }
}

// ─── FULL-SLIDE IMAGE DECK ───
// Plain-English palette hints so the generated art matches the chosen theme.
const THEME_PALETTES: Record<string, string> = {
  'navy-gold': 'deep navy blue, warm gold, soft cream highlights',
  'coral-energy': 'vivid coral red, warm gold, deep navy accents',
  'forest-green': 'deep forest green, fresh sage green, off-white light',
  'charcoal-minimal': 'charcoal grey, soft white, subtle black accents',
};

function getPalette(colorTheme: string): string {
  return THEME_PALETTES[colorTheme] || THEME_PALETTES['navy-gold'];
}

async function callClaudeForImageDeck(
  prompt: string,
  tone: string,
  numberOfSlides: number,
  pacing: Pacing,
  purpose?: string
): Promise<PresentationStructure> {
  const systemPrompt = `You are an expert visual storyteller who designs image-only presentations.

This deck has NO text on the slides. Every slide is ONE full-screen picture. The presenter reads a script from the presenter notes while the audience looks at the picture. Your job is to write that script and describe that picture for each slide.

CRITICAL: Return ONLY valid JSON. No markdown, no code blocks, no extra text.

JSON FORMAT:
{
  "title": "Presentation Title",
  "visualStyle": "One art-direction sentence that ALL images share",
  "slides": [
    {
      "type": "title|content|closing",
      "title": "Short internal label for this slide (never shown to the audience)",
      "speakerNotes": "The full word-for-word script the presenter says on this slide...",
      "imagePrompt": "A wide cinematic scene of..."
    }
  ]
}

SLIDE RULES:
1. Generate exactly ${numberOfSlides} slides total
2. First slide: type "title" — an opening image that sets up the topic
3. Middle slides: type "content" — one idea per slide, told in order
4. Last slide: type "closing" — an image that lands the ending or call to action
5. "title" is an internal label only (max 8 words) — it is NEVER printed on the slide

VISUAL STYLE — VERY IMPORTANT:
- "visualStyle" is a single sentence describing the look shared by every image (medium, lighting, mood, color feel)
- It keeps all ${numberOfSlides} images looking like one deck instead of ${numberOfSlides} random pictures
- Example: "Warm cinematic 3D illustration, soft rim lighting, shallow depth of field, calm confident mood"

IMAGE PROMPT RULES — VERY IMPORTANT:
- Every slide MUST include an "imagePrompt"
- Describe ONE clear, striking, wide 16:9 scene that carries the meaning of that slide on its own
- Write it as a vivid visual description: subject, setting, action, camera framing, mood
- Fill the whole frame — this image IS the slide, so no empty white backgrounds and no floating icons
- Keep each prompt under 70 words
- Absolutely NO text, words, letters, numbers, labels, charts with writing, logos, or UI in the image
- Each slide's image must be clearly different from the others — vary the subject and the camera angle
- Do NOT repeat the same scene with small changes

SPEAKER NOTES — THIS IS THE WHOLE SCRIPT:
- The notes carry 100% of the message, because the slide shows only a picture
- Write the exact words the presenter says out loud — a real script, not bullet points
- Write in spoken paragraphs with line breaks between ideas

${buildPacingInstructions(pacing, 'full-image')}

- Open the deck by greeting the audience and setting up the topic; close it with a clear ending or call to action
- Never write [CLICK], "next slide", "as you can see on this slide", or any stage direction
- Never refer to text on the screen — there is none. You may refer to the picture naturally ("the image behind me")

READING LEVEL — IMPORTANT:
- ALL speaker notes MUST be written at a 5th grade reading level
- Short sentences. Simple words. Break big ideas into small pieces.

TONE: "${tone}"
- professional: Clean, clear business language, still simple.
- casual: Friendly and conversational, like talking to a friend.
- creative: Vivid and colorful language, still simple and clear.
- academic: Topic terms allowed, but explain them simply.
- inspirational: Motivating, powerful, emotional and direct.
- technical: Precise terms allowed, but keep the script easy to follow.

${purpose && PURPOSE_INSTRUCTIONS[purpose] ? PURPOSE_INSTRUCTIONS[purpose] : ''}

Return the JSON object directly.`;

  const structure: PresentationStructure = await askClaudeForJson(systemPrompt, prompt);

  if (!structure.title || typeof structure.title !== 'string') {
    throw new Error('Claude response missing required "title" field');
  }

  if (!Array.isArray(structure.slides) || structure.slides.length === 0) {
    throw new Error('Claude response must include at least one slide');
  }

  for (const slide of structure.slides) {
    if (typeof slide.speakerNotes !== 'string' || slide.speakerNotes.trim().length === 0) {
      throw new Error('Each slide must have a non-empty speakerNotes script');
    }
    if (typeof slide.imagePrompt !== 'string' || slide.imagePrompt.trim().length === 0) {
      throw new Error('Each slide must have an imagePrompt');
    }
    if (!slide.title) slide.title = structure.title;
    // Image decks carry no on-slide text at all
    slide.points = undefined;
  }

  return structure;
}

/**
 * gpt-image only offers square and 3:2 sizes, so we ask for the widest one
 * (1536x1024) and centre-crop it to a true 16:9 frame. JPEG keeps the finished
 * .pptx small — a deck of full-bleed PNGs would be enormous.
 */
async function prepareFullSlideImage(b64: string): Promise<string> {
  try {
    const cropped = await sharp(Buffer.from(b64, 'base64'))
      .resize(1920, 1080, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
    return cropped.toString('base64');
  } catch (error) {
    console.error('16:9 crop failed, using original image:', error instanceof Error ? error.message : error);
    return b64;
  }
}

// Generate one full-bleed image per slide, a few at a time so we stay inside
// the image API's rate limits on bigger decks.
async function generateFullSlideImages(
  slides: SlideData[],
  visualStyle: string,
  palette: string,
  quality: 'low' | 'medium' | 'high'
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('OPENAI_API_KEY not set — skipping image generation');
    return;
  }

  const openai = new OpenAI({ apiKey });
  // Rapid-fire decks can run to 60 slides — widen the batch so a long deck
  // still finishes inside the request window.
  const BATCH_SIZE = slides.length > 20 ? 8 : 4;

  const renderSlide = async (slide: SlideData, index: number): Promise<void> => {
    if (!slide.imagePrompt) return;

    const fullPrompt = [
      slide.imagePrompt,
      visualStyle,
      `Color palette: ${palette}.`,
      'Wide 16:9 cinematic composition that fills the entire frame, edge to edge.',
      'Absolutely no text, no words, no letters, no numbers, no logos, no watermarks, no borders.',
    ].join(' ');

    // One retry — a single hiccup shouldn't leave a hole in the deck
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await openai.images.generate({
          model: 'gpt-image-1.5',
          prompt: fullPrompt,
          n: 1,
          size: '1536x1024',
          quality,
        });

        const b64 = response.data?.[0]?.b64_json;
        if (b64) {
          slide.imageData = await prepareFullSlideImage(b64);
          return;
        }
      } catch (error) {
        console.error(
          `Full-slide image error (slide ${index + 1}, attempt ${attempt + 1}):`,
          error instanceof Error ? error.message : error
        );
      }
    }
  };

  for (let i = 0; i < slides.length; i += BATCH_SIZE) {
    const batch = slides.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map((slide, j) => renderSlide(slide, i + j)));
  }
}

// ─── AI Image Generation (GPT Image 1.5) ───
async function generateSlideImages(
  slides: SlideData[],
  quality: 'low' | 'medium' | 'high'
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('OPENAI_API_KEY not set — skipping image generation');
    return;
  }

  const openai = new OpenAI({ apiKey });

  const renderSlide = async (slide: SlideData, index: number) => {
    if (!slide.imagePrompt) return;

    try {
      const response = await openai.images.generate({
        model: 'gpt-image-1.5',
        prompt: `${slide.imagePrompt}. Style: flat vector illustration, clean modern style, simple geometric shapes, vibrant colors, no text, no words, no letters, no numbers, presentation-ready graphic, white or transparent background.`,
        n: 1,
        size: '1024x1024',
        quality,
      });

      if (response.data && response.data[0]?.b64_json) {
        slide.imageData = response.data[0].b64_json;
      }
    } catch (error) {
      console.error(`Image generation error for slide ${index + 1}:`, error instanceof Error ? error.message : error);
      // Non-fatal: slide just won't have an image
    }
  };

  // Batched rather than all-at-once — a 60-slide deck would otherwise fire 60
  // image requests in one go and trip the rate limit.
  const BATCH_SIZE = 8;
  for (let i = 0; i < slides.length; i += BATCH_SIZE) {
    await Promise.all(slides.slice(i, i + BATCH_SIZE).map((slide, j) => renderSlide(slide, i + j)));
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Parse request body
    let body: GenerateRequest;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    // Validate request
    const validation = validateGenerateRequest(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { prompt, tone, slides, colorTheme, animations, purpose } = body;
    const deckType: DeckType = body.deckType || 'designed';
    const isImageDeck = deckType === 'full-image';
    // Full-slide image decks have nothing to animate — the slide is one picture
    const enableAnimations = !isImageDeck && animations === true;
    // How long each slide stays on screen → how many words the script gets
    const pacing = getPacing(body.secondsPerSlide ?? 30, slides);
    // Image spend never escalates by itself — default is the cheapest tier
    const imageQuality: ImageQuality = body.imageQuality ?? DEFAULT_IMAGE_QUALITY;
    const projectedImageCost = estimateImageCost(deckType, slides, imageQuality);

    // Which brain is writing this deck — makes it obvious in the logs whether
    // we're on the owner's Claude subscription or the API-key fallback.
    console.log(
      `Writing engine: ${usingSubscription() ? 'CLAUDE SUBSCRIPTION (claude CLI)' : 'ANTHROPIC API KEY (fallback)'}` +
      ` | deck=${deckType} slides=${slides} secondsPerSlide=${pacing.seconds} wordsPerSlide=${pacing.words}` +
      ` | images=${imageQuality} est.$${projectedImageCost.toFixed(2)}`
    );

    // Call Claude to generate structure
    let structure: PresentationStructure;
    try {
      structure = isImageDeck
        ? await callClaudeForImageDeck(prompt, tone, slides, pacing, purpose)
        : await callClaudeAPI(prompt, tone, slides, enableAnimations, pacing, purpose);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Claude API error:', errorMessage);
      return NextResponse.json(
        { error: `Failed to generate presentation: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Generate the AI artwork for each slide — unless the user asked for none
    if (imageQuality === 'none') {
      console.log('Image quality set to "none" — skipping image generation (no image spend)');
    } else {
      try {
        if (isImageDeck) {
          await generateFullSlideImages(
            structure.slides,
            structure.visualStyle || 'Clean modern cinematic illustration with soft lighting.',
            getPalette(colorTheme),
            imageQuality
          );
        } else {
          await generateSlideImages(structure.slides, imageQuality);
        }
        console.log(`Image generation complete: ${structure.slides.filter(s => s.imageData).length}/${structure.slides.length} slides have images`);
      } catch (error) {
        console.error('Image generation error (non-blocking):', error instanceof Error ? error.message : error);
        // Non-fatal: presentation will still generate without images
      }
    }

    // A full-image deck with no images is just blank slides — fail loudly instead
    if (isImageDeck && !structure.slides.some((s) => s.imageData)) {
      return NextResponse.json(
        { error: 'Failed to generate presentation: image generation is unavailable right now' },
        { status: 500 }
      );
    }

    // Generate PPTX
    let pptxBuffer: Buffer;
    try {
      pptxBuffer = isImageDeck
        ? await generateImagePptx(structure, colorTheme)
        : await generatePptx(structure, colorTheme, enableAnimations);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('PPTX generation error:', errorMessage);
      return NextResponse.json(
        { error: `Failed to generate PPTX: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Generate smart filename based on the presentation title
    const smartFilename = generateSmartFilename(structure.title);
    const baseDescription = generateDescription(prompt, structure.title);
    const description = isImageDeck
      ? `[Full-Slide Images] ${baseDescription}`
      : baseDescription;

    // Upload to R2 in the background (don't block the response)
    // We fire-and-forget for speed — the file is also returned directly to the user
    const r2UploadPromise = (async () => {
      try {
        // Check if R2 is configured
        if (!process.env.R2_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
          console.log('R2 not configured — skipping cloud save');
          return null;
        }

        const { key, size } = await uploadToR2(pptxBuffer, smartFilename, {
          title: structure.title,
          prompt: prompt.substring(0, 200),
          tone: tone,
          slides: String(slides),
        });

        // Save metadata to Supabase (using service role to bypass RLS since
        // the request may not have auth headers for anonymous users)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (supabaseUrl && supabaseServiceKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

          // Try to get the user from the auth cookie
          const authHeader = request.headers.get('cookie') || '';
          let userId: string | null = null;

          // Parse the Supabase auth token from cookies
          // Supabase stores cookies in format: sb-<project>-auth-token=base64-<base64json>
          // where the JSON is {access_token, refresh_token, ...} or legacy [access_token, refresh_token]
          const tokenMatch = authHeader.match(/sb-[^=]+-auth-token[^=]*=([^;]+)/);
          if (tokenMatch) {
            try {
              let tokenValue = decodeURIComponent(tokenMatch[1]);

              // Handle base64- prefix (newer Supabase format)
              if (tokenValue.startsWith('base64-')) {
                tokenValue = Buffer.from(tokenValue.substring(7), 'base64').toString('utf-8');
              }

              // Try to parse as JSON
              try {
                const parsed = JSON.parse(tokenValue);
                if (Array.isArray(parsed) && parsed[0]) {
                  // Legacy format: [access_token, refresh_token]
                  tokenValue = parsed[0];
                } else if (parsed && typeof parsed === 'object' && parsed.access_token) {
                  // New format: {access_token, refresh_token, ...}
                  tokenValue = parsed.access_token;
                }
              } catch {
                // Not JSON, use as-is
              }
              const { data: { user } } = await supabaseAdmin.auth.getUser(tokenValue);
              if (user) userId = user.id;
            } catch {
              // Ignore auth errors — just won't save to user's account
            }
          }

          if (userId) {
            // Calculate expiration: 25 days from now
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 25);

            await supabaseAdmin.from('aideck_saved_presentations').insert({
              user_id: userId,
              filename: smartFilename,
              r2_key: key,
              file_size: size,
              title: structure.title,
              description: description,
              slide_count: slides,
              tone: tone,
              color_theme: colorTheme,
              expires_at: expiresAt.toISOString(),
            });
          }
        }

        return { key, size };
      } catch (r2Error) {
        console.error('R2 upload error (non-blocking):', r2Error);
        return null;
      }
    })();

    // Don't wait for R2 upload — let it happen in background
    // But give it a small window to complete (for the metadata to be saved)
    // Use waitUntil-style pattern: we await with a timeout
    const r2WithTimeout = Promise.race([
      r2UploadPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);

    await r2WithTimeout;

    // Return the PPTX file as a Blob with the smart filename
    const uint8Array = new Uint8Array(pptxBuffer);
    const blob = new Blob([uint8Array], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });

    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${smartFilename}"`,
        'X-Presentation-Title': encodeURIComponent(structure.title),
        'X-Presentation-Filename': encodeURIComponent(smartFilename),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('API error:', errorMessage);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
