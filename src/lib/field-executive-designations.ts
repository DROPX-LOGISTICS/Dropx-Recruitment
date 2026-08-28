type FieldExecutiveDesignation = {
  code?: unknown;
  name?: unknown;
  onboarding_categories?: unknown;
};

const normalized = (value: unknown) => String(value ?? "").trim().toLowerCase();

export function designationKeys(designation: FieldExecutiveDesignation) {
  return [normalized(designation.code), normalized(designation.name)].filter(Boolean);
}

export function hasFieldExecutiveCategory(value: unknown) {
  const categories = Array.isArray(value) ? value.map(normalized) : [];
  return categories.some((category) =>
    category === "field_executives" || category === "delivery_executives"
  );
}

/**
 * Dashboard designations are the source of truth. During the master-data
 * transition, an active Workforce recruitment role with the same code/name is
 * also authoritative so existing operational roles do not disappear from
 * Field Executive onboarding merely because their category tag is missing.
 */
export function isFieldExecutiveDesignation(
  designation: FieldExecutiveDesignation,
  workforceRoleKeys: Set<string>
) {
  return hasFieldExecutiveCategory(designation.onboarding_categories)
    || designationKeys(designation).some((key) => workforceRoleKeys.has(key));
}
