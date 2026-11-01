"use client";

export default function MetaCampaignCategoryPicker({ value, accountCountry, onChange }: {
  value: string; accountCountry?: string; onChange: (value: string) => void;
}) {
  return <label>Campaign category
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="EMPLOYMENT">Employment special category</option>
      <option value="STANDARD_INDIA" disabled={accountCountry !== "IN"}>Standard · India</option>
    </select>
    <small>{value === "STANDARD_INDIA"
      ? "For India-only campaigns where Meta does not require a special category. Supports local radii from 3 km, subject to Meta validation."
      : "Meta's Employment audience restrictions apply. Smaller local radii require an eligible Standard India campaign."}</small>
  </label>;
}
