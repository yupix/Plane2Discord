import {
  S3Client,
  PutObjectCommand,
  S3ClientConfig,
} from "npm:@aws-sdk/client-s3@^3.592.0";
import { crypto } from "https://deno.land/std@0.224.0/crypto/mod.ts";
import { DatabaseSync } from "node:sqlite";

/**
 * S3設定用のインターフェース (変更なし)
 */
export interface S3UploadConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucketName: string;
  endpoint: string;
}

const config: S3UploadConfig = {
    region: Deno.env.get("S3_REGION")!,
    accessKeyId: Deno.env.get("S3_ACCESS_KEY_ID")!,
    secretAccessKey: Deno.env.get("S3_SECRET_ACCESS_KEY")!,
    bucketName: Deno.env.get("S3_BUCKET_NAME")!,
    endpoint: Deno.env.get("S3_ENDPOINT")!,
}

/**
 * MIMEタイプから拡張子 (変更なし)
 */
function getExtensionFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/jpeg": return ".jpg";
    case "image/png": return ".png";
    case "image/gif": return ".gif";
    case "image/webp": return ".webp";
    case "image/svg+xml": return ".svg";
    case "image/avif": return ".avif";
    default: return "";
  }
}

class PersistentImageCache {
  private db: DatabaseSync;
  private dbPath: string;

  constructor(dbPath: string = "s3_cache.db") {
    this.dbPath = dbPath;
    this.db = new DatabaseSync(this.dbPath);
    
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS image_cache (
        image_hash TEXT PRIMARY KEY,
        s3_url TEXT NOT NULL,
        created_at TEXT DEFAULT (DATETIME('now'))
      )
    `);
  }

  /**
   * キャッシュを取得
   * @param hashKey 画像のハッシュ値
   */
  get(hashKey: string): string | undefined {
    const result = this.db.prepare(
      "SELECT s3_url FROM image_cache WHERE image_hash = ?"
    ).get(hashKey) as { s3_url: string } | undefined;

    return result ? result.s3_url : undefined;
  }

  /**
   * キャッシュを設定
   * @param hashKey 画像のハッシュ値
   * @param value 保存するS3のURL
   */
  set(hashKey: string, value: string): void {
    try {
      this.db.prepare(
        "INSERT OR REPLACE INTO image_cache (image_hash, s3_url) VALUES (?, ?)"
      ).run(hashKey, value);
    } catch (e) {
      console.error("Failed to write to cache DB:", e.message);
    }
  }
}

const imageCache = new PersistentImageCache();

async function calculateHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}


export async function uploadImageToS3(
  imageUrl: string,
): Promise<string> {

  console.log(`Downloading image from: ${imageUrl}`);
  let imageBuffer: ArrayBuffer;
  let contentType: string;
  let filename: string;
  let imageHash: string;

  try {
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok || !imageResponse.body) {
      throw new Error(
        `画像のダウンロードに失敗しました (Status: ${imageResponse.status})`,
      );
    }

    imageBuffer = await imageResponse.arrayBuffer();
    contentType = imageResponse.headers.get("content-type") ??
      "application/octet-stream";
    
    imageHash = await calculateHash(imageBuffer);

    const cachedUrl = imageCache.get(imageHash);
    if (cachedUrl) {
      console.log("Using cached S3 URL for image hash:", imageHash);
      return cachedUrl;
    }

    const extension = getExtensionFromMime(contentType);
    filename = `${crypto.randomUUID()}${extension}`;

  } catch (err) {
    console.error("Download Error:", err.message);
    throw new Error(`Failed to download image: ${err.message}`);
  }

  const s3Client = new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: true,
  });

  console.log(
    `Uploading to S3 Bucket: ${config.bucketName} as ${filename}...`,
  );
  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: filename,
    Body: new Uint8Array(imageBuffer),
    ContentType: contentType,
    ContentLength: imageBuffer.byteLength,
    ACL: 'public-read'
  });

  try {
    await s3Client.send(command);

    const endpointUrl = config.endpoint.endsWith('/') 
        ? config.endpoint.slice(0, -1) 
        : config.endpoint;

    const newS3Url =
      `${endpointUrl}/${config.bucketName}/${filename}`;

    console.log("✅ S3 Upload successful!");

    imageCache.set(imageHash, newS3Url);

    return newS3Url;
  } catch (err) {
    console.error("Error: S3へのアップロードに失敗しました。");
    console.error(err);
    throw new Error(`Failed to upload to S3: ${err.message}`);
  }
}