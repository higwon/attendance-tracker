import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireAuth } from "./auth";
import type { Bindings, Variables } from "./types";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_RECORDS = 366;

export const erpRecordSchema = z.object({
  workDate: z.string().regex(datePattern),
  checkInTime: z.string().regex(timePattern).nullable(),
  checkOutTime: z.string().regex(timePattern).nullable(),
  workType: z.enum(["work", "annual", "half", "holiday"]),
  paidWorkHours: z.number().finite().min(0).max(8),
  workItemName: z.string().max(200).nullable(),
  statusName: z.string().max(100).nullable(),
  dayTypeName: z.string().max(100).nullable(),
  isHoliday: z.boolean(),
}).superRefine((record, context) => {
  const parsed = new Date(`${record.workDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== record.workDate) {
    context.addIssue({ code: "custom", path: ["workDate"], message: "유효하지 않은 근무 날짜입니다." });
  }
  if (record.isHoliday !== (record.workType === "holiday")) {
    context.addIssue({ code: "custom", path: ["isHoliday"], message: "공휴일 여부와 근무 유형이 일치하지 않습니다." });
  }
  if ((record.workType === "annual" || record.workType === "half") && record.paidWorkHours <= 0) {
    context.addIssue({ code: "custom", path: ["paidWorkHours"], message: "연차와 반차에는 인정 유급시간이 필요합니다." });
  }
  if (record.workType === "half" && record.paidWorkHours > 4) {
    context.addIssue({ code: "custom", path: ["paidWorkHours"], message: "반차 인정시간은 4시간을 초과할 수 없습니다." });
  }
  if ((record.workType === "annual" || record.workType === "holiday") && (record.checkInTime || record.checkOutTime)) {
    context.addIssue({ code: "custom", path: ["checkInTime"], message: "연차와 공휴일에는 출퇴근 시간을 입력할 수 없습니다." });
  }
});

export const erpPayloadSchema = z.object({
  version: z.literal(1),
  source: z.literal("park-erp"),
  exportedAt: z.string().datetime(),
  records: z.array(erpRecordSchema).min(1).max(MAX_RECORDS),
}).superRefine((payload, context) => {
  const dates = new Set<string>();
  payload.records.forEach((record, index) => {
    if (dates.has(record.workDate)) {
      context.addIssue({ code: "custom", path: ["records", index, "workDate"], message: "같은 날짜의 기록이 중복되었습니다." });
    }
    dates.add(record.workDate);
  });
});

export type ErpAttendanceImportRecord = z.infer<typeof erpRecordSchema>;
export type ErpAttendanceImportPayload = z.infer<typeof erpPayloadSchema>;
export type ImportAction = "create" | "update" | "unchanged" | "conflict";

type ExistingAttendance = {
  id: string;
  work_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  work_type: ErpAttendanceImportRecord["workType"];
  source: "manual" | "erp";
  paid_work_hours: number;
  external_record_hash: string | null;
};

export type ImportPreviewItem = {
  workDate: string;
  action: ImportAction;
  incoming: ErpAttendanceImportRecord;
  existing: ExistingAttendance | null;
  resolution: "keep" | "replace";
};

function canonicalRecord(record: ErpAttendanceImportRecord) {
  return JSON.stringify({
    workDate: record.workDate,
    checkInTime: record.checkInTime,
    checkOutTime: record.checkOutTime,
    workType: record.workType,
    paidWorkHours: record.paidWorkHours,
    workItemName: record.workItemName,
    statusName: record.statusName,
    dayTypeName: record.dayTypeName,
    isHoliday: record.isHoliday,
  });
}

async function recordHash(record: ErpAttendanceImportRecord) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalRecord(record)));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function sameCore(existing: ExistingAttendance, incoming: ErpAttendanceImportRecord) {
  return existing.check_in_time === incoming.checkInTime
    && existing.check_out_time === incoming.checkOutTime
    && existing.work_type === incoming.workType
    && Number(existing.paid_work_hours) === incoming.paidWorkHours;
}

async function previewRecords(db: D1Database, userId: string, payload: ErpAttendanceImportPayload) {
  const dates = payload.records.map((record) => record.workDate);
  const placeholders = dates.map(() => "?").join(",");
  const existingResult = await db.prepare(
    `SELECT id, work_date, check_in_time, check_out_time, work_type, source,
            paid_work_hours, external_record_hash
     FROM attendance WHERE user_id = ? AND work_date IN (${placeholders})`,
  ).bind(userId, ...dates).all<ExistingAttendance>();
  const byDate = new Map(existingResult.results.map((record) => [record.work_date, record]));

  return Promise.all(payload.records.map(async (incoming): Promise<ImportPreviewItem> => {
    const existing = byDate.get(incoming.workDate) ?? null;
    let action: ImportAction = "create";
    if (existing) {
      const hash = await recordHash(incoming);
      if (existing.source === "erp") action = existing.external_record_hash === hash ? "unchanged" : "update";
      else action = sameCore(existing, incoming) ? "unchanged" : "conflict";
    }
    return { workDate: incoming.workDate, action, incoming, existing, resolution: "keep" };
  }));
}

function summarize(items: ImportPreviewItem[]) {
  return items.reduce((summary, item) => {
    summary[item.action] += 1;
    return summary;
  }, { create: 0, update: 0, unchanged: 0, conflict: 0 });
}

const requestSchema = z.object({ payload: erpPayloadSchema });
const commitSchema = requestSchema.extend({
  conflicts: z.array(z.object({
    workDate: z.string().regex(datePattern),
    resolution: z.enum(["keep", "replace"]),
  })).max(MAX_RECORDS).default([]),
});

const validationFailure = (result: any, c: any) => {
  if (result.success) return;
  return c.json({
    message: result.error?.issues[0]?.message ?? "ERP 근태 데이터 형식을 확인해 주세요.",
  }, 400);
};

export const erpImportApi = new Hono<{ Bindings: Bindings; Variables: Variables }>();

erpImportApi.post("/preview", requireAuth, zValidator("json", requestSchema, validationFailure), async (c) => {
  const { payload } = c.req.valid("json");
  const items = await previewRecords(c.env.DB, c.get("user").id, payload);
  return c.json({ summary: summarize(items), items });
});

erpImportApi.post("/commit", requireAuth, zValidator("json", commitSchema, validationFailure), async (c) => {
  const { payload, conflicts } = c.req.valid("json");
  const userId = c.get("user").id;
  const items = await previewRecords(c.env.DB, userId, payload);
  const resolutions = new Map(conflicts.map((item) => [item.workDate, item.resolution]));
  const result = { created: 0, updated: 0, unchanged: 0, conflicts: 0 };
  const statements: D1PreparedStatement[] = [];
  const now = new Date().toISOString();

  for (const item of items) {
    if (item.action === "unchanged") {
      result.unchanged += 1;
      continue;
    }
    if (item.action === "conflict" && resolutions.get(item.workDate) !== "replace") {
      result.conflicts += 1;
      continue;
    }
    const record = item.incoming;
    const hash = await recordHash(record);
    statements.push(c.env.DB.prepare(
      `INSERT INTO attendance
        (id, user_id, work_date, check_in_time, check_out_time, break_minutes, work_type, memo,
         created_at, updated_at, source, paid_work_hours, imported_at, external_source,
         external_record_hash, erp_work_item_name, erp_status_name, erp_day_type_name, erp_is_holiday)
       VALUES (?, ?, ?, ?, ?, 60, ?, '', ?, ?, 'erp', ?, ?, 'park-erp', ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, work_date) DO UPDATE SET
         check_in_time = excluded.check_in_time, check_out_time = excluded.check_out_time,
         break_minutes = 60, work_type = excluded.work_type, memo = '', updated_at = excluded.updated_at,
         source = 'erp', paid_work_hours = excluded.paid_work_hours, imported_at = excluded.imported_at,
         external_source = excluded.external_source, external_record_hash = excluded.external_record_hash,
         erp_work_item_name = excluded.erp_work_item_name, erp_status_name = excluded.erp_status_name,
         erp_day_type_name = excluded.erp_day_type_name, erp_is_holiday = excluded.erp_is_holiday`,
    ).bind(
      crypto.randomUUID(), userId, record.workDate, record.checkInTime, record.checkOutTime,
      record.workType, now, now, record.paidWorkHours, now, hash, record.workItemName,
      record.statusName, record.dayTypeName, record.isHoliday ? 1 : 0,
    ));
    if (item.action === "create") result.created += 1;
    else result.updated += 1;
  }

  if (statements.length) await c.env.DB.batch(statements);
  return c.json(result);
});
