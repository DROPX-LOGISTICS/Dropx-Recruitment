/** Read every page with a stable order; fail instead of serving partial evidence. */
export async function recruitmentQueryPages(load: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: any }>) {
  const all: any[] = [];
  for (let offset = 0; offset < 100000; offset += 1000) {
    const page = await load(offset, offset + 999);
    if (page.error) throw page.error;
    all.push(...(page.data || []));
    if ((page.data?.length || 0) < 1000) return all;
  }
  throw new Error("The result exceeded the supported review size. Incomplete evidence was discarded.");
}
