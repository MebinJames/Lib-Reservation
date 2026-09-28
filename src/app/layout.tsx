import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Reading Room — seat reservations",
  description:
    "Book a seat in the library reading room: round tables, study tables and computer stations.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
