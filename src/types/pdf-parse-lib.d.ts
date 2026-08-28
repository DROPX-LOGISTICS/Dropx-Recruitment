declare module "pdf-parse/lib/pdf-parse.js" {
  type PdfResult = { text: string; numpages: number; numrender: number; info: unknown; metadata: unknown; version: string };
  export default function parsePdf(data: Buffer | Uint8Array, options?: Record<string, unknown>): Promise<PdfResult>;
}
