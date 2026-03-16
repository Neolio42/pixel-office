import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pixel Office",
  description: "Watch your Claude Code sessions as pixel art workers",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="bg-[#1a1a2e] text-white overflow-hidden">
        {children}
      </body>
    </html>
  );
}
