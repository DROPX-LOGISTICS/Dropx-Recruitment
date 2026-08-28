import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse";

const envPath = process.argv[2];
if (!envPath) throw new Error("Environment file path is required.");
const envText = await readFile(envPath, "utf8");
const env = Object.fromEntries(envText.split(/\r?\n/).flatMap((line) => {
  const match = /^([^#=]+)=(.*)$/.exec(line);
  if (!match) return [];
  const value = match[2].trim().replace(/^"(.*)"$/, "$1").replace(/\\n/g, "\n");
  return [[match[1].trim(), value]];
}));
const required = (name) => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is missing.`);
  return value;
};
const companyId = required("RECRUITMENT_COMPANY_ID");
const db = createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { autoRefreshToken: false, persistSession: false }
});

const response = await fetch(
  "https://docs.google.com/spreadsheets/d/1TQK61by7duJ0dpkoAlQbBC75OBKQzynaEsQNAJClPIk/gviz/tq?tqx=out:csv&sheet=WhatsAppLog"
);
if (!response.ok) throw new Error(`WhatsAppLog export failed with HTTP ${response.status}.`);
const parsed = Papa.parse(await response.text(), {
  header: true,
  skipEmptyLines: "greedy",
  transformHeader: (header) => header.trim().toLowerCase()
});
if (parsed.errors.some((error) => error.type === "Quotes")) throw new Error(parsed.errors[0].message);

const leadIdByMeta = new Map();
for (let start = 0; ; start += 1000) {
  const result = await db.from("recruitment_leads")
    .select("id,meta_lead_id")
    .eq("company_id", companyId)
    .not("meta_lead_id", "is", null)
    .range(start, start + 999);
  if (result.error) throw new Error(result.error.message);
  for (const row of result.data ?? []) leadIdByMeta.set(row.meta_lead_id, row.id);
  if ((result.data?.length ?? 0) < 1000) break;
}

const text = (value) => String(value ?? "").trim();
const timestamp = (value) => {
  const raw = text(value);
  if (!raw) return null;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})/.exec(raw);
  if (!match) return null;
  return new Date(Date.UTC(
    Number(match[3]), Number(match[2]) - 1, Number(match[1]),
    Number(match[4]) - 5, Number(match[5]) - 30, Number(match[6])
  )).toISOString();
};
const json = (value) => {
  const raw = text(value);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return { raw }; }
};

let imported = 0;
for (let start = 0; start < parsed.data.length; start += 250) {
  const records = parsed.data.slice(start, start + 250).flatMap((row) => {
    const phone = text(row.phone).replace(/\D/g, "").slice(-10);
    if (!phone) return [];
    const provider = json(row.response);
    const providerMessageId = provider?.messages?.[0]?.id ?? null;
    const status = text(row.status).toLowerCase() || "unknown";
    const metaLeadId = text(row.lead_id).replace(/^l:/i, "");
    const createdAt = timestamp(row.ts) ?? new Date().toISOString();
    return [{
      company_id: companyId,
      lead_id: leadIdByMeta.get(metaLeadId) ?? null,
      idempotency_key: `whatsapplog:${createHash("sha256").update(JSON.stringify(row)).digest("hex")}`,
      phone,
      template_name: text(row.template) || "legacy_message",
      template_parameters: json(row.message) ?? [],
      status,
      provider_message_id: providerMessageId,
      provider_response: provider,
      attempt_count: status === "sent" ? 1 : 0,
      sent_at: status === "sent" ? createdAt : null,
      failed_at: ["error","failed"].includes(status) ? createdAt : null,
      last_error: ["error","failed"].includes(status) ? text(row.response).slice(0, 2000) : null,
      created_at: createdAt,
      updated_at: createdAt
    }];
  });
  const saved = await db.from("recruitment_whatsapp_outbox")
    .upsert(records, { onConflict: "company_id,idempotency_key", ignoreDuplicates: true });
  if (saved.error) throw new Error(saved.error.message);
  imported += records.length;
  if ((start + records.length) % 5000 < 250) {
    console.log(`Processed ${Math.min(start + 250, parsed.data.length)} of ${parsed.data.length}`);
  }
}

console.log(JSON.stringify({ sourceRows: parsed.data.length, imported }));
