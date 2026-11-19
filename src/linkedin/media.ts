import { open, readFile, stat } from "node:fs/promises";
import { extname } from "node:path";
import type { LinkedInClient } from "./client.js";
import { loadImage } from "./images.js";

export const VIDEO_MIN_BYTES = 75 * 1024;
export const VIDEO_MAX_BYTES = 500 * 1024 * 1024;
export const DOCUMENT_MAX_BYTES = 100 * 1024 * 1024;
export const DOCUMENT_TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export interface WaitOptions {
  /** How long to wait for LinkedIn to finish processing (ms). */
  timeoutMs?: number;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

async function fileSize(path: string): Promise<number> {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`${path} is not a file.`);
  return info.size;
}

/** MP4 files carry an "ftyp" box at byte offset 4. */
async function assertMp4(path: string): Promise<void> {
  const fh = await open(path, "r");
  try {
    const head = new Uint8Array(12);
    await fh.read(head, 0, 12, 0);
    if (String.fromCharCode(...head.slice(4, 8)) !== "ftyp") throw new Error("Unsupported video format. LinkedIn accepts MP4 files.");
  } finally {
    await fh.close();
  }
}

type AssetStatus = "PROCESSING" | "PROCESSING_FAILED" | "AVAILABLE" | "WAITING_UPLOAD";

async function waitForAsset(client: LinkedInClient, kind: "videos" | "documents", urn: string, opts: WaitOptions): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;
  const interval = opts.pollIntervalMs ?? 3000;
  const deadline = Date.now() + (opts.timeoutMs ?? 5 * 60_000);
  for (;;) {
    const res = await client.rest(`/${kind}/${encodeURIComponent(urn)}`);
    const asset = (await res.json()) as { status?: AssetStatus; processingFailureReason?: string };
    if (asset.status === "AVAILABLE") return;
    if (asset.status === "PROCESSING_FAILED") {
      throw new Error(`LinkedIn could not process ${urn}${asset.processingFailureReason ? `: ${asset.processingFailureReason}` : ""}.`);
    }
    if (Date.now() >= deadline) {
      throw new Error(`${urn} is still ${asset.status ?? "processing"} on LinkedIn. Try again in a few minutes; nothing was posted.`);
    }
    await sleep(interval);
  }
}

interface VideoInitResponse {
  value: {
    video: string;
    uploadToken?: string;
    uploadInstructions: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
    thumbnailUploadUrl?: string;
  };
}

/**
 * Uploads an MP4 with LinkedIn's multipart flow: initializeUpload → PUT each byte range (collecting ETags)
 * → finalizeUpload → wait until AVAILABLE. Reads one part at a time so large files aren't held in memory.
 */
export async function uploadVideo(
  client: LinkedInClient,
  ownerUrn: string,
  path: string,
  opts: WaitOptions & { thumbnailPath?: string } = {},
): Promise<string> {
  const size = await fileSize(path);
  if (size < VIDEO_MIN_BYTES || size > VIDEO_MAX_BYTES) {
    throw new Error(`Video is ${mb(size)}; LinkedIn accepts 75 KB to 500 MB.`);
  }
  await assertMp4(path);
  const thumbnail = opts.thumbnailPath ? await loadImage({ path: opts.thumbnailPath }) : undefined;

  const init = await client.rest("/videos?action=initializeUpload", {
    method: "POST",
    body: { initializeUploadRequest: { owner: ownerUrn, fileSizeBytes: size, uploadCaptions: false, uploadThumbnail: Boolean(thumbnail) } },
  });
  const { value } = (await init.json()) as VideoInitResponse;
  if (!value?.video || !value.uploadInstructions?.length) throw new Error("LinkedIn did not return upload instructions for the video.");

  const etags: string[] = [];
  const fh = await open(path, "r");
  try {
    for (const part of value.uploadInstructions) {
      const length = part.lastByte - part.firstByte + 1;
      const chunk = new Uint8Array(length);
      const { bytesRead } = await fh.read(chunk, 0, length, part.firstByte);
      const res = await client.uploadBytes(part.uploadUrl, chunk.subarray(0, bytesRead), "application/octet-stream");
      const etag = res.headers.get("etag");
      if (!etag) throw new Error("LinkedIn did not return an ETag for a video part.");
      etags.push(etag.replace(/^"|"$/g, ""));
    }
  } finally {
    await fh.close();
  }

  if (thumbnail && value.thumbnailUploadUrl) {
    await client.uploadBytes(value.thumbnailUploadUrl, thumbnail.bytes, "application/octet-stream", { "media-type-family": "STILLIMAGE" });
  }

  await client.rest("/videos?action=finalizeUpload", {
    method: "POST",
    body: { finalizeUploadRequest: { video: value.video, uploadToken: value.uploadToken ?? "", uploadedPartIds: etags } },
  });
  await waitForAsset(client, "videos", value.video, opts);
  return value.video;
}

/** Uploads a PDF/PPT/PPTX/DOC/DOCX (shown as a swipeable carousel) and waits until LinkedIn has processed it. */
export async function uploadDocument(client: LinkedInClient, ownerUrn: string, path: string, opts: WaitOptions = {}): Promise<string> {
  const type = DOCUMENT_TYPES[extname(path).toLowerCase()];
  if (!type) throw new Error("Unsupported document type. Use PDF, PPT, PPTX, DOC or DOCX.");
  const size = await fileSize(path);
  if (size > DOCUMENT_MAX_BYTES) throw new Error(`Document is ${mb(size)}; LinkedIn's limit is 100 MB (and 300 pages).`);

  const init = await client.rest("/documents?action=initializeUpload", {
    method: "POST",
    body: { initializeUploadRequest: { owner: ownerUrn } },
  });
  const { value } = (await init.json()) as { value: { uploadUrl: string; document: string } };
  if (!value?.uploadUrl || !value.document) throw new Error("LinkedIn did not return an upload URL for the document.");
  await client.uploadBytes(value.uploadUrl, new Uint8Array(await readFile(path)), "application/octet-stream");
  await waitForAsset(client, "documents", value.document, opts);
  return value.document;
}
