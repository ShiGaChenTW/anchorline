export type MarkdownMediaKind = "image" | "video" | "audio";

export type MarkdownMediaAsset = {
  kind: MarkdownMediaKind;
  mime: string;
};

const IMAGE_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

const VIDEO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  ogv: "video/ogg",
};

const AUDIO_MIME: Record<string, string> = {
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  flac: "audio/flac",
};

export function markdownMediaAssetForExtension(ext: string): MarkdownMediaAsset {
  const normalized = ext.toLowerCase();
  const video = VIDEO_MIME[normalized];
  if (video) return { kind: "video", mime: video };
  const audio = AUDIO_MIME[normalized];
  if (audio) return { kind: "audio", mime: audio };
  return { kind: "image", mime: IMAGE_MIME[normalized] ?? "image/png" };
}

export function extensionFromMarkdownAssetSrc(src: string): string {
  const path = src.split("#", 1)[0].split("?", 1)[0];
  const dot = path.lastIndexOf(".");
  return dot >= 0 ? path.slice(dot + 1) : "png";
}
