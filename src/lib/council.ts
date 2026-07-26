import { askClaudeForJson } from './claude-cli';
import { DeckType, Pacing, PresentationStructure, SlideData, SlidePoint } from './types';

/**
 * THE DECK COUNCIL
 *
 * One prompt in, one deck out, with nobody checking the work is how you get a
 * deck that reads fine and lands nothing. So the work goes through the people
 * you'd actually hire:
 *
 *   Strategist  → who's in the room and what must change by the end
 *   Architect   → the beat sheet: what job each slide does, in order
 *   Scriptwriter → the spoken words, to the second
 *   Art Director → the look and every image prompt   (parallel with the writer)
 *   Timekeeper  → CODE, not AI: counts words, slides, bullets — facts only
 *   Coach       → adversarial read: does this land the objective?
 *   Reviser     → applies the Coach's fixes and the Timekeeper's defects
 *
 * The split between Timekeeper and Coach is the important bit. Counting is a
 * fact, so code does it — instantly, free, and it never hallucinates. That
 * leaves the Coach's whole attention for judgment.
 */

export type PhaseKey =
  | 'strategy'
  | 'structure'
  | 'writing'
  | 'art'
  | 'review'
  | 'revising'
  | 'done';

export interface CouncilProgress {
  phase: PhaseKey;
  detail?: string;
}

export type ProgressFn = (p: CouncilProgress) => void;

export interface CouncilInput {
  prompt: string;
  tone: string;
  slideCount: number;
  pacing: Pacing;
  deckType: DeckType;
  animations: boolean;
  purpose?: string;
  purposeInstructions?: string;
  needsImages: boolean;
  paletteHint: string | null;
}

interface Strategy {
  audience: string;
  situation: string;
  objective: string;
  oneAction: string;
  promise: string;
  objections: string[];
  throughLine: string;
  mustInclude: string[];
  mustAvoid: string[];
  /**
   * The voice the user asked for — a named author, a storytelling tradition, a
   * house style, a language mix. Empty when they didn't ask for one.
   *
   * This exists because a brief saying "write it like Humayun Ahmed's Himu"
   * used to be steamrollered by the writer's default "5th grade reading level,
   * short sentences, simple words" rule. A requested voice now outranks it.
   */
  voice: string;
  language: string;
}

interface Beat {
  n: number;
  type: string;
  job: string;
  headline: string;
  says: string;
}

// ─────────────────────────── shared prompt pieces ───────────────────────────

const JSON_RULE = `Return ONLY valid JSON wrapped in <json></json> tags. No markdown, no commentary.`;

