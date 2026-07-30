import { NextRequest, NextResponse } from "next/server";

// Read at request time (not build time) so the same image works against any
// backend host via a plain runtime env var - see docker-compose.yml.
function backendUrl(): string {
  return process.env.BACKEND_URL || "http://localhost:8000";
}

async function proxy(request: NextRequest, path: string[]): Promise<NextResponse> {
  const target = new URL(`${backendUrl()}/${path.join("/")}`);
  target.search = request.nextUrl.search;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const hasBody = !["GET", "HEAD"].includes(request.method);

  const response = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
  });

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");

  return new NextResponse(response.body, {
    status: response.status,
    headers: responseHeaders,
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  return proxy(request, (await params).path);
}
