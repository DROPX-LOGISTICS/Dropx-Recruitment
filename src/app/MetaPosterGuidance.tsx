import type { CreativePreview } from "@/lib/meta-media-upload";

export default function MetaPosterGuidance({ media }: { media?: Pick<CreativePreview, "width" | "height" | "kind"> | null }) {
  return <div className="meta-poster-guidance">
    <strong>Recommended tall poster: 1080 × 1920 px (9:16).</strong>
    <span>Fits the Stories/Reels frame. For one poster across placements, keep essential details in the centre 1080 × 1080 area and away from the edges. Feed crops vary; check Meta’s final preview.</span>
    {media ? <span>Selected {media.kind === "video" ? "video" : "image"}: <b>{media.width} × {media.height} px</b>{media.width === media.height ? " · 1:1 square" : Math.abs(media.width / media.height - 9 / 16) < 0.01 ? " · 9:16 portrait" : ""}</span> : null}
  </div>;
}
