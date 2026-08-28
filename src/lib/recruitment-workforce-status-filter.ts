export type WorkforceStatusFilterOption = {
  code: string;
  label: string;
  [key: string]: unknown;
};

const NO_STATUS_FILTER_OPTION: WorkforceStatusFilterOption = {
  code: "__BLANK__",
  label: "No Status"
};

export function workforceStatusFilterOptions(
  configured: WorkforceStatusFilterOption[]
): WorkforceStatusFilterOption[] {
  const seen = new Set<string>([NO_STATUS_FILTER_OPTION.code]);
  const outcomes = configured.filter((option) => {
    const code = String(option?.code ?? "").trim();
    if (!code || code.toUpperCase() === NO_STATUS_FILTER_OPTION.code || seen.has(code)) {
      return false;
    }
    seen.add(code);
    return true;
  });

  return [NO_STATUS_FILTER_OPTION, ...outcomes];
}
