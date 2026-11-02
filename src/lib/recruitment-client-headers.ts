export function recruitmentClientHeaders(token: string): Record<string, string> {
  const preview = typeof window === "undefined" ? "" : localStorage.getItem("dropx_recruitment_preview_profile");
  return { Authorization: `Bearer ${token}`, ...(preview ? { "X-DropX-Preview-Profile": preview } : {}) };
}