function briefBlock(input: CouncilInput): string {
  return [
    `THE BRIEF (the user's own words — their instructions are binding):`,
    input.prompt,
    ``,
    `SETTINGS THE USER CHOSE (these are fixed, never change them):`,
    `- Deck type: ${input.deckType === 'full-image' ? 'FULL-SLIDE IMAGE (no text on any slide; the script carries everything)' : 'DESIGNED TEXT SLIDES (headlines and bullets on screen)'}`,
    `- Exactly ${input.slideCount} slides`,
    `- Each slide is on screen for ${input.pacing.seconds} seconds`,
    `- Tone: ${input.tone}`,
    input.purpose ? `- Purpose: ${input.purpose}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// ───────────────────────────── 1. The Strategist ─────────────────────────────

async function runStrategist(input: CouncilInput): Promise<Strategy> {
  const system = `You are a presentation strategist. Before anyone writes a word, you decide what this deck is FOR.

You are handed a brief. You work out who is in the room, what they currently believe, and what has to be true by the last slide. You are blunt and specific — no generic "raise awareness" answers.

${JSON_RULE}

JSON SHAPE:
{
  "audience": "who is in the room, in one specific sentence",
  "situation": "what they believe or are doing right now, before this deck",
  "objective": "the ONE thing that must change in their head by the last slide",
  "oneAction": "the single action you want them to take, in their words",
  "promise": "what the deck promises them in one plain sentence",
  "objections": ["the real reasons they will resist, 2-4 of them"],
  "throughLine": "the single argument the whole deck makes, in one sentence",
  "mustInclude": ["anything the user's brief explicitly demands — quote their requirements"],
  "mustAvoid": ["anything the user's brief forbids, plus traps for this audience"],
  "voice": "the writing voice or style the user asked for, described richly enough for a writer to reproduce it — or \"\" if they asked for none",
  "language": "the language(s) the script must be written in, exactly as the user asked — or \"\" if they didn't say"
}

RULES:
- If the user's brief names rules (words to use or avoid, currency, specific stories, exact wording), copy them into mustInclude / mustAvoid word for word. They are not suggestions.
- Speak plainly. No marketing jargon.

THE VOICE FIELD — GET THIS RIGHT, IT IS OFTEN WHAT THEY CARE ABOUT MOST:
- If the brief names an author, a book, a character, a genre or a house style, capture it and then DESCRIBE what that voice actually does on the page: sentence rhythm, humour, how it handles silence, what it never does.
- Example: "Humayun Ahmed's Himu voice — unhurried, deceptively simple sentences; dry deadpan humour; the narrator notices small ordinary details and lets them carry the weight; philosophical asides dropped without ceremony; never sentimental, never explains the joke."
- If the brief asks for a language mix (Bangla + English, Banglish, Hinglish), say exactly how it should be mixed and in which script.
- Do not flatten a literary request into "engaging and conversational". That is how a request for a real voice gets lost.`;

  return askClaudeForJson(system, briefBlock(input));
}

// ───────────────────────────── 2. The Architect ──────────────────────────────

async function runArchitect(input: CouncilInput, strategy: Strategy): Promise<{ title: string; beats: Beat[] }> {
  const closingType = 'closing';
  const system = `You are a presentation architect. You do not write the script. You decide what each slide is FOR and in what order, so the argument actually builds.

${JSON_RULE}

JSON SHAPE:
{
  "title": "the deck's title",
  "beats": [
    { "n": 1, "type": "title", "job": "hook", "headline": "max 8 words", "says": "one line on what this slide covers" }
  ]
}

RULES:
1. EXACTLY ${input.slideCount} beats. Not one more, not one fewer.
2. Beat 1 is type "title". The last beat is type "${closingType}" and carries the call to action.
3. Middle beats are type "content". At most one may be "comparison".
4. Every beat has a DIFFERENT job. If two beats do the same job, cut one and do something else.
5. Each slide is only on screen for ${input.pacing.seconds} seconds — so each beat carries ONE idea, sized to that.
6. The beats together must make the through-line argument and answer the objections along the way.
7. "headline" is what a viewer would see as the slide title — max 8 words, concrete, no colons.`;

  const user = [
    briefBlock(input),
    ``,
    `THE STRATEGIST'S DECISION:`,
    JSON.stringify(strategy),
    ``,
    `Lay out exactly ${input.slideCount} beats that get this audience from where they are to "${strategy.oneAction}".`,
  ].join('\n');

  return askClaudeForJson(system, user);
}

// ──────────────────────────── 3. The Scriptwriter ────────────────────────────

function pacingRules(input: CouncilInput): string {
  const p = input.pacing;
  const lines = [
    `THE CLOCK — THIS IS A HARD RULE:`,
    `- Every slide is on screen for exactly ${p.seconds} seconds.`,
    `- So every slide's speakerNotes must be about ${p.words} words — never fewer than ${p.minWords}, never more than ${p.maxWords}.`,
    `- ${p.words} words is what a presenter actually says out loud in ${p.seconds} seconds. Count them.`,
  ];
  if (input.deckType === 'designed') {
    const maxPoints = p.seconds <= 10 ? 3 : p.seconds <= 25 ? 4 : 6;
    lines.push(
      `- On-screen bullets: at most ${maxPoints} per slide. Nobody reads more than that in ${p.seconds} seconds.`,
      `- Each bullet is max 10 words. Each title is max 8 words.`
    );
  }
  return lines.join('\n');
}

