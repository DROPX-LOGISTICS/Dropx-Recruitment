import { supabaseAdmin } from "./supabase-admin";

export type MainDashboardStation = {
  id: string;
  code: string;
  name: string;
  state: string | null;
  region: string | null;
  cluster: string | null;
  address: string | null;
  managerEmail: string | null;
  managerId: string | null;
  managerName: string | null;
  isActive: boolean;
};

export type MainDashboardHiringManager = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  employeeId: string | null;
  roleCode: string | null;
  roleName: string | null;
  reportsToUserId: string | null;
  locationScopeIds: string[];
};

function normalized(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export async function loadMainDashboardHiringManagers(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const [profiles, roles] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("id,full_name,email,mobile,phone,employee_id,role,role_id,reports_to_user_id,location_scope_ids,is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .order("full_name"),
    supabaseAdmin
      .from("user_roles")
      .select("id,code,name,is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
  ]);
  if (profiles.error) throw new Error(profiles.error.message);
  if (roles.error) throw new Error(roles.error.message);
  const roleById = new Map((roles.data ?? []).map((role) => [role.id, role]));
  return (profiles.data ?? []).map((profile) => {
    const role = roleById.get(profile.role_id);
    return {
      id: profile.id,
      name: profile.full_name || profile.email || profile.employee_id || "DropX user",
      email: profile.email,
      phone: profile.mobile || profile.phone || null,
      employeeId: profile.employee_id,
      roleCode: String(profile.role || role?.code || "").trim().toUpperCase() || null,
      roleName: role?.name || null,
      reportsToUserId: profile.reports_to_user_id,
      locationScopeIds: Array.isArray(profile.location_scope_ids) ? profile.location_scope_ids : []
    } satisfies MainDashboardHiringManager;
  });
}

export async function loadMainDashboardStations(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const [stations, profiles] = await Promise.all([
    supabaseAdmin
      .from("stations")
      .select("id,station_code,station_name,address,address_line1,address_line2,state,region,cluster,station_manager_email,is_active,hide_from_location_list")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("hide_from_location_list", false)
      .order("station_code"),
    supabaseAdmin
      .from("profiles")
      .select("id,full_name,email,employee_id,role,is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
  ]);
  if (stations.error) throw new Error(stations.error.message);
  if (profiles.error) throw new Error(profiles.error.message);
  const profileByEmail = new Map(
    (profiles.data ?? []).map((profile) => [normalized(profile.email), profile])
  );
  return (stations.data ?? []).map((station) => {
    const manager = profileByEmail.get(normalized(station.station_manager_email));
    return {
      id: station.id,
      code: String(station.station_code ?? "").trim().toUpperCase(),
      name: station.station_name || station.station_code || "Station",
      state: station.state,
      region: station.region,
      cluster: station.cluster,
      address: [station.address_line1, station.address_line2].filter(Boolean).join(", ") || station.address,
      managerEmail: station.station_manager_email,
      managerId: manager?.id ?? null,
      managerName: manager?.full_name ?? station.station_manager_email ?? null,
      isActive: station.is_active !== false
    } satisfies MainDashboardStation;
  }).filter((station) => station.code);
}

export async function resolveMainDashboardManager(companyId: string, managerId: string, stationCode?: string | null) {
  const stations = await loadMainDashboardStations(companyId);
  const station = stationCode
    ? stations.find((item) => item.code === String(stationCode).trim().toUpperCase())
    : null;
  const allowed = station?.managerId === managerId;
  if (!station || !allowed) return null;
  return {
    id: station.managerId!,
    name: station.managerName || station.managerEmail || "Mapped manager",
    email: station.managerEmail,
    stationCode: station.code
  };
}

export function defaultHiringManagerFor(
  station: MainDashboardStation | null | undefined,
  roleCode: string | null | undefined,
  managers: MainDashboardHiringManager[]
) {
  if (!station) return null;
  const stationManager = managers.find((item) => item.id === station.managerId)
    ?? managers.find((item) => normalized(item.email) === normalized(station.managerEmail))
    ?? null;
  if (String(roleCode ?? "").trim().toUpperCase() === "SSA") return stationManager;
  const reportingManager = stationManager?.reportsToUserId
    ? managers.find((item) => item.id === stationManager.reportsToUserId) ?? null
    : null;
  if (reportingManager) return reportingManager;
  const scopedClusterManager = managers.find((item) =>
    ["CLM", "CLUSTER_MANAGER"].includes(String(item.roleCode ?? "").toUpperCase())
    && item.locationScopeIds.includes(station.id)
  );
  return scopedClusterManager ?? stationManager;
}

export async function resolveNetworkHiringManager(
  companyId: string,
  managerId: string,
  stationCode?: string | null,
  roleCode?: string | null
) {
  const [stations, managers] = await Promise.all([
    loadMainDashboardStations(companyId),
    loadMainDashboardHiringManagers(companyId)
  ]);
  const manager = managers.find((item) => item.id === managerId);
  if (!manager) return null;
  const station = stationCode
    ? stations.find((item) => item.code === String(stationCode).trim().toUpperCase()) ?? null
    : null;
  const recommended = defaultHiringManagerFor(station, roleCode, managers);
  return {
    ...manager,
    stationCode: station?.code ?? null,
    isRecommended: recommended?.id === manager.id
  };
}
