import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "XFuel — C2 project portal",
  description: "Financial plan for the C2 Tarragona sustainable fuel FOAK plant.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