/**
 * The voice instruction handed to the writer.
 *
 * When the user asked for a specific voice, it wins outright — including over
 * the plain-language default, which is right for a sales deck and completely
 * wrong for a literary one. When they didn't ask for a voice, we keep the
 * simple, spoken register that suits most presentations.
 */
function voiceBlock(strategy: Strategy): string {
  const voice = String(strategy?.voice || '').trim();
  const language = String(strategy?.language || '').trim();

  if (!voice && !language) {
    return `READING LEVEL:
- 5th grade reading level. Short sentences. Simple words. Nothing show-offy.`;
  }

  return [
    `THE VOICE — THIS IS THE POINT OF THE WHOLE DECK. HONOUR IT ABOVE EVERY STYLE DEFAULT:`,
    voice ? `- ${voice}` : '',
    language ? `- LANGUAGE: ${language}. Write in exactly that language and script, consistently, from the first slide to the last. Never drift into another script halfway through.` : '',
    `- Do NOT flatten this into simple, generic, "easy-to-read" prose. There is no 5th grade reading level rule on this deck — the requested voice replaces it.`,
    `- Write it the way that author or style would actually write it, at full quality. Rhythm, humour, restraint and word choice all matter more than simplicity here.`,
    `- If the voice and plainness ever conflict, the voice wins.`,
  ]
    .filter(Boolean)
    .join('\n');
}

// A 30-slide deck written in one call is slow and fragile. Past this size the
// beat sheet is split and the batches are written side by side.
const WRITE_CHUNK = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function runScriptwriter(
  input: CouncilInput,
  strategy: Strategy,
  beats: Beat[]
): Promise<{ slides: any[] }> {
  // Long decks get written in parallel batches — same instructions, a slice of
  // the beat sheet each, so wall-clock stays flat as slide count grows.
  if (beats.length > WRITE_CHUNK) {
    const batches = chunk(beats, WRITE_CHUNK);
    const results = await Promise.all(
      batches.map((slice) => writeSlides(input, strategy, beats, slice))
    );
    return { slides: results.flatMap((r) => r?.slides || []) };
  }
  return writeSlides(input, strategy, beats, beats);
}

async function writeSlides(
  input: CouncilInput,
  strategy: Strategy,
  allBeats: Beat[],
  beats: Beat[]
): Promise<{ slides: any[] }> {
  const isImage = input.deckType === 'full-image';

  const shape = isImage
    ? `{ "slides": [ { "n": 1, "title": "internal label, never shown", "speakerNotes": "the exact words the presenter says" } ] }`
    : `{ "slides": [ { "n": 1, "type": "title", "title": "max 8 words", "subtitle": "optional", "points": [ { "text": "max 10 words", "icon": "🎯" } ], "speakerNotes": "the exact words the presenter says" } ] }`;

  const system = `You are the scriptwriter. The architect handed you a beat sheet. You write what the presenter actually SAYS.

${JSON_RULE}

JSON SHAPE:
${shape}

${pacingRules(input)}

${voiceBlock(strategy)}

HOW TO WRITE THE SPOKEN SCRIPT:
- Write the real words, out loud, as a person speaks — not bullet points, not an essay.
- Every slide's script must do its beat's JOB. If the beat says "handle the price objection", handle it.
- Never say "as you can see on this slide" or "next slide" or "[CLICK]".
- The last slide ends on the call to action, in the audience's own language.
${
  isImage
    ? `- There is NO text on these slides — the audience sees only a picture, so the script carries 100% of the meaning. You may refer to the picture naturally.`
    : `- Bullets are what the audience READS; the script is what they HEAR. They must not be the same words.
- Every bullet needs a meaningful emoji icon. Never repeat an icon on the same slide.`
}
${input.animations && !isImage ? `- Animations are on: put [CLICK] before each new point's talking beat in the notes.` : ''}

THE USER'S OWN RULES OVERRIDE EVERYTHING except the word budget:
${strategy.mustInclude.length ? strategy.mustInclude.map((r) => `- MUST: ${r}`).join('\n') : '- (none given)'}
${strategy.mustAvoid.length ? strategy.mustAvoid.map((r) => `- NEVER: ${r}`).join('\n') : ''}

${input.purposeInstructions || ''}`;

  const isSlice = beats.length !== allBeats.length;
  const user = [
    briefBlock(input),
    ``,
    `STRATEGY:`,
    JSON.stringify(strategy),
    ``,
    isSlice
      ? `THE FULL RUNNING ORDER (for context only — so your part flows with the rest):\n${JSON.stringify(
          allBeats.map((b) => ({ n: b.n, headline: b.headline }))
        )}`
      : '',
    ``,
    `THE BEAT SHEET — write one slide per beat, in this order:`,
    JSON.stringify(beats),
    ``,
    isSlice
      ? `Write ONLY these ${beats.length} slides (numbers ${beats[0].n} to ${beats[beats.length - 1].n}). Keep each slide's "n" exactly as given.`
      : `Write all ${input.slideCount} slides.`,
  ]
    .filter(Boolean)
    .join('\n');

  return askClaudeForJson(system, user);
}

