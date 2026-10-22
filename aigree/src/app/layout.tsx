import "./globals.css";
import { Providers } from "./providers";
import { AppShell } from "@/components/AppShell";

export const metadata = {
  title: "AIgree",
  description: "Medical records doctors can read only during a patient-approved visit",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
