const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504, 521, 522, 523, 524]);

type FetchImplementation = typeof fetch;

function requestMethod(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  return input instanceof Request ? input.method.toUpperCase() : "GET";
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Retries only safe, read-only Supabase requests.  In particular, OTP inserts
 * and WhatsApp sends are never retried here: retrying those could duplicate a
 * login challenge or a message after an uncertain network response.
 */
export async function fetchWithSupabaseTransientRetry(
  input: RequestInfo | URL,
  init?: RequestInit,
  fetchImplementation: FetchImplementation = fetch
) {
  const method = requestMethod(input, init);
  const retryable = method === "GET" || method === "HEAD";
  const attempts = retryable ? 3 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetchImplementation(input, init);
      if (!retryable || !TRANSIENT_STATUSES.has(response.status) || attempt === attempts - 1) return response;
      await delay(200 * (attempt + 1));
    } catch (error) {
      lastError = error;
      if (!retryable || attempt === attempts - 1) throw error;
      await delay(200 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Supabase request failed.");
}
