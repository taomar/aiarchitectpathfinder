function compactSnippet(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

function looksLikeHtml(value: string) {
  return /^\s*(?:<!doctype\s+html|<html|<head|<body)\b/i.test(value);
}

type ResponseLike = Pick<Response, "status"> & { redirected?: boolean; type?: ResponseType };

function isAuthLikeResponse(response: ResponseLike, snippet: string) {
  return (
    response.status === 0 ||
    (response.status >= 300 && response.status < 400) ||
    response.status === 401 ||
    response.status === 403 ||
    response.redirected ||
    response.type === "opaqueredirect" ||
    /\b(?:login|sign\s*in|signin|unauthorized|forbidden|access denied)\b/i.test(snippet)
  );
}

export function jsonResponseFailureMessage(response: ResponseLike, context: string, contentType: string, body: string) {
  const statusLabel = response.status ? `HTTP ${response.status}` : "HTTP response";
  const snippet = compactSnippet(body);
  if (isAuthLikeResponse(response, snippet)) {
    return `${context} could not use the current browser session. Refresh after signing in and retry.`;
  }
  if (looksLikeHtml(snippet)) {
    return `${context} returned HTML instead of JSON (${statusLabel}). Pathfinder is showing the deterministic recommendation.`;
  }

  const responseType = contentType.trim() || "a non-JSON response";
  return `${context} returned ${responseType} instead of JSON (${statusLabel}). Pathfinder is showing the deterministic recommendation.`;
}

export async function readJsonResponse<T>(response: Response, context: string): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  const statusLabel = response.status ? `HTTP ${response.status}` : "HTTP response";

  if (/\bjson\b/i.test(contentType)) {
    try {
      return (await response.json()) as T;
    } catch {
      throw new Error(`${context} returned invalid JSON (${statusLabel}). Pathfinder is showing the deterministic recommendation.`);
    }
  }

  let body = "";
  try {
    body = await response.text();
  } catch {
    /* ignore body read failures */
  }
  throw new Error(jsonResponseFailureMessage(response, context, contentType, body));
}