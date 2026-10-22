import type { Metadata } from "next";
import "./globals.css";
import "./product.css";

export const metadata: Metadata = {
  title: "PactPay — Let your AI agent shop. Keep the final say.",
  description: "PactPay holds your payment and releases it only if the offer still matches the rules you approved. PayPal Sandbox test mode.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
