"use client";

import { TideProvider } from "@/lib/tide/client";
import { SessionProvider } from "@/lib/session";

// TideProvider is real TideCloak (live) or the local stand-in (NEXT_PUBLIC_TIDE_MODE=local).
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <TideProvider>
      <SessionProvider>{children}</SessionProvider>
    </TideProvider>
  );
}
