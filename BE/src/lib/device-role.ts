// Fungsi murni (tanpa dependency Next/Prisma) supaya mudah dites.
export type DeviceRole = "owner" | "editor" | "viewer";

export type DeviceMembership = {
  ownerId: string | null;
  collaborators: { userId: string; role: string }[];
};

export function roleOf(device: DeviceMembership, userId: string): DeviceRole | null {
  if (device.ownerId === userId) return "owner";
  const collab = device.collaborators.find((c) => c.userId === userId);
  if (!collab) return null;
  return collab.role === "editor" ? "editor" : "viewer";
}
