export const META_MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,video/mp4,video/quicktime,.mp4,.mov";
export const META_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export type MetaMediaKind = "image" | "video";

export function validateCreativeFile(file: { name: string; type: string; size: number }) {
  const type = file.type || (/\.mp4$/i.test(file.name) ? "video/mp4" : /\.mov$/i.test(file.name) ? "video/quicktime" : "");
  const kind: MetaMediaKind = ["video/mp4", "video/quicktime"].includes(type) ? "video" : "image";
  if (!["image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"].includes(type)) {
    throw new Error("Choose a JPG, PNG, WebP, MP4 or MOV file.");
  }
  const limit = kind === "video" ? META_VIDEO_MAX_BYTES : 12 * 1024 * 1024;
  if (!Number.isSafeInteger(file.size) || file.size <= 0 || file.size > limit) {
    throw new Error(kind === "video" ? "Video must be between 1 byte and 50 MB." : "Image must be between 1 byte and 12 MB.");
  }
  return { kind, contentType: type };
}
