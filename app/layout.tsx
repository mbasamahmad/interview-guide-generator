import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Interview Guide Generator",
  description: "Research a company and generate a company-specific interview preparation guide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Interview Guide Generator</Link>
          <nav>
            <Link href="/">Generate</Link>
            <Link href="/sheet">Sheet settings</Link>
            <Link href="/prompts">Prompts</Link>
            <Link href="/info">Info</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
