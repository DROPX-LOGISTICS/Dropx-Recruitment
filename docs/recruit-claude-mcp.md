# DropX Recruit — Claude remote MCP

Connect Claude (claude.ai or Claude Desktop) to read-only Recruit hiring summaries using OAuth 2.1 + PKCE against the shared `mcp_oauth_*` tables used by Ops and People.

## Connector URL

- **MCP resource:** `https://recruit.dropxlogistics.com/mcp`
- **OAuth scope:** `recruit.read`
- **Protected resource metadata:** `https://recruit.dropxlogistics.com/.well-known/oauth-protected-resource`
- **Authorization server metadata:** `https://recruit.dropxlogistics.com/.well-known/oauth-authorization-server`

In Claude, add a **remote MCP connector** pointing at `https://recruit.dropxlogistics.com/mcp`. Claude discovers OAuth endpoints from the well-known URLs above.

## Who can connect

Users need an active **Recruit** product membership (`company_product_memberships.product_code = recruit`), a live `recruitment_user_access` row, and at least one Recruit menu view permission (or Owner). Consent is shown at `/mcp/consent` after Google or WhatsApp web login (httpOnly session cookie).

## Read-only tools (aggregates)

| Tool | Purpose |
|------|---------|
| `recruit_list_scope` | Permission scope summary (no lead directory dump) |
| `recruit_dashboard_summary` | Dashboard funnel counts (total, no status, callbacks, etc.) |
| `recruit_lead_status_summary` | Lead counts grouped by status |
| `recruit_sla_queues` | SLA queue counts (no status / callback / stale buckets) |
| `recruit_interview_summary` | Interview window outcome counts (no names or phones) |
| `recruit_ads_summary` | Active ad counts by delivery and route status |
| `recruit_unmapped_count` | Unmapped intake leads needing station/role mapping |
| `recruit_requisition_summary` | Open requisition counts and remaining openings |
| `recruit_reports_snapshot` | Available operational report types (no XLSX export) |

## Explicitly excluded

The MCP layer must **not** expose:

- Candidate names, phone numbers, email, or full lead rows
- WhatsApp message bodies or conversation exports
- CV/resume text, offer letters, or document binaries
- Write, approve, or publish actions

Tokens are read-only; tool names matching write/approve patterns are rejected at the protocol layer.

## Supabase

Recruit uses the same shared Supabase project as Ops/People. Reuse the existing `mcp_oauth_clients`, `mcp_oauth_codes`, and `mcp_oauth_tokens` tables (created by Ops migration `20261023120000_ops_mcp_oauth.sql`). A copy migration `supabase/migrations/20261023130000_recruit_mcp_oauth.sql` is included for repos that track migrations separately; apply it only if those tables are not already present in your environment.

## Local tests

```bash
npm run test:mcp
```
