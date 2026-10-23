import { redirect } from "next/navigation";
import { MCP_RESOURCE, MCP_SCOPE } from "@/lib/mcp/constants";
import { isAllowedMcpRedirectUri } from "@/lib/mcp/redirect-uri";
import { getMcpClient } from "@/lib/mcp/store";
import { mcpUserHasRecruitAccess, withCompanyId } from "@/lib/mcp/authorization";
import { getRecruitmentWebSession } from "@/lib/recruitment-web-session";
import { requiredEnv } from "@/lib/recruitment-api";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export default async function McpConsentPage({
  searchParams
}: {
  searchParams: SearchParams;
}) {
  const clientId = one(searchParams.client_id).trim();
  const redirectUri = one(searchParams.redirect_uri).trim();
  const codeChallenge = one(searchParams.code_challenge).trim();
  const state = one(searchParams.state);
  const scope = one(searchParams.scope).trim() || MCP_SCOPE;
  const resource = one(searchParams.resource).trim() || MCP_RESOURCE;

  const session = await getRecruitmentWebSession();
  if (!session) {
    const next = `/mcp/consent?${new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      scope,
      resource,
      ...(state ? { state } : {})
    }).toString()}`;
    redirect(`/?next=${encodeURIComponent(next)}`);
  }
  const auth = withCompanyId(session, requiredEnv("RECRUITMENT_COMPANY_ID"));
  if (!mcpUserHasRecruitAccess(auth)) {
    redirect("/?reason=recruit-mcp-denied");
  }
  if (!clientId || !redirectUri || !codeChallenge || !isAllowedMcpRedirectUri(redirectUri)) {
    redirect("/?reason=mcp-consent");
  }

  const client = await getMcpClient(clientId);
  const clientName = client?.client_name || "Claude";

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        background: "linear-gradient(160deg, #17202f 0%, #2a1a24 55%, #17202f 100%)",
        color: "#f8fafc"
      }}
    >
      <form
        method="POST"
        action="/api/mcp/oauth/authorize"
        style={{
          width: "min(28rem, 100%)",
          display: "grid",
          gap: "1.25rem",
          padding: "1.75rem",
          borderRadius: "1rem",
          background: "rgba(23, 32, 47, 0.92)",
          border: "1px solid rgba(212, 39, 90, 0.25)"
        }}
      >
        <div>
          <p style={{ margin: 0, fontSize: "0.75rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#fda4af" }}>
            DropX Recruit MCP
          </p>
          <h1 style={{ margin: "0.35rem 0 0", fontSize: "1.5rem", fontWeight: 650 }}>
            Allow {clientName} read-only Recruit access?
          </h1>
          <p style={{ margin: "0.75rem 0 0", lineHeight: 1.5, color: "#e2e8f0" }}>
            {clientName} can query hiring funnel counts, SLA queues, ad status and requisition summaries within your
            existing Recruit permissions. It cannot change leads, read WhatsApp bodies, CV text, or offer letters.
          </p>
        </div>
        <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#fda4af", lineHeight: 1.55 }}>
          <li>Signed in as {auth.email || auth.displayName || auth.profileId}</li>
          <li>Workforce: {auth.workforce ? "yes" : "no"} · HR: {auth.hr ? "yes" : "no"}</li>
          <li>Scope: {scope}</li>
          <li>Resource: {resource}</li>
        </ul>
        <input type="hidden" name="client_id" value={clientId} />
        <input type="hidden" name="redirect_uri" value={redirectUri} />
        <input type="hidden" name="code_challenge" value={codeChallenge} />
        <input type="hidden" name="scope" value={scope} />
        <input type="hidden" name="resource" value={resource} />
        {state ? <input type="hidden" name="state" value={state} /> : null}
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="submit"
            name="decision"
            value="deny"
            style={{
              flex: 1,
              padding: "0.7rem 1rem",
              borderRadius: "0.55rem",
              border: "1px solid rgba(212, 39, 90, 0.35)",
              background: "transparent",
              color: "#f8fafc",
              cursor: "pointer"
            }}
          >
            Deny
          </button>
          <button
            type="submit"
            name="decision"
            value="allow"
            style={{
              flex: 1,
              padding: "0.7rem 1rem",
              borderRadius: "0.55rem",
              border: "none",
              background: "#d4275a",
              color: "#fff",
              fontWeight: 650,
              cursor: "pointer"
            }}
          >
            Allow
          </button>
        </div>
      </form>
    </main>
  );
}
