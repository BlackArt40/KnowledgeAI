// P7-5: RBAC primitives (role type + display labels), extracted from
// team/types so the auth module no longer depends on team (breaks the
// auth <-> team module cycle). team/types re-exports Role for compatibility.
export type Role = "owner" | "admin" | "editor" | "viewer";

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_DESC: Record<Role, string> = {
  owner: "全部权限，含团队设置与计费",
  admin: "管理知识库与成员",
  editor: "编辑知识库与问答",
  viewer: "只读问答",
};
