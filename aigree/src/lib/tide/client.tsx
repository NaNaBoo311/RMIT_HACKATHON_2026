"use client";
// The app's single entry point to TideCloak in the browser. Pages import useTideCloak/TideProvider
// from here, never from @tidecloak/nextjs directly, so local mode is one switch (mode.ts).
import { TideCloakProvider, useTideCloak as useRealTideCloak } from "@tidecloak/nextjs";
import tcConfig from "../../../data/tidecloak.json";
import { TIDE_LOCAL } from "./mode";
import { LocalTideProvider, useLocalTide, type TideHook } from "./localTide";

export type { TideHook };

/** The parts of useTideCloak() the app uses, from real TideCloak or the local stand-in. */
export const useTideCloak: () => TideHook = TIDE_LOCAL
  ? useLocalTide
  : (useRealTideCloak as unknown as () => TideHook);

export function TideProvider({ children }: { children: React.ReactNode }) {
  if (TIDE_LOCAL) return <LocalTideProvider>{children}</LocalTideProvider>;
  // useDPoP goes inside the config object, not as a separate JSX prop (I-12).
  return <TideCloakProvider config={{ ...tcConfig, useDPoP: { mode: "strict", alg: "ES256" } }}>{children}</TideCloakProvider>;
}
