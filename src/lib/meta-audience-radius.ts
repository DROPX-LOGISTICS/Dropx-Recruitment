export const META_AUDIENCE_RADIUS_MIN_KM = 15;
export const META_AUDIENCE_RADIUS_MAX_KM = 80;
export const META_AUDIENCE_RADIUS_DEFAULT_KM = 15;

export const META_AUDIENCE_RADIUS_PRESETS = [
  { value: 15, label: "Local", detail: "Nearby hiring" },
  { value: 25, label: "City", detail: "City + nearby towns" },
  { value: 40, label: "District", detail: "Wider district" },
  { value: 60, label: "Regional", detail: "About 2–3 districts" },
  { value: 80, label: "Multi-district", detail: "Widest single-pin reach" }
] as const;

export function isValidMetaAudienceRadius(value: unknown) {
  const radius = Number(value);
  return Number.isInteger(radius)
    && radius >= META_AUDIENCE_RADIUS_MIN_KM
    && radius <= META_AUDIENCE_RADIUS_MAX_KM;
}

export function metaAudienceRadiusLabel(value: unknown) {
  const radius = Number(value);
  if (radius <= 15) return "Local · nearby hiring";
  if (radius <= 25) return "City · city and nearby towns";
  if (radius <= 40) return "District · wider district";
  if (radius <= 60) return "Regional · about 2–3 districts";
  return "Multi-district · widest single-pin reach";
}

export function metaAudienceAdSetName(code: string, value: unknown) {
  const radius = Number(value) || META_AUDIENCE_RADIUS_DEFAULT_KM;
  const band = radius <= 15
    ? "Local"
    : radius <= 25
      ? "City"
      : radius <= 40
        ? "District"
        : radius <= 60
          ? "Regional"
          : "MultiDistrict";
  return `${code}_${band}_${radius}KM`;
}