// ──────────────────────────── 4. The Art Director ────────────────────────────

async function runArtDirector(
  input: CouncilInput,
  strategy: Strategy,
  beats: Beat[]
): Promise<{ visualStyle: string; images: { n: number; imagePrompt: string }[] }> {
  // Long decks: art direct in parallel batches too. The first batch sets the
  // visual style and the rest inherit it, so the deck still looks like one set.
  if (beats.length > WRITE_CHUNK) {
    const batches = chunk(beats, WRITE_CHUNK);
    const first = await directArt(input, strategy, batches[0], null);
    const rest = await Promise.all(
      batches.slice(1).map((slice) => directArt(input, strategy, slice, first?.visualStyle || null))
    );
    return {
      visualStyle: first?.visualStyle || '',
      images: [first, ...rest].flatMap((r) => r?.images || []),
    };
  }
  return directArt(input, strategy, beats, null);
}

async function directArt(
  input: CouncilInput,
  strategy: Strategy,
  beats: Beat[],
  lockedStyle: string | null
): Promise<{ visualStyle: string; images: { n: number; imagePrompt: string }[] }> {
  const isImage = input.deckType === 'full-image';

  const system = `You are the art director for this deck. You decide how it LOOKS and you write the prompt for every picture.

${JSON_RULE}

JSON SHAPE:
{
  "visualStyle": "one sentence of art direction every image shares — medium, lighting, mood",
  "images": [ { "n": 1, "imagePrompt": "the scene for this slide" } ]
}

RULES:
1. Exactly ${beats.length} entries in "images", one per beat given to you, in order. Keep each "n" exactly as given.
2. ${
    lockedStyle
      ? `"visualStyle" is ALREADY DECIDED for this deck — return it back word for word: "${lockedStyle}". Every image you write must obey it.`
      : `"visualStyle" is what makes ${input.slideCount} pictures look like ONE deck instead of ${input.slideCount} unrelated stock photos. Be specific: medium, lighting, mood.`
  }
3. Each imagePrompt describes ONE clear scene that carries that beat's meaning: subject, setting, action, framing.
4. NO text, words, letters, numbers, logos or watermarks in any image — ever.
5. Every image must be visibly different from the others. Vary subject and camera angle. Never the same scene twice.
${
  isImage
    ? `6. These images ARE the slides — full-bleed 16:9, filling the frame. No empty white backgrounds, no floating icons. Under 70 words each.`
    : `6. These are small supporting illustrations beside text — flat vector, clean, simple shapes, on a plain background. Under 60 words each.`
}
${input.paletteHint ? `7. Colour direction: ${input.paletteHint}` : `7. Choose colours that suit the subject. You are not restricted to any palette.`}`;

  const user = [
    briefBlock(input),
    ``,
    `STRATEGY:`,
    JSON.stringify({ audience: strategy.audience, objective: strategy.objective, throughLine: strategy.throughLine }),
    ``,
    `THE BEAT SHEET:`,
    JSON.stringify(beats),
    ``,
    `Art direct these ${beats.length} slides (numbers ${beats[0].n} to ${beats[beats.length - 1].n}).`,
  ].join('\n');

  return askClaudeForJson(system, user);
}

