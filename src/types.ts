export type WorkType = "work" | "annual" | "half" | "holiday";

export type Attendance = {
  id?: string;
  work_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  break_minutes: number;
  work_type: WorkType;
  memo: string;
  source?: "manual" | "erp";
  paid_work_hours?: number;
  imported_at?: string | null;
  external_source?: string | null;
  external_record_hash?: string | null;
  erp_work_item_name?: string | null;
  erp_status_name?: string | null;
  erp_day_type_name?: string | null;
  erp_is_holiday?: number | null;
};

export type ErpAttendanceWorkType = "work" | "annual" | "half" | "holiday";

export type ErpAttendanceImportRecord = {
  workDate: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  workType: ErpAttendanceWorkType;
  paidWorkHours: number;
  workItemName: string | null;
  statusName: string | null;
  dayTypeName: string | null;
  isHoliday: boolean;
};

export type ErpAttendanceImportPayload = {
  version: 1;
  source: "park-erp";
  exportedAt: string;
  records: ErpAttendanceImportRecord[];
};

export type ErpImportPreviewItem = {
  workDate: string;
  action: "create" | "update" | "unchanged" | "conflict";
  incoming: ErpAttendanceImportRecord;
  existing: Pick<Attendance, "work_date" | "check_in_time" | "check_out_time" | "work_type" | "source" | "paid_work_hours"> | null;
  resolution: "keep" | "replace";
};

export type ErpImportPreview = {
  summary: { create: number; update: number; unchanged: number; conflict: number };
  items: ErpImportPreviewItem[];
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
