/**
 * Meta Marketing API concurrent object-edit limit (error 613 / 4841018):
 * one POST edit per object every 30 seconds, per app.
 * @see https://developers.facebook.com/docs/marketing-api/overview/rate-limiting/
 */
export const META_OBJECT_EDIT_INTERVAL_MS = 30_000;

const lastEditAt = new Map<string, number>();
const objectTail = new Map<string, Promise<unknown>>();

export type MetaRateLimitErrorLike = {
  metaCode?: number;
  metaSubcode?: number;
  message?: string;
  code?: number;
  error_subcode?: number;
};

export function isMetaConcurrentObjectEditLimit(error: unknown): boolean {
  const err = error as MetaRateLimitErrorLike | null;
  const code = Number(err?.metaCode ?? err?.code);
  const subcode = Number(err?.metaSubcode ?? err?.error_subcode);
  if (code === 613 && subcode === 4841018) return true;
  const message = String(err?.message || error || "");
  return /613/.test(message)
    && (/4841018/.test(message) || /concurrent request rate limit/i.test(message));
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/** Reset in-memory edit clocks (tests only). */
export function resetMetaObjectEditThrottle() {
  lastEditAt.clear();
  objectTail.clear();
}

/**
 * Serialize POST edits to the same Meta object and space them ≥30s apart.
 * Retries 613/4841018 with an increasing delay (Meta guidance).
 */
export async function withMetaObjectEditGate<T>(
  objectId: string,
  run: () => Promise<T>,
  options?: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    maxRetries?: number;
  }
): Promise<T> {
  const id = String(objectId || "").trim();
  if (!id) return run();

  const clock = options?.now ?? Date.now;
  const wait = options?.sleep ?? sleep;
  const maxRetries = options?.maxRetries ?? 3;

  const previous = objectTail.get(id) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => gate);
  objectTail.set(id, chained.catch(() => undefined));

  await previous.catch(() => undefined);
  try {
    for (let attempt = 0; ; attempt++) {
      const previousAt = lastEditAt.get(id);
      if (previousAt !== undefined) {
        const gap = META_OBJECT_EDIT_INTERVAL_MS - (clock() - previousAt);
        if (gap > 0) await wait(gap);
      }
      try {
        const result = await run();
        lastEditAt.set(id, clock());
        return result;
      } catch (error) {
        lastEditAt.set(id, clock());
        if (!isMetaConcurrentObjectEditLimit(error) || attempt >= maxRetries) throw error;
        await wait(META_OBJECT_EDIT_INTERVAL_MS * (attempt + 1));
      }
    }
  } finally {
    release();
    if (objectTail.get(id) === chained) objectTail.delete(id);
  }
}
