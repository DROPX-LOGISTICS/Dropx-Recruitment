"use client";

import {
  META_AUDIENCE_RADIUS_MAX_KM,
  META_AUDIENCE_RADIUS_MIN_KM,
  META_AUDIENCE_RADIUS_PRESETS,
  isValidMetaAudienceRadius,
} from "@/lib/meta-audience-radius";

type Props = {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export default function MetaAudienceRadiusPicker({ value, disabled = false, onChange }: Props) {
  const radius = Number(value);
  const valid = isValidMetaAudienceRadius(value);

  return <fieldset className="audience-radius-picker" disabled={disabled}>
    <legend>Audience radius</legend>
    <div className="audience-radius-presets">
      {META_AUDIENCE_RADIUS_PRESETS.map((option) => <button
        type="button"
        key={option.value}
        className={radius === option.value ? "selected" : ""}
        aria-pressed={radius === option.value}
        onClick={() => onChange(String(option.value))}
      >
        <strong>{option.value} km</strong>
      </button>)}
    </div>
    <label className="audience-radius-custom">
      Exact radius
      <span><input
        type="number"
        inputMode="numeric"
        min={META_AUDIENCE_RADIUS_MIN_KM}
        max={META_AUDIENCE_RADIUS_MAX_KM}
        step="1"
        value={value}
        aria-invalid={!valid}
        onChange={(event) => onChange(event.target.value)}
      /><b>km</b></span>
    </label>
    <p className={valid ? "" : "invalid"} role={valid ? undefined : "alert"}>
      {valid
        ? `Within ${radius} km of the selected pin. Meta checks the permitted radius before saving.`
        : `Enter a whole number from ${META_AUDIENCE_RADIUS_MIN_KM} to ${META_AUDIENCE_RADIUS_MAX_KM} km.`}
    </p>
    <div className="hiring-audience-settings"><dl aria-label="Hiring audience settings"><div><dt>Gender</dt><dd>All genders</dd></div><div><dt>Age group</dt><dd>18–65+</dd></div></dl><small>Fixed inclusive settings for hiring ads. Location and radius are editable.</small></div>
  </fieldset>;
}
