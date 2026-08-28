import type { Metadata, Viewport } from "next";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import "./ats.css";

export const metadata: Metadata = {
  title: "DropX Recruitment",
  description: "DropX workforce and HR recruitment command centre"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
