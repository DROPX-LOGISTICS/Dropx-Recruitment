"use client";

import { useState } from "react";
import {
  META_AUDIENCE_RADIUS_MAX_KM,
  META_AUDIENCE_RADIUS_MIN_KM,
  META_AUDIENCE_RADIUS_PRESETS,
  isValidMetaAudienceRadius,
  metaAudienceRadiusLabel
} from "@/lib/meta-audience-radius";

type Props = {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

export default function MetaAudienceRadiusPicker({ value, disabled = false, onChange }: Props) {
  const radius = Number(value);
  const presetSelected = META_AUDIENCE_RADIUS_PRESETS.some((option) => option.value === radius);
  const [customOpen, setCustomOpen] = useState(!presetSelected);
  const showCustom = customOpen || !presetSelected;
  const valid = isValidMetaAudienceRadius(value);

  return <fieldset className="audience-radius-picker" disabled={disabled}>
    <legend>Audience distance from station</legend>
    <div className="audience-radius-presets">
      {META_AUDIENCE_RADIUS_PRESETS.map((option) => <button
        type="button"
        key={option.value}
        className={!showCustom && radius === option.value ? "selected" : ""}
        aria-pressed={!showCustom && radius === option.value}
        onClick={() => { setCustomOpen(false); onChange(String(option.value)); }}
      >
        <strong>{option.value} km</strong>
        <span>{option.label}</span>
        <small>{option.detail}</small>
      </button>)}
      <button
        type="button"
        className={showCustom ? "selected" : ""}
        aria-pressed={showCustom}
        onClick={() => setCustomOpen(true)}
      >
        <strong>Custom</strong>
        <span>{META_AUDIENCE_RADIUS_MIN_KM}–{META_AUDIENCE_RADIUS_MAX_KM} km</span>
        <small>Set exact distance</small>
      </button>
    </div>
    {showCustom ? <label className="audience-radius-custom">
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
    </label> : null}
    <p className={valid ? "" : "invalid"} role={valid ? undefined : "alert"}>
      {valid
        ? `Targets people within 0–${radius} km of the verified station pin · ${metaAudienceRadiusLabel(radius)}.`
        : `Enter a whole number from ${META_AUDIENCE_RADIUS_MIN_KM} to ${META_AUDIENCE_RADIUS_MAX_KM} km.`}
    </p>
  </fieldset>;
}
