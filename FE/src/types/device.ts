// FE/src/types/device.ts — ganti total, tambah 1 field
export type Cell = {
  id: string;
  index: number;
  voltage: number;
  updatedAt: string;
};

export type Pack = {
  id: string;
  index: number;
  temperature: number | null;
  balancerConnected: boolean;
  cells: Cell[];
  updatedAt: string;
};

export type Collaborator = {
  id: string;
  role: "viewer" | "editor";
  user: {
    id: string;
    name: string | null;
    email: string;
  };
};

export type Device = {
  id: string;
  name: string | null;
  ownerId: string;
  verified: boolean;
  createdAt: string;
  packs: Pack[];
  collaborators: Collaborator[];
  owner: {
    id: string;
    name: string | null;
    email: string;
  };
};