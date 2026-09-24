import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./ats.css";
import "./recruit-brand.css";

export const metadata: Metadata = {
  title: "DropX Recruit | Workforce & HR",
  description: "Connect talent with opportunity. The DropX workspace for workforce and HR recruitment.",
  applicationName: "DropX Recruit",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/brand/recruit-icon-32-v1.png", sizes: "32x32", type: "image/png" }, { url: "/brand/recruit-icon-64-v1.png", sizes: "64x64", type: "image/png" }],
    apple: [{ url: "/brand/recruit-icon-180-v1.png", sizes: "180x180", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#d4275a",
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
