import type { Metadata } from "next";
import "./globals.css";
import "./product.css";
import "./muse.css";

export const metadata: Metadata = {
  title: "PactPay × Meta Muse — Let your AI agent shop. Keep the final say.",
  description: "A Meta Muse agent that shops within your approved rules. PactPay checks Sandbox checkout evidence and uses a fixed gate to control PayPal Sandbox settlement.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
