import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { generatePptx } from '@/lib/generate-pptx';
import { GenerateRequest, PresentationStructure } from '@/lib/types';

export const maxDuration = 60;

// Color themes that are supported
const VALID_THEMES = ['navy-gold', 'coral-energy', 'forest-green', 'charcoal-minimal'];

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

  const { prompt, tone, slides, colorTheme } = body;

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

  // Validate slides
  if (!Number.isInteger(slides) || slides < 3 || slides > 20) {
    return { valid: false, error: 'slides must be an integer between 3 and 20' };
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

async function callClaudeAPI(
  prompt: string,
  tone: string,
  numberOfSlides: number
): Promise<PresentationStructure> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  const anthropic = new Anthropic({ apiKey });

  const systemPrompt = `You are an expert presentation designer. Your task is to create a structured presentation outline based on the user's prompt.

IMPORTANT REQUIREMENTS:
1. Return ONLY valid JSON with no markdown formatting, no code blocks, no extra text
2. The JSON must contain a "title" field and a "slides" array
3. Each slide must have: type, title, speakerNotes (required fields)
4. Optional fields: subtitle, points
5. Valid slide types: "title", "content", "comparison", "closing"
6. Keep titles concise (max 8 words for slide titles)
7. Keep bullet points short (max 8 words each)
8. Write natural speaker notes that include [CLICK] cues for transitions
9. Adjust reading level and vocabulary to match the tone: "${tone}"

STRUCTURE GUIDELINES:
- First slide must be type "title" with main topic as title
- Middle slides should be type "content" with 4-6 bullet points in the "points" array
- Include one "comparison" slide if appropriate
- Last slide must be type "closing" with a call-to-action

TONE SPECIFICS (Reading Level):
- professional: Business language, industry terms acceptable, 10th grade+
- casual: Conversational, accessible language, 8th grade level
- academic: Formal, technical depth, specialized terminology, college level
- creative: Imaginative, engaging descriptions, varied sentence structure
- inspirational: Motivational language, powerful statements, uplifting tone
- technical: Precise terminology, detailed explanations, expert audience

Generate exactly ${numberOfSlides} slides total.

Return the JSON object directly with no additional text.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system: systemPrompt,
    });

    // Extract text content from the response
    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('');

    // Parse the JSON response
    let structure: PresentationStructure;
    try {
      structure = JSON.parse(responseText);
    } catch (parseError) {
      throw new Error(`Failed to parse Claude response as JSON: ${responseText.substring(0, 200)}`);
    }

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
    }

    return structure;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error calling Claude API: ${String(error)}`);
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

    const { prompt, tone, slides, colorTheme } = body;

    // Call Claude to generate structure
    let structure: PresentationStructure;
    try {
      structure = await callClaudeAPI(prompt, tone, slides);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Claude API error:', errorMessage);
      return NextResponse.json(
        { error: `Failed to generate presentation: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Generate PPTX
    let pptxBuffer: Buffer;
    try {
      pptxBuffer = await generatePptx(structure, colorTheme);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('PPTX generation error:', errorMessage);
      return NextResponse.json(
        { error: `Failed to generate PPTX: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Return the PPTX file as a Blob
    const uint8Array = new Uint8Array(pptxBuffer);
    const blob = new Blob([uint8Array], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    });

    return new NextResponse(blob, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="presentation.pptx"',
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
