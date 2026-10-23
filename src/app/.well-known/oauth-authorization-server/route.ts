import { buildAuthorizationServerMetadata } from "@/lib/mcp/oauth-metadata";
import { MCP_RECRUIT_ORIGIN } from "@/lib/mcp/constants";

export const dynamic = "force-dynamic";

function originFromRequest(request: Request) {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  if (host.toLowerCase().startsWith("recruit.")) {
    const proto = request.headers.get("x-forwarded-proto") ?? "https";
    return `${proto}://${host.split(":")[0]}`;
  }
  return MCP_RECRUIT_ORIGIN;
}

export async function GET(request: Request) {
  return Response.json(buildAuthorizationServerMetadata(originFromRequest(request)), {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
