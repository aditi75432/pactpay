import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./product.css";
import "./muse.css";

// Self-hosted, OFL-licensed (see app/fonts/OFL.txt). No network needed at build or run time.
const inter = localFont({ src: "./fonts/Inter-Variable.woff2", variable: "--font-inter", weight: "400 800", display: "swap" });
const display = localFont({ src: "./fonts/BricolageGrotesque-Variable.woff2", variable: "--font-display", weight: "500 800", display: "swap" });

export const metadata: Metadata = {
  title: "PactPay | Let your AI agent shop. PayPal holds the money until it's right.",
  description: "PactPay lets an AI agent shop within rules you approve. PayPal holds the money, fixed code checks the live offer and the real checkout page, and the payment only moves if everything still matches. Includes the PactPay Guard browser extension.",
  applicationName: "PactPay",
  openGraph: { title: "PactPay", description: "Let your AI agent shop. PayPal holds the money until it's right.", siteName: "PactPay", type: "website" },
  twitter: { card: "summary_large_image", title: "PactPay", description: "Let your AI agent shop. PayPal holds the money until it's right." },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className={`${inter.variable} ${display.variable}`}><body>{children}</body></html>;
}
