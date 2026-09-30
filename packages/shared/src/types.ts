export type Role = "parent" | "teacher" | "school_admin" | "super_admin";

export type PrincipalKind = "staff" | "parent";

export type AccessTokenClaims = {
  sub: string;
  typ: "access";
  role: Role;
  kind: PrincipalKind;
  schoolId: string | null;
};

export type AuthPrincipal = {
  id: string;
  role: Role;
  kind: PrincipalKind;
  schoolId: string | null;
  email?: string;
  phone?: string;
  mustChangePin?: boolean;
  sectionIds: string[];
  subjectIds: string[];
  studentIds: string[];
};
