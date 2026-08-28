export type MetaInstantForm = {
  id: string;
  name: string;
  status: string;
  createdTime?: string | null;
};

export type RecruitmentDesignation = {
  code?: string | null;
  name?: string | null;
  aliases?: unknown;
};

function normalizedWords(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function aliases(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(aliases);
  return String(value ?? "")
    .split(/[,;|\n]+/)
    .map((item) => normalizedWords(item))
    .filter(Boolean);
}

function leadingCodeToken(value: unknown) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/^([A-Z][A-Z0-9]{1,7})(?:\s*[-_:]|\s+)/);
  return match ? normalizedWords(match[1]) : "";
}

export function scoreMetaFormForDesignation(
  form: MetaInstantForm,
  designation: RecruitmentDesignation
) {
  if (String(form.status).toUpperCase() !== "ACTIVE") return -1;
  const formName = normalizedWords(form.name);
  const tokens = new Set(formName.split(" ").filter(Boolean));
  const code = normalizedWords(designation.code);
  const roleName = normalizedWords(designation.name);
  const formCode = leadingCodeToken(form.name);
  let score = 0;

  // Most DropX forms start with their designation code (DCD, CLM, PTDA,
  // and so on). If a form declares a different code, it belongs to that
  // designation even when its descriptive text contains a generic term
  // such as "DA" or "Delivery Associate".
  if (code && formCode && formCode !== code) return 0;

  // Codes must match a complete token. This prevents DA from matching DCD,
  // PTDA or an unrelated word that merely contains the same letters.
  if (code && tokens.has(code)) {
    score += 300;
    if (formName === code || formCode === code) score += 75;
  }
  if (roleName && roleName.length >= 4 && formName.includes(roleName)) score += 180;
  for (const alias of aliases(designation.aliases)) {
    if (alias.length >= 3 && (formName.includes(alias) || tokens.has(alias))) score += 120;
  }
  return score;
}

export function matchingMetaFormsForDesignation(
  forms: MetaInstantForm[],
  designation: RecruitmentDesignation
) {
  return forms
    .map((form) => ({ form, score: scoreMetaFormForDesignation(form, designation) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const rightTime = Date.parse(String(right.form.createdTime || "")) || 0;
      const leftTime = Date.parse(String(left.form.createdTime || "")) || 0;
      return rightTime - leftTime || left.form.name.localeCompare(right.form.name);
    })
    .map((item) => item.form);
}

export function recommendedMetaFormForDesignation(
  forms: MetaInstantForm[],
  designation: RecruitmentDesignation
) {
  const matches = forms
    .map((form) => ({ form, score: scoreMetaFormForDesignation(form, designation) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!matches.length) return null;
  // Do not silently choose between equally strong forms. The UI will show
  // only designation-matched forms and let the publisher make the choice.
  if (matches.length > 1 && matches[0].score === matches[1].score) return null;
  return matches[0].form;
}

export function requireMetaFormForDesignation(
  formId: string,
  forms: MetaInstantForm[],
  designation: RecruitmentDesignation
) {
  const selected = forms.find((form) => form.id === formId && String(form.status).toUpperCase() === "ACTIVE");
  if (!selected) throw new Error("Choose an active Meta instant form.");
  const matches = matchingMetaFormsForDesignation(forms, designation);
  const label = [designation.code, designation.name].filter(Boolean).join(" — ") || "this designation";
  if (!matches.length) {
    throw new Error(`No active Meta instant form matches ${label}. Create or rename the form with the designation code before publishing.`);
  }
  if (!matches.some((form) => form.id === selected.id)) {
    throw new Error(`The selected Meta form does not match ${label}. Choose one of the designation-matched forms.`);
  }
  return selected;
}
