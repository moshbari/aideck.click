import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { generatePptx } from '@/lib/generate-pptx';
import { GenerateRequest, PresentationStructure, SlideData } from '@/lib/types';
import { uploadToR2, generateSmartFilename, generateDescription } from '@/lib/r2';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 120;

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

async function callClaudeAPI(
  prompt: string,
  tone: string,
  numberOfSlides: number,
  animations: boolean,
  purpose?: string
): Promise<PresentationStructure> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }

  const anthropic = new Anthropic({ apiKey });

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
- Each slide should have substantial speaker notes (3-8 sentences minimum)
- Notes should add value beyond what's on the slide — explain, give examples, tell stories
- The presenter should be able to present for 1-2 minutes per slide using just the notes
- Write notes in proper paragraphs with line breaks between ideas

${purpose && PURPOSE_INSTRUCTIONS[purpose] ? PURPOSE_INSTRUCTIONS[purpose] : ''}

Return the JSON object directly.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system: systemPrompt,
    });

    // Check if response was truncated
    if (message.stop_reason === 'max_tokens') {
      throw new Error('Response was truncated — try generating fewer slides or disabling animations');
    }

    // Extract text content from the response
    const responseText = message.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as any).text)
      .join('');

    // Strip markdown code fences if present (e.g. ```json ... ```)
    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('```')) {
      cleanedText = cleanedText.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    // Parse the JSON response
    let structure: PresentationStructure;
    try {
      structure = JSON.parse(cleanedText);
    } catch (parseError) {
      throw new Error(`Failed to parse Claude response as JSON: ${cleanedText.substring(0, 200)}`);
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

// ─── DALL-E Image Generation ───
async function generateSlideImages(slides: SlideData[]): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('OPENAI_API_KEY not set — skipping image generation');
    return;
  }

  const openai = new OpenAI({ apiKey });

  // Generate images for all slides in parallel
  const imagePromises = slides.map(async (slide, index) => {
    if (!slide.imagePrompt) return;

    try {
      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt: `${slide.imagePrompt}. Style: flat vector illustration, clean modern style, simple geometric shapes, vibrant colors, no text, no words, no letters, no numbers, presentation-ready graphic, white or transparent background.`,
        n: 1,
        size: '1024x1024',
        response_format: 'b64_json',
        quality: 'standard',
      });

      if (response.data && response.data[0]?.b64_json) {
        slide.imageData = response.data[0].b64_json;
      }
    } catch (error) {
      console.error(`DALL-E error for slide ${index + 1}:`, error instanceof Error ? error.message : error);
      // Non-fatal: slide just won't have an image
    }
  });

  await Promise.all(imagePromises);
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
    const enableAnimations = animations === true;

    // Call Claude to generate structure
    let structure: PresentationStructure;
    try {
      structure = await callClaudeAPI(prompt, tone, slides, enableAnimations, purpose);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Claude API error:', errorMessage);
      return NextResponse.json(
        { error: `Failed to generate presentation: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Generate AI images for each slide (DALL-E)
    try {
      await generateSlideImages(structure.slides);
      console.log(`Image generation complete: ${structure.slides.filter(s => s.imageData).length}/${structure.slides.length} slides have images`);
    } catch (error) {
      console.error('Image generation error (non-blocking):', error instanceof Error ? error.message : error);
      // Non-fatal: presentation will still generate without images
    }

    // Generate PPTX
    let pptxBuffer: Buffer;
    try {
      pptxBuffer = await generatePptx(structure, colorTheme, enableAnimations);
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
    const description = generateDescription(prompt, structure.title);

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