// ───────────────────────── 5. The Timekeeper (code) ──────────────────────────

/**
 * Facts, not opinions. Counting words is something code should do — it's
 * instant, free, and it can't hallucinate. Anything this finds is handed to the
 * Reviser verbatim, so "make it tighter" becomes "slide 3 is 47 words, budget
 * is 17".
 */
export interface Defect {
  slide: number | null;
  message: string;
}

export function runTimekeeper(
  structure: PresentationStructure,
  input: CouncilInput
): Defect[] {
  const defects: Defect[] = [];
  const push = (slide: number | null, message: string) => defects.push({ slide, message });
  const p = input.pacing;
  const isImage = input.deckType === 'full-image';
  const maxPoints = p.seconds <= 10 ? 3 : p.seconds <= 25 ? 4 : 6;

  if (!Array.isArray(structure.slides)) return [{ slide: null, message: 'The deck has no slides at all.' }];

  if (structure.slides.length !== input.slideCount) {
    push(
      null,
      `The deck has ${structure.slides.length} slides but the user asked for exactly ${input.slideCount}. Add or remove slides to hit ${input.slideCount}.`
    );
  }

  structure.slides.forEach((slide, i) => {
    const n = i + 1;
    const words = String(slide.speakerNotes || '').trim().split(/\s+/).filter(Boolean).length;

    if (words === 0) {
      push(n, `Slide ${n} has no speaker notes at all. Write ${p.words} words of script.`);
    } else if (words > p.maxWords) {
      push(
        n,
        `Slide ${n} script is ${words} words — too long to say in ${p.seconds} seconds. Cut it to about ${p.words} words (hard max ${p.maxWords}).`
      );
    } else if (words < p.minWords) {
      push(
        n,
        `Slide ${n} script is only ${words} words — it leaves dead air in a ${p.seconds}-second slide. Grow it to about ${p.words} words.`
      );
    }

    if (!isImage) {
      const titleWords = String(slide.title || '').trim().split(/\s+/).filter(Boolean).length;
      if (titleWords > 8) {
        push(n, `Slide ${n} title is ${titleWords} words. Titles are max 8 words.`);
      }
      const points = (slide.points || []) as SlidePoint[];
      if (points.length > maxPoints) {
        push(
          n,
          `Slide ${n} has ${points.length} bullets — nobody reads that in ${p.seconds} seconds. Cut to ${maxPoints} or fewer.`
        );
      }
      points.forEach((pt, j) => {
        const bw = String(pt?.text || '').trim().split(/\s+/).filter(Boolean).length;
        if (bw > 10) push(n, `Slide ${n} bullet ${j + 1} is ${bw} words. Bullets are max 10 words.`);
      });
    }

    if (input.needsImages && !String(slide.imagePrompt || '').trim()) {
      push(n, `Slide ${n} has no image prompt.`);
    }
  });

  // The deck has to end on the ask
  const last = structure.slides[structure.slides.length - 1];
  if (last) {
    const closingText = `${last.subtitle || ''} ${(last.points || []).map((x: any) => x?.text).join(' ')} ${last.speakerNotes || ''}`;
    if (closingText.trim().length < 10) {
      push(structure.slides.length, 'The last slide has no call to action. End on the one action the audience should take.');
    }
  }

  return defects;
}

// ─────────────────────────────── 6. The Coach ────────────────────────────────

interface CoachVerdict {
  score: number;
  verdict: string;
  fixes: { slide: number; problem: string; fix: string }[];
}

function compactDeck(structure: PresentationStructure): string {
  return JSON.stringify({
    title: structure.title,
    slides: structure.slides.map((s, i) => ({
      n: i + 1,
      title: s.title,
      subtitle: s.subtitle,
      points: (s.points || []).map((p: any) => p?.text),
      speakerNotes: s.speakerNotes,
    })),
  });
}

