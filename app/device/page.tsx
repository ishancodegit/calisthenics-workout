"use client";

import dynamic from "next/dynamic";

// Storage, canvas and pointer events are all browser-only.
const DeviceApp = dynamic(() => import("./DeviceApp"), {
  ssr: false,
  // No spinner, no wordmark: it opens on blank paper.
  loading: () => <div className="h-dvh bg-[#f4f4f2]" />,
});

export default function DevicePage() {
  return <DeviceApp />;
}
