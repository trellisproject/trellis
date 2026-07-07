import "./globals.css";
import type { ReactNode } from "react";

export const metadata = {
  title: "Trellis",
  description: "Specification & drift management for agent-driven development",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
