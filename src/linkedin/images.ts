import { readFile, stat } from "node:fs/promises";
import type { FetchLike, LinkedInClient } from "./client.js";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type ImageSource = { path: string } | { url: string };

const SIGNATURES: Array<{ type: string; test: (b: Uint8Array) => boolean }> = [
  { type: "image/png", test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { type: "image/jpeg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { type: "image/gif", test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
];

/** Detects PNG/JPEG/GIF from magic bytes; LinkedIn's Images API accepts these formats. */
export function detectImageType(bytes: Uint8Array): string {
  const match = SIGNATURES.find((s) => s.test(bytes));
  if (!match) throw new Error("Unsupported image format. Use a PNG, JPEG or GIF file.");
  return match.type;
}

export async function loadImage(source: ImageSource, fetchImpl: FetchLike = fetch): Promise<{ bytes: Uint8Array; contentType: string }> {
  let bytes: Uint8Array;
  if ("path" in source) {
    const info = await stat(source.path);
    if (!info.isFile()) throw new Error(`${source.path} is not a file.`);
    if (info.size > MAX_IMAGE_BYTES) throw new Error(`Image is ${(info.size / 1048576).toFixed(1)} MB; the limit here is ${MAX_IMAGE_BYTES / 1048576} MB.`);
    bytes = new Uint8Array(await readFile(source.path));
  } else {
    const url = new URL(source.url);
    if (url.protocol !== "https:") throw new Error("image_url must be an https:// URL.");
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Could not download image (${res.status}).`);
    const declared = Number(res.headers.get("content-length"));
    if (declared > MAX_IMAGE_BYTES) throw new Error("Image is too large.");
    bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("Image is too large.");
  }
  return { bytes, contentType: detectImageType(bytes) };
}

interface InitializeUploadResponse {
  value: { uploadUrl: string; image: string; uploadUrlExpiresAt?: number };
}

/** Registers an image with LinkedIn, uploads the bytes, and returns its urn:li:image:… */
export async function uploadImage(client: LinkedInClient, ownerUrn: string, source: ImageSource, fetchImpl?: FetchLike): Promise<string> {
  const { bytes, contentType } = await loadImage(source, fetchImpl);
  const res = await client.rest("/images?action=initializeUpload", {
    method: "POST",
    body: { initializeUploadRequest: { owner: ownerUrn } },
  });
  const { value } = (await res.json()) as InitializeUploadResponse;
  if (!value?.uploadUrl || !value?.image) throw new Error("LinkedIn did not return an upload URL for the image.");
  await client.uploadBytes(value.uploadUrl, bytes, contentType);
  return value.image;
}
