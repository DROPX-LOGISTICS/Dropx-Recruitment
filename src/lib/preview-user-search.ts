export type PreviewUser = {
  profileId: string;
  name: string;
  email?: string | null;
  employeeId?: string | null;
  designationName?: string | null;
  roleName?: string | null;
  designationCode?: string | null;
};

export function previewUserRole(user: PreviewUser) {
  return user.designationName || user.roleName || user.designationCode || "User";
}

export function searchPreviewUsers(users: PreviewUser[], viewerProfileId: string, query: string) {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return users.filter((user) => {
    if (user.profileId === viewerProfileId) return false;
    const text = [user.name, user.email, user.employeeId, user.designationName, user.roleName, user.designationCode]
      .filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