async function runCoach(
  input: CouncilInput,
  strategy: Strategy,
  structure: PresentationStructure,
  defects: Defect[]
): Promise<CoachVerdict> {
  const system = `You are a hard-nosed presentation coach. You have watched a thousand decks die in the room. You review this one before it ships.

You are NOT here to be encouraging. You are here to find what will fail in front of a live audience.

${JSON_RULE}

JSON SHAPE:
{
  "score": 0-10,
  "verdict": "one blunt sentence on whether this lands the objective",
  "fixes": [ { "slide": 3, "problem": "what is wrong", "fix": "the specific change to make" } ]
}

WHAT TO LOOK FOR — in this order:
1. Does the deck actually achieve the objective, or does it just describe the topic?
2. Does any slide repeat another, or earn no place? Say which one to cut or change.
3. Is the ask on the last slide unmistakable, in the audience's own language?
4. Are the objections answered anywhere, or ignored?
5. Are there invented statistics or made-up specifics? Flag every number that nothing supports.
6. Did the writer break any of the user's own rules? Those rules are binding.
7. Is anything vague, corporate, or jargon-filled where it should be plain?
8. THE VOICE: if a specific voice or style was requested, does the script genuinely read like it — or is it generic prose wearing that name? Judge it as someone who knows that author's work. Say which slides fall out of voice and how.
9. LANGUAGE: if a language or language-mix was requested, is it used consistently and at real fluency, in one script throughout? Flag any slide that drifts, transliterates inconsistently, or reads like translated filler.

RULES:
- Do NOT count words or bullets. That was already checked by machine — the results are given to you.
- Every fix must name a slide number and be specific enough to act on without thinking.
- If a slide is genuinely fine, do not invent a fix for it. An honest short list beats a padded one.
- Score honestly. 10 means you would put your name on it.`;

  const user = [
    briefBlock(input),
    ``,
    `WHAT THIS DECK IS SUPPOSED TO DO:`,
    JSON.stringify(strategy),
    ``,
    `THE DRAFT:`,
    compactDeck(structure),
    ``,
    defects.length
      ? `THE MACHINE ALREADY FOUND THESE (dont repeat them, theyre being fixed):\n- ${defects.map((d) => d.message).join('\n- ')}`
      : `The machine check found no timing or length problems.`,
    ``,
    `Review it.`,
  ].join('\n');

  return askClaudeForJson(system, user);
}

// ────────────────────────────── 7. The Reviser ───────────────────────────────

/**
 * Only the broken slides get rewritten.
 *
 * Asking for the whole deck back on a 30-slide run is slow, risks the model
 * quietly changing slides nobody complained about, and was the main reason a
 * long deck took 13 minutes. We send the offending slides plus their
 * neighbours for context, and splice the answers back in by slide number.
 */
