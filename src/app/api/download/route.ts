import { NextRequest, NextResponse } from 'next/server';
import { getObjectStream } from '@/lib/r2';

export const maxDuration = 300;

const R2_PREFIX = 'aideck-presentations/';

/**
 * GET /api/download?file=<filename>
 *
 * Serves a finished deck from our own domain instead of handing the browser a
 * signed R2 link. The R2 bucket sends no CORS headers, so a cross-origin
 * fetch() of a signed link is blocked — which lost a finished 40-slide deck
 * that had already been generated and paid for. Same-origin has no such problem.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const requested = request.nextUrl.searchParams.get('file') || '';

  // Only ever serve a plain filename from our own prefix — no traversal, no
  // reaching into the rest of the bucket.
  const filename = requested.split('/').pop() || '';
  if (!filename || !/^[A-Za-z0-9._-]+\.pptx$/.test(filename)) {
    return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
  }

  try {
    const { body, contentLength } = await getObjectStream(`${R2_PREFIX}${filename}`);

    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': `attachment; filename="${filename}"`,
        ...(contentLength ? { 'Content-Length': String(contentLength) } : {}),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Download failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'That deck could not be found' }, { status: 404 });
  }
}
