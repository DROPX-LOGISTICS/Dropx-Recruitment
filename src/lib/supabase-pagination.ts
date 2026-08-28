export type SupabasePage<T> = {
  data: T[] | null;
  error: { message: string } | null;
};

/**
 * Supabase projects commonly cap every response at 1,000 rows even when a
 * larger `.limit()` is requested. Performance reports must read every page or
 * manager totals will silently disagree with an individual's action history.
 */
export async function loadAllSupabaseRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SupabasePage<T>>,
  options: { pageSize?: number; maxRows?: number } = {}
) {
  const pageSize = options.pageSize ?? 1000;
  const maxRows = options.maxRows ?? 250_000;
  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    if (page.error) throw new Error(page.error.message);
    const values = page.data ?? [];
    rows.push(...values);
    if (values.length < pageSize) return rows;
  }

  throw new Error(`Performance source exceeded the ${maxRows.toLocaleString("en-IN")} row safety limit.`);
}
