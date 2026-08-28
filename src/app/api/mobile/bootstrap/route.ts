import { NextResponse } from "next/server";
import { canApproveManualPunch } from "@/lib/manual-punch";
import { resolveMobileSession } from "@/lib/mobile-session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

export async function GET(request: Request) {
  try {
    const session = await resolveMobileSession(request, required("RECRUITMENT_COMPANY_ID"));
    if (!session) {
      return NextResponse.json(
        { authenticated: false, error: "Session expired or unavailable." },
        { status: 401 }
      );
    }
    return NextResponse.json(
      {
        authenticated: true,
        user: {
        profileId: session.profileId,
        name: session.displayName,
        email: session.email,
        workforce: session.workforce,
        hr: session.hr,
        allLocations: session.allLocations,
        manageMasters: session.manageMasters,
        manageAds: session.manageAds,
        manageUsers: session.manageUsers,
        accessTemplate: session.accessTemplate,
        menuPermissions: session.menuPermissions,
        webMenuPermissions: session.webMenuPermissions,
        mobileMenuPermissions: session.mobileMenuPermissions,
        menuAccess: session.menuAccess,
        menuActions: session.menuActions,
        adRequestActions: session.adRequestActions,
        recruitmentFunction: session.recruitmentFunction,
        trackPerformance: session.trackPerformance,
        reportingManagerProfileId: session.reportingManagerProfileId,
        designationCode: session.designationCode,
        isOwner: session.isOwner,
        canPreviewUsers: session.canPreviewUsers,
        canApproveManualPunch: canApproveManualPunch(session),
        isPreview: session.isPreview,
        viewerProfileId: session.viewerProfileId,
        previewProfileId: session.previewProfileId,
        readOnly: session.readOnly,
        locationIds: session.locationIds,
        roleIds: session.roleIds
        }
      },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("Recruitment mobile bootstrap failed", error);
    return NextResponse.json(
      { authenticated: false, error: "Unable to restore the mobile session." },
      { status: 500 }
    );
  }
}
