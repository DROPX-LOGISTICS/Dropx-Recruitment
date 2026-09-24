import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DropX Recruit",
    short_name: "Recruit",
    description: "DropX workforce and HR recruitment workspace",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#d4275a",
    icons: [192, 512].map((size) => ({ src: `/brand/recruit-icon-${size}-v1.png`, sizes: `${size}x${size}`, type: "image/png", purpose: "any" }))
  };
}