async function runReviser(
  input: CouncilInput,
  strategy: Strategy,
  structure: PresentationStructure,
  defects: Defect[],
  fixes: CoachVerdict['fixes']
): Promise<PresentationStructure> {
  const isImage = input.deckType === 'full-image';

  // Which slides actually need attention?
  const targets = new Set<number>();
  defects.forEach((d) => {
    if (d.slide) targets.add(d.slide);
  });
  fixes.forEach((f) => {
    const n = Number(f?.slide);
    if (Number.isFinite(n) && n >= 1 && n <= structure.slides.length) targets.add(n);
  });

  // A structural complaint with no slide number means everything is in play
  const wholeDeck = defects.some((d) => d.slide === null) || targets.size === 0;
  const slideNumbers = wholeDeck
    ? structure.slides.map((_, i) => i + 1)
    : Array.from(targets).sort((a, b) => a - b);

  const shape = isImage
    ? `{ "slides": [ { "n": 1, "title": "internal label", "speakerNotes": "..." } ] }`
    : `{ "slides": [ { "n": 1, "type": "title", "title": "...", "subtitle": "...", "points": [ { "text": "...", "icon": "🎯" } ], "speakerNotes": "..." } ] }`;

  const system = `You are the reviser. The coach and the machine check found problems. You fix them — all of them — and change nothing else.

${JSON_RULE}

JSON SHAPE — return ONLY the slides you were asked to fix, with their "n" unchanged:
${shape}

${pacingRules(input)}

${voiceBlock(strategy)}

RULES:
- Fix every item on both lists. Do not argue with them.
- Return exactly the slides listed as YOURS TO FIX — no others, no extras.
- Keep each slide's "n" exactly as given so it drops back into the right place.
- Keep the voice above intact — fixing a slide must never flatten it.
- The user's own rules still override everything: ${[...strategy.mustInclude, ...strategy.mustAvoid.map((a) => `never ${a}`)].join('; ') || '(none)'}`;

  const user = [
    `THE DECK AS IT STANDS (for context):`,
    compactDeck(structure),
    ``,
    `YOURS TO FIX — slides ${slideNumbers.join(', ')}:`,
    defects.length ? `MACHINE CHECK FOUND:\n- ${defects.map((d) => d.message).join('\n- ')}` : '',
    fixes.length
      ? `THE COACH FOUND:\n${fixes.map((f) => `- Slide ${f.slide}: ${f.problem} → ${f.fix}`).join('\n')}`
      : '',
    ``,
    `Return the fixed versions of slides ${slideNumbers.join(', ')} only.`,
  ]
    .filter(Boolean)
    .join('\n');

  const revised = await askClaudeForJson(system, user);

  // Splice the fixed slides back over the originals, by number
  const byNumber = new Map<number, any>();
  (revised?.slides || []).forEach((s: any, i: number) => {
    const n = Number(s?.n) || slideNumbers[i];
    if (n) byNumber.set(n, s);
  });

  const merged = structure.slides.map((original, i) => {
    const replacement = byNumber.get(i + 1);
    if (!replacement) return original;
    return {
      ...original,
      title: replacement.title ? String(replacement.title) : original.title,
      subtitle: replacement.subtitle ? String(replacement.subtitle) : original.subtitle,
      points: isImage ? undefined : normalizePoints(replacement.points) || original.points,
      speakerNotes: replacement.speakerNotes ? String(replacement.speakerNotes) : original.speakerNotes,
    } as SlideData;
  });

  return { ...structure, slides: merged };
}

// ─────────────────────────────── assembly ────────────────────────────────────

function normalizePoints(raw: any): SlidePoint[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map((p: any) => {
      if (typeof p === 'string') return { text: p, icon: '▪' };
      if (p && typeof p === 'object' && p.text) return { text: String(p.text), icon: p.icon || '▪' };
      return null;
    })
    .filter(Boolean) as SlidePoint[];
}

function assemble(
  input: CouncilInput,
  title: string,
  beats: Beat[],
  written: { slides: any[] },
  art: { visualStyle: string; images: { n: number; imagePrompt: string }[] } | null
): PresentationStructure {
  const isImage = input.deckType === 'full-image';
  const imageByN = new Map<number, string>();
  (art?.images || []).forEach((im, i) => {
    imageByN.set(Number(im?.n) || i + 1, String(im?.imagePrompt || ''));
  });

  const slides: SlideData[] = (written.slides || []).map((s: any, i: number) => {
    const n = Number(s?.n) || i + 1;
    const beat = beats.find((b) => Number(b.n) === n);
    const type = (isImage ? beat?.type : s?.type || beat?.type) || (i === 0 ? 'title' : 'content');

    return {
      type: (['title', 'content', 'comparison', 'closing'].includes(type) ? type : 'content') as SlideData['type'],
      title: String(s?.title || beat?.headline || title),
      subtitle: s?.subtitle ? String(s.subtitle) : undefined,
      points: isImage ? undefined : normalizePoints(s?.points),
      speakerNotes: String(s?.speakerNotes || ''),
      imagePrompt: imageByN.get(n) || undefined,
    };
  });

  return {
    title: String(title || 'Presentation'),
    slides,
    visualStyle: art?.visualStyle,
  };
}

// ──────────────────────────── the council runner ─────────────────────────────

const MAX_REVISION_ROUNDS = 2;
const GOOD_ENOUGH_SCORE = 8;

