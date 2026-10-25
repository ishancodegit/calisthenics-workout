import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Assassins",
  description: "A real-world battle royale for you and your friends. Secret targets, a shrinking storm, last one standing wins.",
};

export const viewport: Viewport = {
  themeColor: "#0a0912",
};

export default function AssassinsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
