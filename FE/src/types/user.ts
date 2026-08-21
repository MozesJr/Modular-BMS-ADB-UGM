// FE/src/types/user.ts
export type Role = "USER" | "ADMIN";

export type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  expiresAt: string | null;
  createdAt: string;
  _count: { devicesOwned: number };
};