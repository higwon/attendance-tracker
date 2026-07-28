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
};
