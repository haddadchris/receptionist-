/**
 * File storage for receipts and other uploads.
 *  - "local" (default): `.data/uploads` on disk, served by an authenticated route.
 *  - "supabase": Supabase Storage via REST (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY,
 *    bucket SUPABASE_STORAGE_BUCKET, private). Written from the documented REST shape.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface StorageProvider {
  readonly name: string;
  put(key: string, data: Buffer, contentType: string): Promise<string>;
  get(key: string): Promise<{ data: Buffer; contentType: string } | null>;
}

const ROOT = () => path.resolve(process.env.LOCAL_UPLOAD_DIR ?? path.join(process.cwd(), ".data/uploads"));

const TYPES: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

export class LocalStorage implements StorageProvider {
  readonly name = "local";
  async put(key: string, data: Buffer): Promise<string> {
    const safe = key.replace(/[^a-zA-Z0-9/_.-]/g, "_").replace(/\.\.+/g, ".");
    const file = path.join(ROOT(), safe);
    if (!file.startsWith(ROOT())) throw new Error("invalid key");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    return safe;
  }
  async get(key: string) {
    const file = path.join(ROOT(), key);
    if (!file.startsWith(ROOT())) return null;
    try {
      return { data: await readFile(file), contentType: TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }
}

export class SupabaseStorage implements StorageProvider {
  readonly name = "supabase";
  private base = (process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  private key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  private bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "fekerte-private";
  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    const res = await fetch(`${this.base}/storage/v1/object/${this.bucket}/${key}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": contentType, "x-upsert": "true" },
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Supabase storage upload ${res.status}`);
    return key;
  }
  async get(key: string) {
    const res = await fetch(`${this.base}/storage/v1/object/${this.bucket}/${key}`, { headers: { Authorization: `Bearer ${this.key}` } });
    if (!res.ok) return null;
    return { data: Buffer.from(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream" };
  }
}

export function getStorage(): StorageProvider {
  return process.env.STORAGE_PROVIDER === "supabase" ? new SupabaseStorage() : new LocalStorage();
}

export function uploadKey(prefix: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase().slice(0, 6) || ".bin";
  return `${prefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}${ext}`;
}
