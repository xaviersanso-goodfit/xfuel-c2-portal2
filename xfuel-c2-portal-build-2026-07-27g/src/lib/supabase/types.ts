export type Role = "editor" | "viewer";

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
}

export interface ScenarioRow {
  id: string;
  name: string;
  description: string | null;
  inputs: unknown;
  is_base: boolean;
  created_at: string;
  updated_at: string;
}
