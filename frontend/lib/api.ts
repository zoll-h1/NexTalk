function isLocalFrontendDevServer(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const { hostname, port } = window.location;
  return (
    (hostname === "localhost" || hostname === "127.0.0.1") &&
    port !== "" &&
    !["80", "443", "8000"].includes(port)
  );
}

function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL;
  }

  if (isLocalFrontendDevServer()) {
    return `http://${window.location.hostname}:8000/api/v1`;
  }

  return "/api/v1";
}

function getWsBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }

  if (typeof window === "undefined") {
    return "ws://localhost:8000/ws";
  }

  if (isLocalFrontendDevServer()) {
    return `ws://${window.location.hostname}:8000/ws`;
  }

  return `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/ws`;
}

const API_BASE_URL = getApiBaseUrl();
const WS_BASE_URL = getWsBaseUrl();

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function parseResponsePayload(raw: string, contentType: string | null): unknown {
  if (!raw) {
    return null;
  }

  const looksLikeJson =
    contentType?.includes("application/json") ||
    contentType?.includes("+json") ||
    raw.startsWith("{") ||
    raw.startsWith("[");

  if (!looksLikeJson) {
    return raw;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function getPayloadMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const detail = "detail" in payload ? payload.detail : null;
  if (typeof detail === "string") {
    return detail;
  }

  const message = "message" in payload ? payload.message : null;
  if (typeof message === "string") {
    return message;
  }

  return null;
}

type PrimitiveBody = string | Blob | FormData | URLSearchParams | ArrayBuffer;

interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  accessToken?: string;
  body?: PrimitiveBody | object | null;
}

function isPrimitiveBody(value: unknown): value is PrimitiveBody {
  return (
    typeof value === "string" ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ArrayBuffer
  );
}

export async function apiRequest<T>(
  path: string,
  { accessToken, body, headers, ...init }: ApiRequestOptions = {},
): Promise<T> {
  const requestHeaders = new Headers(headers);
  let requestBody: BodyInit | undefined;

  if (body !== undefined && body !== null) {
    if (isPrimitiveBody(body)) {
      requestBody = body;
    } else {
      requestHeaders.set("Content-Type", "application/json");
      requestBody = JSON.stringify(body);
    }
  }

  if (accessToken) {
    requestHeaders.set("Authorization", `Bearer ${accessToken}`);
  }

  const response = await fetch(
    path.startsWith("http://") || path.startsWith("https://") ? path : `${API_BASE_URL}${path}`,
    {
      ...init,
      body: requestBody,
      cache: "no-store",
      credentials: "include",
      headers: requestHeaders,
    },
  );

  const raw = await response.text();
  const payload = parseResponsePayload(raw, response.headers.get("content-type"));

  if (!response.ok) {
    const message =
      getPayloadMessage(payload) ||
      (typeof payload === "string" && payload.includes("<!DOCTYPE")
        ? "Received HTML instead of the API response. Set NEXT_PUBLIC_API_URL to http://localhost:8000/api/v1 when running the frontend locally."
        : typeof payload === "string" && payload.trim()
          ? payload
          : response.statusText || "Request failed");
    throw new ApiError(message, response.status, payload);
  }

  if (typeof payload === "string" && payload.includes("<!DOCTYPE")) {
    throw new Error(
      "Received HTML instead of JSON from the API. Set NEXT_PUBLIC_API_URL to http://localhost:8000/api/v1 when running the frontend locally.",
    );
  }

  return payload as T;
}

export { API_BASE_URL, WS_BASE_URL };
