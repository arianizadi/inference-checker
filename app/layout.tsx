import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inference Checker — Semantic Segmentation Analysis",
  description:
    "Compare semantic segmentation predictions with overlays, side-by-side views, pixel-level diffs, and per-class metrics.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} antialiased`}>
        {children}
        <Script 
          defer 
          src="https://umami.arianizadi.com/script.js" 
          data-website-id="8a24ccc0-f6fd-45b1-ae53-e5584882e0cb"
        />
      </body>
    </html>
  );
}
