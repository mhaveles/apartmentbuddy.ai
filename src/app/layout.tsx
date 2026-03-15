import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ApartmentBuddy.ai — Find Your Perfect Home",
  description: "AI-powered apartment search that monitors listings and matches them to your lifestyle.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 antialiased">
        {children}
      </body>
    </html>
  );
}