export async function runCouncil(
  input: CouncilInput,
  onProgress: ProgressFn = () => {}
): Promise<PresentationStructure> {
  onProgress({ phase: 'strategy', detail: 'Working out who this deck is for' });
  const strategy = await runStrategist(input);

  // Make it visible in the logs whether a requested voice survived the
  // strategist — this is exactly what went missing on the Humayun Ahmed deck.
  const voiceSummary = String(strategy?.voice || '').trim();
  const languageSummary = String(strategy?.language || '').trim();
  console.log(
    voiceSummary || languageSummary
      ? `Voice captured: ${voiceSummary || '(none)'} | language: ${languageSummary || '(unspecified)'}`
      : 'Voice captured: none requested — using the plain spoken default'
  );

  onProgress({ phase: 'structure', detail: `Laying out ${input.slideCount} beats` });
  const plan = await runArchitect(input, strategy);
  const beats: Beat[] = Array.isArray(plan?.beats) ? plan.beats : [];
  if (!beats.length) throw new Error('The architect returned no beat sheet');

  // The writer and the art director both work from the beat sheet, so they
  // work at the same time.
  onProgress({
    phase: 'writing',
    detail: `Writing to ${input.pacing.words} words a slide${input.needsImages ? ' and art directing' : ''}`,
  });
  const [written, art] = await Promise.all([
    runScriptwriter(input, strategy, beats),
    input.needsImages ? runArtDirector(input, strategy, beats) : Promise.resolve(null),
  ]);

  let structure = assemble(input, plan.title, beats, written, art);

  // Review loop: machine facts first, then the coach's judgment.
  for (let round = 0; round < MAX_REVISION_ROUNDS; round++) {
    const defects = runTimekeeper(structure, input);

    onProgress({
      phase: 'review',
      detail: defects.length ? `Checking the clock — ${defects.length} to fix` : 'Coach reading it through',
    });
    let verdict: CoachVerdict = { score: 10, verdict: '', fixes: [] };
    try {
      verdict = await runCoach(input, strategy, structure, defects);
    } catch (error) {
      console.error('Coach failed (non-blocking):', error instanceof Error ? error.message : error);
    }

    const fixes = Array.isArray(verdict?.fixes) ? verdict.fixes : [];
    const score = Number(verdict?.score);
    const goodEnough = !defects.length && (!fixes.length || (Number.isFinite(score) && score >= GOOD_ENOUGH_SCORE));

    console.log(
      `Council review round ${round + 1}: score=${Number.isFinite(score) ? score : '?'} ` +
      `defects=${defects.length} coachFixes=${fixes.length}${verdict?.verdict ? ` — ${verdict.verdict}` : ''}`
    );

    if (goodEnough) break;

    onProgress({
      phase: 'revising',
      detail: `Fixing ${defects.length + fixes.length} note${defects.length + fixes.length === 1 ? '' : 's'}`,
    });
    try {
      structure = await runReviser(input, strategy, structure, defects, fixes);
    } catch (error) {
      console.error('Reviser failed (keeping previous draft):', error instanceof Error ? error.message : error);
      break;
    }
  }

  // Never ship the reviser's last edit unchecked. Timing and length are facts,
  // so we re-count them; if anything is still out of budget we send it back one
  // final time with ONLY those defects — no coach call, just the numbers.
  const finalDefects = runTimekeeper(structure, input);
  if (finalDefects.length) {
    console.log(`Council final check: ${finalDefects.length} still out of budget — one focused repair`);
    onProgress({ phase: 'revising', detail: 'Last pass on the clock' });
    try {
      const candidate = await runReviser(input, strategy, structure, finalDefects, []);
      // Only accept the repair if it genuinely improved things
      if (runTimekeeper(candidate, input).length < finalDefects.length) structure = candidate;
    } catch (error) {
      console.error('Final repair failed (shipping previous draft):', error instanceof Error ? error.message : error);
    }
  }

  const shipped = runTimekeeper(structure, input);
  console.log(
    shipped.length
      ? `Council shipping with ${shipped.length} unresolved: ${shipped.slice(0, 3).join(' | ')}`
      : 'Council shipping clean — every slide inside its time budget'
  );

  onProgress({ phase: 'done' });
  return structure;
}
