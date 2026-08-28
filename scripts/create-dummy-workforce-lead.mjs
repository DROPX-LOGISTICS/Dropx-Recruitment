import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  return readFile(path, "utf8").then((text) => Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = /^([^#=]+)=(.*)$/.exec(line);
    if (!match) return [];
    const value = match[2].trim().replace(/^"(.*)"$/, "$1");
    return [[match[1].trim(), value]];
  })));
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value || value === "[SENSITIVE]") throw new Error(`${name} is missing. Pass an env file with real credentials.`);
  return value;
}

function normalizePhone(value) {
  const digits = String(value ?? "").replace(/\D/g, "").slice(-10);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

const envPath = process.argv[2] || ".env.production.local";
const env = await loadEnv(envPath);
const url = required(env, "NEXT_PUBLIC_SUPABASE_URL");
const key = required(env, "SUPABASE_SERVICE_ROLE_KEY");
let companyId = env.RECRUITMENT_COMPANY_ID?.trim();
if (!companyId || companyId === "[SENSITIVE]") companyId = null;

const fullName = process.argv[3] || "Joseph Mathew";
const phone = normalizePhone(process.argv[4] || "9876501234");
const stationCode = (process.argv[5] || "PMB").toUpperCase();
const roleCode = (process.argv[6] || "DA").toUpperCase();

if (!phone) throw new Error("Provide a valid 10-digit Indian mobile number.");

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
if (!companyId) {
  const company = await db.from("companies").select("id").eq("code", "DROPX_LOGISTICS").maybeSingle();
  if (company.error) throw new Error(company.error.message);
  if (!company.data?.id) throw new Error("DROPX_LOGISTICS company was not found.");
  companyId = company.data.id;
}
const now = new Date().toISOString();
const slug = fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const metaLeadId = `test-${slug}-${roleCode.toLowerCase()}-${Date.now()}`;
const adName = `TEST_${roleCode}_${slug.toUpperCase()}`;
const canonicalKey = `application:${adName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${phone}`;

const [location, role, existing] = await Promise.all([
  db.from("recruitment_locations").select("id,code,name").eq("company_id", companyId).eq("code", stationCode).maybeSingle(),
  db.from("recruitment_roles").select("id,code,name,stream").eq("company_id", companyId).eq("code", roleCode).maybeSingle(),
  db.from("recruitment_leads").select("id,full_name,phone,status").eq("company_id", companyId).eq("canonical_key", canonicalKey).maybeSingle()
]);

if (location.error) throw new Error(location.error.message);
if (role.error) throw new Error(role.error.message);
if (existing.error) throw new Error(existing.error.message);
if (!location.data) throw new Error(`Station ${stationCode} was not found for this company.`);
if (!role.data) throw new Error(`Role ${roleCode} was not found for this company.`);

if (existing.data) {
  console.log(JSON.stringify({
    reused: true,
    leadId: existing.data.id,
    fullName: existing.data.full_name,
    phone: existing.data.phone,
    status: existing.data.status,
    searchHint: `Search "${fullName}" or ${phone} in Workforce Queue`
  }, null, 2));
  process.exit(0);
}

const inserted = await db.from("recruitment_leads").insert({
  id: randomUUID(),
  company_id: companyId,
  meta_lead_id: metaLeadId,
  canonical_key: canonicalKey,
  normalized_phone: phone,
  full_name: fullName,
  phone,
  email: `${slug.replace(/-/g, ".")}@example.test`,
  city: location.data.name,
  post_code: "673525",
  location_id: location.data.id,
  role_id: role.data.id,
  stream: role.data.stream || "workforce",
  ad_name: adName,
  source: "manual_test",
  status: "",
  remarks: "Dummy DA profile for Joseph Mathew — safe to archive after testing.",
  questionnaire: {
    full_name: fullName,
    phone_number: phone,
    city: location.data.name,
    post_code: "673525",
    vehicle_type: "Two Wheeler",
    source_note: "Created by scripts/create-dummy-workforce-lead.mjs"
  },
  duplicate_count: 1,
  total_attempts: 0,
  no_response_attempts: 0,
  call_back_attempts: 0,
  archived: false,
  lead_created_at: now,
  created_at: now,
  updated_at: now
}).select("id,full_name,phone,status,stream").single();

if (inserted.error) throw new Error(inserted.error.message);

const history = await db.from("recruitment_lead_history").insert({
  id: randomUUID(),
  company_id: companyId,
  lead_id: inserted.data.id,
  event_type: "manual_test_lead_created",
  field_name: "source",
  old_value: null,
  new_value: "manual_test",
  remarks: `Dummy ${role.data.name} profile created for queue testing.`,
  actor_email: "system:dummy_lead_script",
  created_at: now,
  metadata: {
    station_code: location.data.code,
    role_code: role.data.code,
    ad_name: adName,
    meta_lead_id: metaLeadId
  }
});

if (history.error) throw new Error(history.error.message);

console.log(JSON.stringify({
  created: true,
  leadId: inserted.data.id,
  fullName: inserted.data.full_name,
  phone: inserted.data.phone,
  role: `${role.data.code} — ${role.data.name}`,
  station: `${location.data.code} — ${location.data.name}`,
  status: inserted.data.status || "(new / unattempted)",
  stream: inserted.data.stream,
  searchHint: `Open Workforce Queue and search "${fullName}" or ${phone}`
}, null, 2));
