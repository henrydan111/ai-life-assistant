import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Life Assistant",
  description: "A calm AI life dashboard for spare screens.",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#287c7b",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
