// S22 — HTTP API layer (framework-free router).
// A minimal, dependency-light router with path params, middleware, and typed
// request/response. Keeps the platform testable without binding to Express/etc.
// A real deployment adapts these handlers onto Node's http server or a framework.

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export interface ApiRequest {
  method: HttpMethod;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  params: Record<string, string>;
  body: unknown;
  // Populated by auth middleware.
  userId?: string;
  tenantId?: string;
}

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type Handler = (req: ApiRequest) => ApiResponse | Promise<ApiResponse>;
export type Middleware = (
  req: ApiRequest,
  next: () => Promise<ApiResponse>,
) => Promise<ApiResponse>;

interface Route {
  method: HttpMethod;
  segments: string[]; // path split; ":name" denotes a param
  handler: Handler;
}

export function json(status: number, body: unknown): ApiResponse {
  return { status, body, headers: { "content-type": "application/json" } };
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class Router {
  private readonly routes: Route[] = [];
  private readonly middleware: Middleware[] = [];

  use(mw: Middleware): this {
    this.middleware.push(mw);
    return this;
  }

  add(method: HttpMethod, path: string, handler: Handler): this {
    this.routes.push({ method, segments: splitPath(path), handler });
    return this;
  }

  get(path: string, h: Handler): this {
    return this.add("GET", path, h);
  }
  post(path: string, h: Handler): this {
    return this.add("POST", path, h);
  }
  put(path: string, h: Handler): this {
    return this.add("PUT", path, h);
  }
  delete(path: string, h: Handler): this {
    return this.add("DELETE", path, h);
  }

  private match(method: HttpMethod, path: string): { route: Route; params: Record<string, string> } | null {
    const segs = splitPath(path);
    for (const route of this.routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < segs.length; i++) {
        const r = route.segments[i];
        if (r.startsWith(":")) params[r.slice(1)] = segs[i];
        else if (r !== segs[i]) {
          ok = false;
          break;
        }
      }
      if (ok) return { route, params };
    }
    return null;
  }

  async handle(req: ApiRequest): Promise<ApiResponse> {
    const matched = this.match(req.method, req.path);
    if (!matched) return json(404, { error: "Not found", path: req.path });
    req.params = matched.params;

    // Compose middleware chain ending in the route handler.
    const runHandler = async (): Promise<ApiResponse> => {
      try {
        return await matched.route.handler(req);
      } catch (err) {
        if (err instanceof HttpError) return json(err.status, { error: err.message });
        return json(500, { error: "Internal error" });
      }
    };

    let idx = -1;
    const dispatch = async (i: number): Promise<ApiResponse> => {
      idx = i;
      if (i < this.middleware.length) {
        return this.middleware[i](req, () => dispatch(i + 1));
      }
      return runHandler();
    };
    return dispatch(0);
  }
}

function splitPath(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0);
}

// ---- Standard middleware ----

// Resolves a bearer token to a user/tenant via the supplied lookup.
export function authMiddleware(
  lookup: (token: string) => { userId: string; tenantId: string } | null,
): Middleware {
  return async (req, next) => {
    const auth = req.headers["authorization"] ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const identity = token ? lookup(token) : null;
    if (!identity) return json(401, { error: "Unauthorized" });
    req.userId = identity.userId;
    req.tenantId = identity.tenantId;
    return next();
  };
}

// Records request count + latency into a metrics-like sink.
export function loggingMiddleware(
  sink: (entry: { method: string; path: string; status: number }) => void,
): Middleware {
  return async (req, next) => {
    const res = await next();
    sink({ method: req.method, path: req.path, status: res.status });
    return res;
  };
}
