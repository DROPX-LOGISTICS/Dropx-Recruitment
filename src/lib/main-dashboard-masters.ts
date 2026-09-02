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
  clusterManager: PeopleClusterManager | null;
  clusterManagerStatus: "mapped" | "unmapped" | "ambiguous";
  operationalOwner: PeopleOperationalOwner | null;
  operationalOwnerStatus: "mapped" | "unmapped" | "ambiguous";
  operationalOwnerDesignation: string | null;
  isActive: boolean;
};

export type PeopleClusterManager = {
  profileId: string;
  peopleCode: string;
  name: string;
  email: string | null;
  locationScopeIds: string[];
};

export type PeopleClusterManagerCandidate = PeopleClusterManager & {
  peopleActive: boolean;
  profileActive: boolean;
};

export type PeopleOperationalOwner = PeopleClusterManager & {
  designationCode: string;
  designationName: string;
  ownerType: "cluster_manager" | "area_ops_manager";
};

export type PeopleOperationalOwnerCandidate = PeopleOperationalOwner & {
  peopleActive: boolean;
  profileActive: boolean;
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

export function resolvePeopleClusterManager(
  stationId: string,
  candidates: PeopleClusterManagerCandidate[]
) {
  const unique = new Map<string, PeopleClusterManager>();
  for (const candidate of candidates) {
    if (!candidate.peopleActive || !candidate.profileActive || !candidate.locationScopeIds.includes(stationId)) continue;
    unique.set(candidate.profileId, {
      profileId: candidate.profileId,
      peopleCode: candidate.peopleCode,
      name: candidate.name,
      email: candidate.email,
      locationScopeIds: candidate.locationScopeIds
    });
  }
  const matches = [...unique.values()];
  if (matches.length === 1) return { status: "mapped" as const, manager: matches[0] };
  if (matches.length > 1) return { status: "ambiguous" as const, manager: null };
  return { status: "unmapped" as const, manager: null };
}

function operationalOwnerType(designation: { code?: unknown; name?: unknown }) {
  const code = normalized(designation.code);
  const name = normalized(designation.name);
  if (code === "clm" || name === "cluster manager") return "cluster_manager" as const;
  if (code === "aom" || ["area ops manager", "area operations manager"].includes(name)) {
    return "area_ops_manager" as const;
  }
  return null;
}

export function resolvePeopleOperationalOwner(
  stationId: string,
  candidates: PeopleOperationalOwnerCandidate[]
) {
  for (const ownerType of ["cluster_manager", "area_ops_manager"] as const) {
    const unique = new Map<string, PeopleOperationalOwner>();
    for (const candidate of candidates) {
      if (candidate.ownerType !== ownerType
        || !candidate.peopleActive
        || !candidate.profileActive
        || !candidate.locationScopeIds.includes(stationId)) continue;
      unique.set(candidate.profileId, {
        profileId: candidate.profileId,
        peopleCode: candidate.peopleCode,
        name: candidate.name,
        email: candidate.email,
        locationScopeIds: candidate.locationScopeIds,
        designationCode: candidate.designationCode,
        designationName: candidate.designationName,
        ownerType: candidate.ownerType
      });
    }
    const matches = [...unique.values()];
    if (matches.length === 1) return {
      status: "mapped" as const,
      owner: matches[0],
      designationName: matches[0].designationName
    };
    if (matches.length > 1) return {
      status: "ambiguous" as const,
      owner: null,
      designationName: matches[0]?.designationName ?? null
    };
  }
  return { status: "unmapped" as const, owner: null, designationName: null };
}

async function loadPeopleOperationalOwners(companyId: string) {
  if (!supabaseAdmin) throw new Error("Supabase is not configured.");
  const designations = await supabaseAdmin
    .from("designations")
    .select("id,code,name,is_active")
    .eq("company_id", companyId)
    .eq("is_active", true);
  if (designations.error) throw new Error(designations.error.message);

  const ownerDesignations = (designations.data ?? []).flatMap((designation) => {
    const ownerType = operationalOwnerType(designation);
    return ownerType ? [{ ...designation, ownerType }] : [];
  });
  if (!ownerDesignations.length) return [];

  const designationIds = ownerDesignations.map((designation) => designation.id);
  const designationValues = [...new Set(ownerDesignations.flatMap((designation) => [
    String(designation.id ?? "").trim(),
    String(designation.code ?? "").trim(),
    String(designation.name ?? "").trim()
  ]).filter(Boolean))];
  const [employees, contractors, profiles] = await Promise.all([
    supabaseAdmin
      .from("employees")
      .select("employee_code,full_name,email,designation_id,is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .in("designation_id", designationIds),
    supabaseAdmin
      .from("contractors")
      .select("dropx_id,full_name,email,designation,is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .in("designation", designationValues),
    supabaseAdmin
      .from("profiles")
      .select("id,full_name,email,employee_id,location_scope_ids,is_active")
      .eq("company_id", companyId)
      .eq("is_active", true)
  ]);
  if (employees.error) throw new Error(employees.error.message);
  if (contractors.error) throw new Error(contractors.error.message);
  if (profiles.error) throw new Error(profiles.error.message);

  const designationById = new Map(ownerDesignations.map((designation) => [designation.id, designation]));
  const designationByLabel = new Map(ownerDesignations.flatMap((designation) => [
    [normalized(designation.id), designation] as const,
    [normalized(designation.code), designation] as const,
    [normalized(designation.name), designation] as const
  ]));
  const peopleByCode = new Map<string, {
    peopleCode: string;
    name: string;
    email: string | null;
    peopleActive: boolean;
    designationCode: string;
    designationName: string;
    ownerType: "cluster_manager" | "area_ops_manager";
  }>();
  for (const employee of employees.data ?? []) {
    const peopleCode = String(employee.employee_code ?? "").trim();
    const designation = designationById.get(employee.designation_id);
    if (!peopleCode || !designation) continue;
    peopleByCode.set(normalized(peopleCode), {
      peopleCode,
      name: employee.full_name || peopleCode,
      email: employee.email,
      peopleActive: employee.is_active !== false,
      designationCode: String(designation.code ?? "").trim().toUpperCase(),
      designationName: designation.name || designation.code || "Operational owner",
      ownerType: designation.ownerType
    });
  }
  for (const contractor of contractors.data ?? []) {
    const designation = designationByLabel.get(normalized(contractor.designation));
    const peopleCode = String(contractor.dropx_id ?? "").trim();
    if (!peopleCode || !designation) continue;
    peopleByCode.set(normalized(peopleCode), {
      peopleCode,
      name: contractor.full_name || peopleCode,
      email: contractor.email,
      peopleActive: contractor.is_active !== false,
      designationCode: String(designation.code ?? "").trim().toUpperCase(),
      designationName: designation.name || designation.code || "Operational owner",
      ownerType: designation.ownerType
    });
  }

  return (profiles.data ?? []).flatMap((profile) => {
    const person = peopleByCode.get(normalized(profile.employee_id));
    if (!person) return [];
    return [{
      profileId: profile.id,
      peopleCode: person.peopleCode,
      name: person.name || profile.full_name || person.peopleCode,
      email: profile.email || person.email,
      locationScopeIds: Array.isArray(profile.location_scope_ids) ? profile.location_scope_ids : [],
      peopleActive: person.peopleActive,
      profileActive: profile.is_active !== false,
      designationCode: person.designationCode,
      designationName: person.designationName,
      ownerType: person.ownerType
    } satisfies PeopleOperationalOwnerCandidate];
  });
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
  const [stations, profiles, operationalOwners] = await Promise.all([
    supabaseAdmin
      .from("stations")
      .select("id,station_code,station_name,address,address_line1,address_line2,state,region,station_manager_email,is_active,hide_from_location_list")
      .eq("company_id", companyId)
      .eq("is_active", true)
      .eq("hide_from_location_list", false)
      .order("station_code"),
    supabaseAdmin
      .from("profiles")
      .select("id,full_name,email,employee_id,role,is_active")
      .eq("company_id", companyId)
      .eq("is_active", true),
    loadPeopleOperationalOwners(companyId)
  ]);
  if (stations.error) throw new Error(stations.error.message);
  if (profiles.error) throw new Error(profiles.error.message);
  const profileByEmail = new Map(
    (profiles.data ?? []).map((profile) => [normalized(profile.email), profile])
  );
  return (stations.data ?? []).map((station) => {
    const manager = profileByEmail.get(normalized(station.station_manager_email));
    const ownerResolution = resolvePeopleOperationalOwner(station.id, operationalOwners);
    const clusterManager = ownerResolution.owner?.ownerType === "cluster_manager"
      ? ownerResolution.owner
      : null;
    return {
      id: station.id,
      code: String(station.station_code ?? "").trim().toUpperCase(),
      name: station.station_name || station.station_code || "Station",
      state: station.state,
      region: station.region,
      // Compatibility field for older Recruit clients. Its value is now the
      // current People operational owner, never the legacy station text.
      cluster: ownerResolution.owner?.name ?? null,
      address: [station.address_line1, station.address_line2].filter(Boolean).join(", ") || station.address,
      managerEmail: station.station_manager_email,
      managerId: manager?.id ?? null,
      managerName: manager?.full_name ?? station.station_manager_email ?? null,
      clusterManager,
      clusterManagerStatus: clusterManager
        ? "mapped"
        : ownerResolution.status === "ambiguous"
          && normalized(ownerResolution.designationName) === "cluster manager"
          ? "ambiguous"
          : "unmapped",
      operationalOwner: ownerResolution.owner,
      operationalOwnerStatus: ownerResolution.status,
      operationalOwnerDesignation: ownerResolution.designationName,
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
