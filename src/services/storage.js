import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { s3 } from './aws.js';

async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf-8');
}

export const storage = {
  async get(key) {
    if (!config.s3Bucket) return null;
    try {
      const response = await s3.send(new GetObjectCommand({ Bucket: config.s3Bucket, Key: key }));
      const text = await streamToString(response.Body);
      return {
        body: Buffer.from(text, 'utf-8'),
        size: Number(response.ContentLength || Buffer.byteLength(text, 'utf-8')),
        async text() {
          return text;
        }
      };
    } catch {
      return null;
    }
  },
  async put(key, value, contentType = 'text/plain; charset=utf-8') {
    if (!config.s3Bucket) throw new Error('APP_S3_BUCKET is not configured');
    await s3.send(new PutObjectCommand({
      Bucket: config.s3Bucket,
      Key: key,
      Body: typeof value === 'string' ? value : Buffer.from(value),
      ContentType: contentType
    }));
  },
  async delete(key) {
    if (!config.s3Bucket) return;
    await s3.send(new DeleteObjectCommand({ Bucket: config.s3Bucket, Key: key }));
  }
};
