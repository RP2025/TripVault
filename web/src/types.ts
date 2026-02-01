export type PhotoItem = {
  sha256: string;
  file_name?: string;
  relative_path?: string;
  parent_folder?: string;
  captured_at?: string;
  width?: number;
  height?: number;
  size_bytes?: number;
  camera_make?: string;
  camera_model?: string;
  gps_lat?: number | null;
  gps_lon?: number | null;
  is_duplicate?: boolean;
  duplicate_of?: string | null;
  preview_file: string; // <sha>.webp
};
