import { NextRequest } from "next/server";
import { requireUser, type AuthedUser, type AppRole } from "./requireUser";

/** An error a route handler can throw to answer with a specific status. */
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const ok = (data: unknown, status = 200) => Response.json(data, { status });
export const fail = (status: number, error: string) => Response.json({ error }, { status });

/** Read and parse a JSON body, answering 400 on garbage. */
export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

type RouteContext<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: { user: AuthedUser; params: P }) => Promise<Response>;

/**
 * Wrap a route handler: verifies the TideCloak token AND its DPoP proof (template verifiers),
 * enforces `roles` (any of), loads the caller's profile, and maps thrown HttpErrors to responses.
 *
 *   export const POST = route(async (req, { user, params }) => ok({...}), { roles: ["bac_si"] });
 */
export function route<P = Record<string, string>>(
  handler: Handler<P>,
  opts: { roles?: AppRole[]; requireProfile?: boolean } = {},
) {
  return async (req: NextRequest, context: RouteContext<P>) => {
    try {
      const user = await requireUser(req, opts.roles, { requireProfile: opts.requireProfile ?? true });
      const params = (context?.params ? await context.params : ({} as P)) as P;
      return await handler(req, { user, params });
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      console.error("[api]", req.method, req.nextUrl.pathname, err instanceof Error ? err.message : err);
      return fail(500, "Internal error");
    }
  };
}
