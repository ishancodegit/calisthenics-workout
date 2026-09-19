import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Notes",
  description: "A plain note-taking device.",
  appleWebApp: { capable: true, title: "Notes", statusBarStyle: "default" },
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: "#f4f4f2",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function DeviceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
