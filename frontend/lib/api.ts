const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const WS_BASE_URL = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000/ws";

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
  const payload = raw ? JSON.parse(raw) : null;

  if (!response.ok) {
    const message =
      typeof payload?.detail === "string"
        ? payload.detail
        : typeof payload?.message === "string"
          ? payload.message
          : response.statusText || "Request failed";
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}

export { API_BASE_URL, WS_BASE_URL };
