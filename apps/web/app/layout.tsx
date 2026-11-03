import type { Metadata } from "next";
import "./globals.css";
import "./product.css";
import "./muse.css";

export const metadata: Metadata = {
  title: "PactPay × Meta Muse — Let your AI agent shop. Keep the final say.",
  description: "A Meta Muse agent that shops for you, reads the real checkout page, and can't be talked into overspending. A fixed gate, not the model, decides every payment. PayPal Sandbox test mode.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
