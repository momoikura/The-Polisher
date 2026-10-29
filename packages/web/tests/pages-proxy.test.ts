import { afterEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/[[path]].js";

const env = { BACKEND_URL: "https://ws--thepolisher-web-api.modal.run", PROXY_SECRET: "s3cret" };

function mockFetch(...responses: Response[]) {
  const fn = vi.fn(async (_url: URL, _init?: RequestInit) => responses.shift() ?? new Response("none", { status: 500 }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("Cloudflare Pages proxy", () => {
  it("forwards the path, query, method and body to the backend with the proxy secret", async () => {
    const fetch = mockFetch(new Response("{}", { status: 201 }));
    const request = new Request("https://thepolisher.pages.dev/api/maintainer?x=1", {
      method: "POST",
      headers: { origin: "https://thepolisher.pages.dev", cookie: "tp_session=abc" },
      body: '{"issueUrl":"u"}',
    });

    const response = await onRequest({ request, env });

    expect(response.status).toBe(201);
    const [url, init] = fetch.mock.calls[0];
    expect(url.toString()).toBe("https://ws--thepolisher-web-api.modal.run/api/maintainer?x=1");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-thepolisher-proxy")).toBe("s3cret");
    expect(headers.get("cookie")).toBe("tp_session=abc");
    expect(headers.get("origin")).toBe("https://thepolisher.pages.dev");
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"issueUrl":"u"}');
    expect(init?.redirect).toBe("manual");
  });

  it("passes the app's own sign-in redirects and cookies through to the browser", async () => {
    const fetch = mockFetch(new Response(null, { status: 302, headers: { location: "/", "set-cookie": "tp_session=new; HttpOnly" } }));

    const response = await onRequest({ request: new Request("https://thepolisher.pages.dev/api/auth/callback?code=c"), env });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("set-cookie")).toContain("tp_session=new");
  });

  it("follows Modal's long-request 303 on the backend so the browser never sees the backend address", async () => {
    const fetch = mockFetch(
      new Response(null, { status: 303, headers: { location: "/api/maintainer/id/events?__modal_function_call_id=fc" } }),
      new Response("data: {}\n\n", { status: 200 })
    );

    const response = await onRequest({ request: new Request("https://thepolisher.pages.dev/api/maintainer/id/events"), env });

    expect(response.status).toBe(200);
    expect(fetch.mock.calls[1][0].toString()).toBe("https://ws--thepolisher-web-api.modal.run/api/maintainer/id/events?__modal_function_call_id=fc");
  });

  it("does not follow a 303 that points somewhere other than the backend", async () => {
    mockFetch(new Response(null, { status: 303, headers: { location: "https://elsewhere.example/" } }));

    const response = await onRequest({ request: new Request("https://thepolisher.pages.dev/api/x"), env });

    expect(response.status).toBe(303);
  });

  it("refuses with 503 when the backend isn't configured", async () => {
    const response = await onRequest({ request: new Request("https://thepolisher.pages.dev/api/x"), env: { BACKEND_URL: "", PROXY_SECRET: "" } });

    expect(response.status).toBe(503);
  });
});
