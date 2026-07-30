export type WorkType = "work" | "annual" | "half" | "holiday";

export type Attendance = {
  id?: string;
  work_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  break_minutes: number;
  work_type: WorkType;
  memo: string;
};

export type User = {
  id: string;
  username: string;
  display_name: string;
  role: "user" | "admin";
  is_active: number;
  last_active_at?: string | null;
  profile_photo: string | null;
  bio: string;
};

export type Post = {
  id: string;
  author_id: string;
  title: string;
  content: string;
  is_notice: number;
  is_private: number;
  can_view: boolean;
  created_at: string;
  updated_at: string;
  author_username: string;
  author_display_name: string;
  author_profile_photo: string | null;
  author_role: "user" | "admin";
};
