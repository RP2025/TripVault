export type Role = "read" | "write";

export type Profile = {
  id: string;
  email: string | null;
  used_bytes: number;
};

export type Album = {
  id: string;
  owner_id: string;
  title: string;
  created_at: string;
};

export type AlbumMember = {
  album_id: string;
  user_id: string;
  role: Role;
  created_at: string;
  profiles?: { email: string | null } | null;
};

export type MediaItem = {
  id: string;
  album_id: string;
  owner_id: string;
  sha256: string;
  file_name: string;
  size_bytes: number;
  last_modified_ms: number | null;
  captured_at: string | null;
  width: number | null;
  height: number | null;
  preview_path: string;
  created_at: string;
};
