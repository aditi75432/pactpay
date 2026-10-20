import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PactPay — Protected Agentic Commerce",
  description: "Intent-bound, evidence-gated settlement for agentic commerce. Sandbox demonstration only.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
