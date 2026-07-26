import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// R2 uses the S3-compatible API
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'nowork-templates';

// All AIDeck files go under this prefix inside the shared bucket
const R2_PREFIX = 'aideck-presentations/';

function getR2Client(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error('R2 credentials are not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.');
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

/**
 * Upload a presentation file to R2
 */
export async function uploadToR2(
  fileBuffer: Buffer,
  fileName: string,
  metadata?: Record<string, string>
): Promise<{ key: string; size: number }> {
  const client = getR2Client();
  const key = `${R2_PREFIX}${fileName}`;

  await client.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      Metadata: metadata || {},
    })
  );

  return { key, size: fileBuffer.length };
}

/**
 * Stream an object straight out of R2.
 *
 * Used by /api/download so the browser only ever talks to our own domain.
 * Signed R2 links work for a plain link click but are blocked for fetch() —
 * the bucket sends no access-control-allow-origin — which is how a finished
 * deck could get lost after it had already been paid for and built.
 */
export async function getObjectStream(
  key: string
): Promise<{ body: ReadableStream; contentLength?: number }> {
  const client = getR2Client();
  const response = await client.send(
    new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key })
  );

  if (!response.Body) throw new Error('Object has no body');

  return {
    body: (response.Body as any).transformToWebStream(),
    contentLength: response.ContentLength,
  };
}

/**
 * Generate a temporary download URL (valid for 1 hour)
 */
export async function getDownloadUrl(key: string): Promise<string> {
  const client = getR2Client();

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }),
    { expiresIn: 3600 } // 1 hour
  );

  return url;
}

/**
 * Delete a file from R2
 */
export async function deleteFromR2(key: string): Promise<void> {
  const client = getR2Client();

  await client.send(
    new DeleteObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    })
  );
}

/**
 * Generate a smart filename based on the presentation title/prompt
 * Format: Topic-Summary-YYYY-MM-DD-uniqueId.pptx
 */
export function generateSmartFilename(title: string): string {
  // Clean the title: remove special chars, limit words
  const cleaned = title
    .replace(/[^a-zA-Z0-9\s]/g, '') // Remove special characters
    .trim()
    .split(/\s+/) // Split by whitespace
    .slice(0, 5) // Take first 5 words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Title case
    .join('-');

  // Add date
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD

  // Add short unique ID (last 6 chars of timestamp in base36)
  const uniqueId = Date.now().toString(36).slice(-6);

  return `${cleaned || 'Presentation'}-${dateStr}-${uniqueId}.pptx`;
}

/**
 * Generate a short description/summary from the prompt
 */
export function generateDescription(prompt: string, title: string): string {
  // Use the first 150 chars of the prompt as a description
  const desc = prompt.length > 150 ? prompt.substring(0, 147) + '...' : prompt;
  return desc;
}
