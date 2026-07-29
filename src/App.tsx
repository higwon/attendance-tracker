import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { isHoliday } from "korean-holidays";
import { getBlockedWorkDateReason } from "../shared/work-date-policy";
import { api } from "./api";
import type { Attendance, User, WorkType as ApiWorkType } from "./types";

export type WorkType = "출근" | "연차" | "반차" | "공휴일";
type Tab = "today" | "records" | "stats" | "account";

export type RecordItem = {
  Id: string;
  WorkDate: string;
  CheckInTime: string | null;
  CheckOutTime: string | null;
  BreakMinutes: number;
  WorkType: WorkType;
  Memo: string;
  IsSample: number;
};

type RecordForm = {
  id: string;
  workDate: string;
  checkInTime: string;
  checkOutTime: string;
  includeCheckOut: boolean;
  workType: WorkType;
  memo: string;
};

const toUiType = (value: ApiWorkType): WorkType =>
  value === "annual" ? "연차" : value === "half" ? "반차" : value === "holiday" ? "공휴일" : "출근";
const toApiType = (value: WorkType): ApiWorkType =>
  value === "연차" ? "annual" : value === "반차" ? "half" : value === "공휴일" ? "holiday" : "work";

const toRecordItem = (record: Attendance): RecordItem => ({
  Id: record.id ?? record.work_date,
  WorkDate: record.work_date,
  CheckInTime: record.check_in_time,
  CheckOutTime: record.check_out_time,
  BreakMinutes: record.break_minutes,
  WorkType: toUiType(record.work_type),
  Memo: record.memo,
  IsSample: 0,
});

function Auth({ onSuccess }: { onSuccess: () => void }) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (register) await api.register(username, displayName, password);
      else await api.login(username, password);
      onSuccess();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "로그인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-page">
      {error && <div role="alert" className="toast error"><strong>{register ? "회원가입 실패" : "로그인 실패"}</strong><span>{error}</span></div>}
      <section className="auth-card">
        <span className="auth-logo">✓</span>
        <h1>나의 출퇴근 기록</h1>
        <p>{register ? "계정을 만들고 근무 기록을 시작하세요." : "내 기록을 확인하려면 로그인하세요."}</p>
        <form onSubmit={submit}>
          {register && <label>이름<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>}
          <label>아이디<input value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
          <label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy}>{busy ? "처리 중…" : register ? "회원가입" : "로그인"}</button>
        </form>
        <button className="auth-switch" onClick={() => { setRegister(!register); setError(""); }}>
          {register ? "이미 계정이 있어요 · 로그인" : "처음인가요? · 회원가입"}
        </button>
      </section>
    </main>
  );
}
const WEEKDAYS = ["월", "화", "수", "목", "금"];
const DAY_MS = 86_400_000;

const pad = (value: number) => String(value).padStart(2, "0");

function seoulParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    seconds: get("second"),
  };
}

function timeToMinutes(value: string | null) {
  return value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : 0;
}

function minutesToTime(value: number) {
  const normalized = ((value % 1_440) + 1_440) % 1_440;
  return `${pad(Math.floor(normalized / 60))}:${pad(normalized % 60)}`;
}

export function workDuration(record?: RecordItem, now?: string) {
  if (record?.WorkType === "반차") return 240;
  if (record?.WorkType === "연차" || record?.WorkType === "공휴일") return 0;
  if (!record?.CheckInTime) return 0;
  const end = record.CheckOutTime ?? now;
  if (!end) return 0;
  const elapsed = Math.max(0, timeToMinutes(end) - timeToMinutes(record.CheckInTime));
  if (record.CheckOutTime) return Math.max(0, elapsed - record.BreakMinutes);

  const liveBreakMinutes = Math.min(record.BreakMinutes, Math.max(0, elapsed - 240));
  return Math.max(0, elapsed - liveBreakMinutes);
}

function formatDuration(value: number) {
  return `${Math.floor(value / 60)}시간 ${value % 60}분`;
}

function formatSignedDuration(value: number) {
  const absolute = Math.abs(value);
  return `${value < 0 ? "-" : ""}${Math.floor(absolute / 60)}시간 ${absolute % 60}분`;
}

function formatWorkDelta(value: number) {
  if (value === 0) return "0분";
  const absolute = Math.abs(value);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  const duration = hours > 0
    ? `${hours}시간${minutes > 0 ? ` ${minutes}분` : ""}`
    : `${minutes}분`;
  return `${value > 0 ? "+" : "-"}${duration}`;
}

function formatDurationPadded(value: number) {
  return `${pad(Math.floor(value / 60))}시간 ${pad(value % 60)}분`;
}

function formatDate(value: string) {
  return `${value.slice(0, 4)}년 ${value.slice(5, 7)}월 ${value.slice(8, 10)}일`;
}

function formatDateWithWeekday(value: string) {
  const weekday = new Intl.DateTimeFormat("ko-KR", {
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(new Date(`${value}T12:00:00+09:00`));
  return `${formatDate(value)} (${weekday})`;
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

function dateKey(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function toUtcDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function getWeekDates(todayDate: string) {
  const today = toUtcDate(todayDate);
  const mondayOffset = (today.getUTCDay() + 6) % 7;
  const monday = new Date(today.getTime() - mondayOffset * DAY_MS);
  return WEEKDAYS.map((_, index) => dateKey(new Date(monday.getTime() + index * DAY_MS)));
}

function getMonthBoundaryRange(month: string) {
  const [year, selectedMonth] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, selectedMonth - 1, 1));
  const last = new Date(Date.UTC(year, selectedMonth, 0));
  const from = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * DAY_MS);
  const to = new Date(last.getTime() + (7 - last.getUTCDay()) % 7 * DAY_MS);
  return { from: dateKey(from), to: dateKey(to) };
}

function holidayName(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return isHoliday(new Date(year, month - 1, day))?.nameKo ?? null;
}

function recordTimeSummary(record: RecordItem) {
  if (record.WorkType === "연차" || record.WorkType === "공휴일") return "시간 입력 없음";
  if (record.WorkType === "반차") return "4시간 자동 반영";
  return `${record.CheckInTime ?? "--:--"} — ${record.CheckOutTime ?? "--:--"}`;
}

function recordWorkSummary(record: RecordItem) {
  if (record.WorkType === "연차" || record.WorkType === "공휴일") return "-";
  if (record.WorkType === "반차") return "4시간 0분";
  return record.CheckInTime && record.CheckOutTime ? formatDuration(workDuration(record)) : "-";
}

function emptyForm(date: string): RecordForm {
  return {
    id: "",
    workDate: date,
    checkInTime: "09:00",
    checkOutTime: "18:00",
    includeCheckOut: false,
    workType: "출근",
    memo: "",
  };
}

export function getWeeklySummary(records: RecordItem[], todayDate: string, now: string) {
  const dates = getWeekDates(todayDate);
  const recordsByDate = new Map(records.map((record) => [record.WorkDate, record]));
  const includedRecords = dates
    .filter((date) => date <= todayDate)
    .map((date) => recordsByDate.get(date))
    .filter((record): record is RecordItem => Boolean(
      record && (
        record.CheckOutTime
        || record.WorkType === "반차"
        || record.WorkType === "연차"
        || record.WorkType === "공휴일"
        || (record.WorkDate === todayDate && record.CheckInTime)
      ),
    ));

  const weeklyWorkMinutes = includedRecords.reduce(
    (sum, record) => sum + workDuration(
      record,
      record.WorkDate === todayDate && !record.CheckOutTime ? now : undefined,
    ),
    0,
  );
  const targetByDate = new Map<string, number>();
  dates.forEach((date) => {
    const record = recordsByDate.get(date);
    let target = 480;
    if (holidayName(date) || record?.WorkType === "연차" || record?.WorkType === "공휴일") target = 0;
    else if (record?.WorkType === "반차") target = 240;
    targetByDate.set(date, target);
  });

  const targetMinutes = dates.reduce((sum, date) => sum + (targetByDate.get(date) ?? 0), 0);
  const includedTargetMinutes = includedRecords.reduce(
    (sum, record) => {
      const target = targetByDate.get(record.WorkDate) ?? 0;
      const isActiveToday = record.WorkDate === todayDate
        && Boolean(record.CheckInTime)
        && !record.CheckOutTime
        && record.WorkType === "출근";
      return sum + (isActiveToday ? Math.min(workDuration(record, now), target) : target);
    },
    0,
  );
  const weeklyOvertimeMinutes = weeklyWorkMinutes - includedTargetMinutes;
  const lastWorkDate = [...dates].reverse().find((date) => (targetByDate.get(date) ?? 0) > 0) ?? dates[4];
  const today = recordsByDate.get(todayDate);
  const priorWorkMinutes = dates
    .filter((date) => date < todayDate)
    .map((date) => recordsByDate.get(date))
    .filter((record): record is RecordItem => Boolean(
      record && (record.CheckOutTime || record.WorkType === "반차" || record.WorkType === "연차" || record.WorkType === "공휴일"),
    ))
    .reduce((sum, record) => sum + workDuration(record), 0);
  const todayTarget = targetByDate.get(todayDate) ?? 480;
  const requiredTodayMinutes = todayDate === lastWorkDate
    ? Math.max(0, targetMinutes - priorWorkMinutes)
    : todayTarget;

  let availableCheckOutTime = "--:--";
  if (today?.CheckInTime) {
    if (requiredTodayMinutes === 0) {
      availableCheckOutTime = now;
    } else {
      availableCheckOutTime = minutesToTime(
        timeToMinutes(today.CheckInTime) + requiredTodayMinutes + today.BreakMinutes,
      );
    }
  }

  return {
    dates,
    lastWorkDate,
    weeklyWorkMinutes,
    weeklyOvertimeMinutes,
    targetMinutes,
    priorWorkMinutes,
    todayTarget,
    requiredTodayMinutes,
    availableCheckOutTime,
  };
}


export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("today");
  const [clock, setClock] = useState(seoulParts());
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [allRecords, setAllRecords] = useState<RecordItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [toastClosing, setToastClosing] = useState(false);
  const [profileSaveState, setProfileSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [highlightedRecordDate, setHighlightedRecordDate] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"calendar" | "list">("calendar");
  const [modal, setModal] = useState<"form" | "confirm" | "delete-account" | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | (() => Promise<void>)>(null);
  const [confirmText, setConfirmText] = useState("");
  const [form, setForm] = useState<RecordForm>(emptyForm(seoulParts().date));
  const [profileName, setProfileName] = useState("");
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);
  const [profileBio, setProfileBio] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [deletePassword, setDeletePassword] = useState("");

  const records = useMemo(
    () => allRecords.filter((record) => record.WorkDate.startsWith(`${month}-`)),
    [allRecords, month],
  );

  useEffect(() => {
    queueMicrotask(() => setMounted(true));
    api.me().then((value) => {
      setUser(value);
      setProfileName(value.display_name);
      setProfilePhoto(value.profile_photo);
      setProfileBio(value.bio);
    }).catch(() => setUser(null)).finally(() => setAuthLoading(false));
    const timer = setInterval(() => setClock(seoulParts()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!toast) return;
    setToastClosing(false);
    const closingTimer = setTimeout(() => setToastClosing(true), 2_980);
    const timer = setTimeout(() => setToast(null), 3_200);
    return () => { clearTimeout(closingTimer); clearTimeout(timer); };
  }, [toast]);

  useEffect(() => {
    if (!highlightedRecordDate) return;
    const timer = setTimeout(() => setHighlightedRecordDate(null), 1_200);
    return () => clearTimeout(timer);
  }, [highlightedRecordDate]);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const monthRange = getMonthBoundaryRange(month);
      const weekDates = getWeekDates(clock.date);
      const ranges = monthRange.from <= weekDates[0] && monthRange.to >= weekDates[4]
        ? [monthRange]
        : [monthRange, { from: weekDates[0], to: weekDates[4] }];
      const responses = await Promise.all(ranges.map((range) => api.records(range.from, range.to)));
      const unique = new Map<string, Attendance>();
      responses.flat().forEach((record) => unique.set(record.work_date, record));
      setAllRecords([...unique.values()].sort((a, b) => a.work_date.localeCompare(b.work_date)).map(toRecordItem));
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "기록을 불러오지 못했습니다.", error: true });
    } finally {
      setLoading(false);
    }
  }, [user, month, clock.date]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  const today = allRecords.find((record) => record.WorkDate === clock.date);
  const workMinutes = workDuration(today, clock.time);
  const weeklySummary = useMemo(
    () => getWeeklySummary(allRecords, clock.date, clock.time),
    [allRecords, clock.date, clock.time],
  );
  const stats = useMemo(
    () => getMonthlyStats(allRecords, month, clock.date),
    [allRecords, month, clock.date],
  );

  const saveRecord = async (record: RecordForm) => {
    setBusy(true);
    try {
      const originalWorkDate = record.id
        ? allRecords.find((item) => item.Id === record.id)?.WorkDate
        : undefined;
      await api.saveRecord({
        id: record.id || undefined,
        work_date: record.workDate,
        check_in_time: record.workType === "출근" ? record.checkInTime || null : null,
        check_out_time: record.workType === "출근" && record.includeCheckOut ? record.checkOutTime || null : null,
        break_minutes: 60,
        work_type: toApiType(record.workType),
        memo: record.memo,
      }, originalWorkDate);
      setHighlightedRecordDate(record.workDate);
      setToast({ text: "기록을 저장했습니다." });
      await load();
      setModal(null);
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "저장하지 못했습니다.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const ask = (text: string, action: () => Promise<void>) => {
    setConfirmText(text);
    setConfirmAction(() => action);
    setModal("confirm");
  };

  const deleteRecord = (record: RecordItem) => {
    setModal(null);
    ask(`${formatDateWithWeekday(record.WorkDate)} 기록을 삭제할까요?`, async () => {
      setBusy(true);
      try {
        await api.deleteRecord(record.WorkDate);
        setToast({ text: "기록을 삭제했습니다." });
        await load();
      } catch (cause) {
        setToast({ text: cause instanceof Error ? cause.message : "삭제하지 못했습니다.", error: true });
      } finally {
        setBusy(false);
        setModal(null);
      }
    });
  };

  const quickAction = (action: "check-in" | "check-out") => {
    ask(action === "check-in" ? "현재 한국 시간으로 출근 처리할까요?" : "현재 한국 시간으로 퇴근 처리할까요?", async () => {
      const next = today
        ? {
          ...today,
          CheckInTime: action === "check-in" ? clock.time : today.CheckInTime,
          CheckOutTime: action === "check-out" ? clock.time : today.CheckOutTime,
        }
        : {
          Id: "",
          WorkDate: clock.date,
          CheckInTime: clock.time,
          CheckOutTime: null,
          BreakMinutes: 60,
          WorkType: "출근" as WorkType,
          Memo: "",
          IsSample: 0,
        };
      await saveRecord({
        id: next.Id,
        workDate: next.WorkDate,
        checkInTime: next.CheckInTime ?? "",
        checkOutTime: next.CheckOutTime ?? "",
        includeCheckOut: Boolean(next.CheckOutTime),
        workType: next.WorkType,
        memo: next.Memo,
      });
    });
  };

  const openForm = (record?: RecordItem, date = clock.date) => {
    const blockedReason = !record && getBlockedWorkDateReason(date);
    if (blockedReason) {
      setToast({ text: blockedReason, error: true });
      return;
    }
    setForm(record ? {
      id: record.Id,
      workDate: record.WorkDate,
      checkInTime: record.CheckInTime ?? "",
      checkOutTime: record.CheckOutTime ?? "",
      includeCheckOut: Boolean(record.CheckOutTime),
      workType: record.WorkType,
      memo: record.Memo,
    } : emptyForm(date));
    setModal("form");
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    const blockedReason = getBlockedWorkDateReason(form.workDate);
    if (blockedReason) {
      setToast({ text: blockedReason, error: true });
      return;
    }
    await saveRecord(form);
  };

  const changeMonth = (delta: number) => {
    const [year, selectedMonth] = month.split("-").map(Number);
    setMonth(monthKey(new Date(year, selectedMonth - 1 + delta, 1)));
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProfileSaveState("saving");
    try {
      await api.updateMe(profileName, profilePhoto, profileBio);
      const updated = await api.me();
      setUser(updated);
      setProfilePhoto(updated.profile_photo);
      setProfileBio(updated.bio);
      setProfileSaveState("saved");
      setTimeout(() => setProfileSaveState("idle"), 1_500);
      setToast({ text: "프로필을 저장했습니다." });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "계정 정보를 저장하지 못했습니다.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setToast({ text: "비밀번호를 변경했습니다." });
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "비밀번호를 변경하지 못했습니다.", error: true });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await api.logout();
    setUser(null);
    setTab("today");
  };

  const deleteAccount = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      await api.deleteMe(deletePassword);
      setDeletePassword("");
      setModal(null);
      setUser(null);
      setTab("today");
    } catch (cause) {
      setToast({ text: cause instanceof Error ? cause.message : "회원 탈퇴를 처리하지 못했습니다.", error: true });
    } finally {
      setBusy(false);
      setProfileSaveState((state) => state === "saving" ? "idle" : state);
    }
  };

  if (!mounted || authLoading) return <main className="app-shell loading-shell"><span>나의 출퇴근 기록을 불러오는 중…</span></main>;
  if (!user) return <Auth onSuccess={() => api.me().then((value) => { setUser(value); setProfileName(value.display_name); setProfilePhoto(value.profile_photo); setProfileBio(value.bio); })} />;

  const editingRecord = form.id ? allRecords.find((record) => record.Id === form.id) : undefined;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">✓</span>나의 출퇴근 기록</div>
        <nav aria-label="주 메뉴">
          {(["today", "records", "stats", "account"] as const).map((key) => (
            <button key={key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}>
              {{ today: "오늘", records: "기록", stats: "통계", account: "계정" }[key]}
            </button>
          ))}
        </nav>
        <div className="account-area">
          <span className="private-badge">● 계정별 비공개</span>
          <button className="account-trigger" onClick={() => setTab("account")} title={user.username}>
            <Avatar user={user} /><b>{user.display_name}</b>
          </button>
        </div>
      </header>

      <div className="content"><div key={tab} className="page-transition">
        {tab === "today" && <TodayView clock={clock} today={today} records={allRecords} workMinutes={workMinutes} summary={weeklySummary} busy={busy} onAction={quickAction} onEdit={() => openForm(today)} />}
        {tab === "records" && <RecordsView todayDate={clock.date} now={clock.time} month={month} records={records} loading={loading} mode={viewMode} highlightedDate={highlightedRecordDate} onMode={setViewMode} onPrev={() => changeMonth(-1)} onNext={() => changeMonth(1)} onAdd={() => openForm()} onAddDate={(date) => openForm(undefined, date)} onEdit={openForm} onDelete={deleteRecord} />}
        {tab === "stats" && <StatsView month={month} stats={stats} onPrev={() => changeMonth(-1)} onNext={() => changeMonth(1)} />}
        {tab === "account" && (
          <div className="account-page">
            <header className="account-page-heading">
              <p>계정</p><h1>계정 설정</h1><span>프로필 정보와 보안 설정을 관리할 수 있습니다.</span>
            </header>

            <section className="account-section">
              <div className="account-section-heading"><h2>프로필 정보</h2><p>다른 사용자에게 표시되는 정보를 관리합니다.</p></div>
              <form className="settings-card profile-card account-profile-card" onSubmit={saveProfile}>
                <div className="profile-header">
                  <span key={profilePhoto ?? "avatar"} className="profile-avatar-transition"><Avatar user={{ ...user, profile_photo: profilePhoto }} className="profile-avatar" /></span>
                  <div className="profile-summary"><div><h3>{user.display_name}</h3><span className="role-chip">{user.role === "admin" ? "관리자" : "일반 사용자"}</span></div><p>@{user.username}</p></div>
                  <div className="profile-photo-actions"><label className="secondary">사진 변경<input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    setProfilePhoto(await prepareProfilePhoto(file));
                  } catch (cause) {
                    setToast({ text: cause instanceof Error ? cause.message : "사진을 처리하지 못했습니다.", error: true });
                  } finally {
                    event.target.value = "";
                  }
                }} /></label>{profilePhoto && <button type="button" className="text-button" onClick={() => setProfilePhoto(null)}>삭제</button>}</div>
                </div>
                <div className="account-fields">
                  <label>표시 이름<input value={profileName} maxLength={30} onChange={(event) => setProfileName(event.target.value)} /></label>
                  <label>사용자 설명<textarea value={profileBio} maxLength={120} rows={3} placeholder="소속이나 담당 업무를 간단히 적어보세요." onChange={(event) => setProfileBio(event.target.value)} /></label>
                </div>
                <div className="account-form-actions"><button className={`primary ${profileSaveState === "saving" ? "is-loading" : ""} ${profileSaveState === "saved" ? "is-saved" : ""}`} disabled={busy}>{profileSaveState === "saving" ? "저장 중..." : profileSaveState === "saved" ? "✓ 저장됨" : "변경사항 저장"}</button></div>
              </form>
            </section>

            <section className="account-section">
              <div className="account-section-heading"><h2>계정 및 보안</h2><p>안전한 계정 사용을 위해 비밀번호를 변경합니다.</p></div>
                <form className="settings-card account-info-card password-card security-card" onSubmit={changePassword}>
                  <label>현재 비밀번호<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
                  <label>새 비밀번호<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label>
                  <div className="account-form-actions"><button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy}>{busy ? "변경 중..." : "비밀번호 변경"}</button></div>
                </form>
            </section>

            <section className="account-section">
              <div className="account-section-heading"><h2>함께 사용하는 사용자</h2><p>이 출퇴근 기록 서비스를 함께 사용하는 계정입니다.</p></div>
              <UserManagement currentUserId={user.id} isAdmin={user.role === "admin"} />
            </section>

            <section className="account-logout-row">
              <div><h2>로그아웃</h2><p>현재 브라우저에서 계정 연결을 종료합니다.</p></div>
              <button className="secondary" onClick={logout}>로그아웃</button>
            </section>

            <details className="danger-zone">
              <summary><span><b>위험 영역</b><small>계정 삭제와 관련된 설정</small></span><i>⌄</i></summary>
              <div className="danger-zone-reveal"><div className="danger-zone-content"><div><strong>회원 탈퇴</strong><p>계정과 저장된 모든 출퇴근 기록이 영구적으로 삭제됩니다.</p></div><button className="danger-outline-button" onClick={() => { setDeletePassword(""); setModal("delete-account"); }}>회원 탈퇴</button></div></div>
            </details>
          </div>
        )}
      </div></div>

      {toast && <div role="status" className={`toast ${toast.error ? "error" : ""} ${toastClosing ? "closing" : ""}`}>{toast.error ? "!" : "✓"} {toast.text}</div>}
      {modal === "confirm" && <Modal title="확인" onClose={() => setModal(null)}><p className="confirm-copy">{confirmText}</p><div className="modal-actions"><button className="secondary" onClick={() => setModal(null)}>취소</button><button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy} onClick={() => confirmAction?.()}>{busy ? "처리 중…" : "확인"}</button></div></Modal>}
      {modal === "delete-account" && <Modal title="회원 탈퇴" onClose={() => setModal(null)}><form className="delete-confirm-form" onSubmit={deleteAccount}><p>탈퇴하면 계정과 모든 출퇴근 기록을 복구할 수 없습니다. 계속하려면 비밀번호를 입력해 주세요.</p><label>비밀번호 확인<input autoFocus type="password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} required /></label><div className="modal-actions"><button type="button" className="secondary" onClick={() => setModal(null)}>취소</button><button className={`delete-account-button ${busy ? "is-loading" : ""}`} disabled={busy || !deletePassword}>{busy ? "처리 중…" : "계정 영구 삭제"}</button></div></form></Modal>}
      {modal === "form" && (
        <Modal title={form.id ? "기록 상세" : "기록 추가"} onClose={() => setModal(null)}>
          <form className="record-form" onSubmit={submitForm}>
            <label>근무 날짜<input type="date" required value={form.workDate} onChange={(event) => {
              const workDate = event.target.value;
              const blockedReason = getBlockedWorkDateReason(workDate);
              if (blockedReason) {
                setToast({ text: blockedReason, error: true });
                return;
              }
              setForm({ ...form, workDate });
            }} /></label>
            <label>근무 유형<select value={form.workType} onChange={(event) => { const workType = event.target.value as WorkType; setForm({ ...form, workType, checkInTime: workType === "출근" ? (form.checkInTime || "09:00") : "", checkOutTime: workType === "출근" ? (form.checkOutTime || "18:00") : "" }); }}>{(["출근", "반차", "연차"] as const).map((value) => <option key={value}>{value}</option>)}{form.workType === "공휴일" && <option value="공휴일" disabled>공휴일(자동)</option>}</select></label>
            {form.workType === "출근" && <div className="form-row"><TimeField label="출근 시간 (24시간)" value={form.checkInTime} onChange={(value) => setForm({ ...form, checkInTime: value })} /><TimeField label="퇴근 시간 (24시간)" value={form.checkOutTime} disabled={!form.includeCheckOut} toggle={{ checked: form.includeCheckOut, onChange: (checked) => setForm({ ...form, includeCheckOut: checked }) }} onChange={(value) => setForm({ ...form, checkOutTime: value })} /></div>}
            <div className={`modal-actions ${editingRecord ? "split" : ""}`}>{editingRecord && <button type="button" className="delete-record" onClick={() => deleteRecord(editingRecord)}>기록 삭제</button>}<span className="action-group"><button type="button" className="secondary" onClick={() => setModal(null)}>취소</button><button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy}>{busy ? "저장 중…" : "저장"}</button></span></div>
          </form>
        </Modal>
      )}
    </main>
  );
}
function TodayView({
  clock,
  today,
  records,
  workMinutes,
  summary,
  busy,
  onAction,
  onEdit,
}: {
  clock: { date: string; time: string; seconds: string };
  today?: RecordItem;
  records: RecordItem[];
  workMinutes: number;
  summary: ReturnType<typeof getWeeklySummary>;
  busy: boolean;
  onAction: (action: "check-in" | "check-out") => void;
  onEdit: () => void;
}) {
  const checkedIn = Boolean(today?.CheckInTime);
  const done = Boolean(today?.CheckOutTime);
  const isLeaveDay = today?.WorkType === "연차" || today?.WorkType === "반차" || today?.WorkType === "공휴일";
  const holiday = holidayName(clock.date);
  const weekday = toUtcDate(clock.date).getUTCDay();
  const isWeekend = weekday === 0 || weekday === 6;
  const dayOff = today?.WorkType === "연차"
    ? { title: "오늘은 연차예요", detail: "업무에서 잠시 벗어나 편안한 하루 보내세요.", kind: "annual" }
    : today?.WorkType === "공휴일"
      ? { title: "오늘은 공휴일이에요", detail: "오늘은 출퇴근 기록이 필요 없는 공휴일이에요.", kind: "holiday" }
    : holiday
      ? { title: `오늘은 ${holiday}이에요`, detail: "오늘은 출퇴근 기록이 필요 없는 공휴일이에요.", kind: "holiday" }
      : isWeekend
        ? { title: `오늘은 ${weekday === 6 ? "토요일" : "일요일"}이에요`, detail: "이번 주도 수고했어요. 편안한 주말 보내세요.", kind: "weekend" }
        : null;
  const canLeaveNow = checkedIn
    && !done
    && summary.availableCheckOutTime !== "--:--"
    && timeToMinutes(clock.time) >= timeToMinutes(summary.availableCheckOutTime);

  return (
    <>
      <section className="date-row">
        <span>▣ {formatDateWithWeekday(clock.date)}</span>
        <strong>◷ {clock.time}<small>:{clock.seconds}</small></strong>
      </section>

      {dayOff ? (
        <section className={`day-off-card ${dayOff.kind}`}>
          <div className="day-off-status">
            <span className="day-off-icon">☀</span>
            <div>
              <small>오늘 상태</small>
              <h1>{dayOff.title}</h1>
              <p>{dayOff.detail}</p>
            </div>
          </div>
          {(today?.WorkType === "연차" || today?.WorkType === "공휴일") && (
            <button className="day-off-edit" onClick={onEdit}>{today.WorkType} 기록 보기</button>
          )}
        </section>
      ) : (
      <section className={`hero-card ${!checkedIn ? "before" : ""}`}>
        <div className="status-block">
          <span className="live-dot" />
          <div>
            <p>
              {today?.WorkType === "연차"
                ? "오늘은 연차예요"
                : today?.WorkType === "반차"
                  ? "오늘은 반차예요"
                  : done
                    ? "오늘 근무를 마쳤어요"
                    : checkedIn
                      ? "오늘은 근무 중이에요"
                      : "아직 출근 전이에요"}
            </p>
            <h1>
              {today?.WorkType === "연차"
                ? "편안한 하루 보내세요"
                : today?.WorkType === "반차"
                  ? "4시간 근무로 자동 반영됩니다"
                  : done
                ? `${today?.CheckInTime} — ${today?.CheckOutTime}`
                : checkedIn
                  ? `${today?.CheckInTime} 출근`
                  : "오늘도 좋은 하루 보내세요"}
            </h1>
          </div>
        </div>
        <div className="hero-metric">
          <span>{done || isLeaveDay ? "반영 근무시간" : "현재 근무시간"}</span>
          <strong>{checkedIn || isLeaveDay ? formatDuration(workMinutes) : "0시간 0분"}</strong>
          <button className="ghost" onClick={onEdit}>{today ? "오늘 기록 수정" : "직접 기록 추가"}</button>
        </div>
        <button
          className="action-button"
          disabled={busy || done || isLeaveDay}
          onClick={() => onAction(checkedIn ? "check-out" : "check-in")}
        >
          {isLeaveDay ? "기록 완료" : done ? "퇴근 완료" : checkedIn ? "퇴근하기" : "출근하기"} <span>›</span>
        </button>
      </section>
      )}

      <section className="metric-grid today-metrics">
        <Metric icon="Σ" label="이번 주 근무시간" value={formatDuration(summary.weeklyWorkMinutes)} />
        <Metric
          icon={summary.weeklyOvertimeMinutes < 0 ? "−" : "＋"}
          label="이번 주 초과근무"
          value={formatSignedDuration(summary.weeklyOvertimeMinutes)}
          danger={summary.weeklyOvertimeMinutes < 0}
        />
        <Metric icon="◎" label="이번 주 필요 근무" value={formatDuration(summary.targetMinutes)} />
        <DepartureMetric
          value={summary.availableCheckOutTime}
          ready={canLeaveNow}
          today={today}
          todayDate={clock.date}
          summary={summary}
        />
      </section>

      <WeekChart records={records} todayDate={clock.date} now={clock.time} />
    </>
  );
}

function Metric({
  icon,
  label,
  value,
  green,
  danger,
}: {
  icon: string;
  label: string;
  value: string;
  green?: boolean;
  danger?: boolean;
}) {
  return (
    <article className={`metric-card ${danger ? "metric-danger" : ""}`}>
      <span className={`metric-icon ${green ? "green" : ""}`}>{icon}</span>
      <div><p>{label}</p><strong>{value}</strong></div>
    </article>
  );
}

function DepartureMetric({
  value,
  ready,
  today,
  todayDate,
  summary,
}: {
  value: string;
  ready: boolean;
  today?: RecordItem;
  todayDate: string;
  summary: ReturnType<typeof getWeeklySummary>;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLastWorkDate = todayDate === summary.lastWorkDate;
  const priorTargetMinutes = summary.targetMinutes - summary.todayTarget;
  const priorDifference = summary.priorWorkMinutes - priorTargetMinutes;
  const adjustmentCopy = priorDifference > 0
    ? `기존 초과근무로 오늘 필요 시간이 ${priorDifference}분 줄었어요.`
    : priorDifference < 0
      ? `기존 부족시간으로 오늘 ${Math.abs(priorDifference)}분 더 근무해야 해요.`
      : "오늘 기본 근무시간을 채우면 이번 주 기준을 충족해요.";
  const description = isLastWorkDate
    ? "이번 주 남은 필요 근무시간을 기준으로 계산했어요."
    : "오늘은 출근 시간부터 8시간 근무 기준이에요.";
  const detailRows = isLastWorkDate
    ? [
      ["이번 주 필요 근무시간", formatDuration(summary.targetMinutes)],
      ["이전까지 누적 근무시간", formatDuration(summary.priorWorkMinutes)],
      ["오늘 필요한 근무시간", formatDuration(summary.requiredTodayMinutes)],
      ["오늘 출근 시간", today?.CheckInTime ?? "--:--"],
      ["휴게시간", formatDuration(today?.BreakMinutes ?? 60)],
      ["최종 퇴근 가능 시간", value],
    ]
    : [
      ["출근 시간", today?.CheckInTime ?? "--:--"],
      ["필요 근무시간", "8시간"],
      ["휴게시간", formatDuration(today?.BreakMinutes ?? 60)],
      ["최종 퇴근 가능 시간", value],
    ];

  return (
    <article className={`metric-card departure-metric ${ready ? "ready" : ""} ${expanded ? "expanded" : ""}`}>
      <span className="metric-icon green">✓</span>
      <div className="departure-content">
        <div className="departure-heading"><p>퇴근 가능 시간 {ready && <em>지금 퇴근 가능</em>}</p><button type="button" className="departure-info" aria-label="퇴근 가능 시간 계산 설명" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>i</button></div>
        <strong>{value}</strong>
        <small>{description}</small>
        <div className="departure-details" aria-hidden={!expanded}>
          <div>
            {detailRows.map(([label, detail]) => <p key={label}><span>{label}</span><b>{detail}</b></p>)}
            {isLastWorkDate && <aside>{adjustmentCopy}</aside>}
          </div>
        </div>
      </div>
    </article>
  );
}

function WeekChart({ records, todayDate, now }: { records: RecordItem[]; todayDate: string; now: string }) {
  const dates = getWeekDates(todayDate);
  const chartData = dates.map((date) => {
    const record = records.find((item) => item.WorkDate === date);
    const holiday = holidayName(date);

    if (holiday) {
      return { work: 0, overtime: 0, leave: 0, label: "공휴일", detail: holiday, delta: null, status: null, dayOff: true };
    }
    if (record?.WorkType === "연차") {
      return { work: 0, overtime: 0, leave: 0, label: "연차", detail: "연차", delta: null, status: null, dayOff: true };
    }
    if (record?.WorkType === "공휴일") {
      return { work: 0, overtime: 0, leave: 0, label: "공휴일", detail: "공휴일", delta: null, status: null, dayOff: true };
    }
    if (record?.WorkType === "반차") {
      return { work: 240, overtime: 0, leave: 240, label: "04시간 00분", detail: "반차", delta: 0, status: null, dayOff: false };
    }

    const total = record ? workDuration(record, date === todayDate ? now : undefined) : 0;
    const isActive = date === todayDate && Boolean(record?.CheckInTime) && !record?.CheckOutTime;
    return {
      work: Math.min(total, 480),
      overtime: Math.max(0, total - 480),
      leave: 0,
      label: formatDurationPadded(total),
      detail: "",
      delta: record?.CheckInTime && (!isActive || total >= 480) ? total - 480 : null,
      status: isActive && total < 480 ? "근무 중" : null,
      dayOff: false,
    };
  });
  const max = Math.max(540, ...chartData.map((item) => item.work + item.overtime + item.leave));
  const referenceHeight = (480 / max) * 100;

  return (
    <section className="chart-card">
      <div className="chart-title">
        <h2>이번 주 근무시간</h2>
        <span>{formatDateWithWeekday(dates[0])} — {formatDateWithWeekday(dates[4])}</span>
      </div>
      <div className="bar-chart week-chart">
        <div className="workday-reference-layer" aria-hidden="true">
          <div className="workday-reference" style={{ bottom: `${referenceHeight}%` }} />
        </div>
        {WEEKDAYS.map((day, index) => {
          const item = chartData[index];
          const totalHeight = item.work + item.overtime + item.leave;
          const heightPercent = Math.max(2, (totalHeight / max) * 100);

          return (
            <div className={`bar-item ${dates[index] === todayDate ? "today-bar" : ""}`} key={day}>
              <div className="bar-label-zone">
                {item.dayOff ? (
                  <div className="day-off-chart-state" title={item.detail}>
                    <span>{item.label}</span>
                    {item.detail !== item.label && <small>{item.detail}</small>}
                  </div>
                ) : (
                  <div className="bar-labels" title={item.detail}>
                    <strong>{item.label}</strong>
                    {item.delta !== null && (
                      <em className={item.delta > 0 ? "positive" : item.delta < 0 ? "negative" : "neutral"}>
                        {formatWorkDelta(item.delta)}
                      </em>
                    )}
                    {item.status && <em className="working">{item.status}</em>}
                  </div>
                )}
              </div>
              <div className="bar-plot">
                {!item.dayOff && (
                  <div
                    className="stacked-bar"
                    style={{ height: `${heightPercent}%` }}
                    aria-label={`${dates[index]} ${item.label}`}
                  >
                    {item.overtime > 0 && <i className="bar-overtime" style={{ height: `${(item.overtime / totalHeight) * 100}%` }} />}
                    {item.leave > 0 && <i className="bar-leave" style={{ height: `${(item.leave / totalHeight) * 100}%` }} />}
                    {item.work > 0 && <i className="bar-regular" style={{ height: `${(item.work / totalHeight) * 100}%` }} />}
                  </div>
                )}
              </div>
              <b>{dates[index].slice(5).replace("-", ".")}. {day}</b>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function getMonthlyStats(allRecords: RecordItem[], month: string, todayDate: string) {
  const records = allRecords.filter((record) => record.WorkDate.startsWith(`${month}-`));
  const timedRecords = records.filter((record) => record.CheckInTime);
  const total = records.reduce((sum, record) => sum + workDuration(record), 0);
  const average = (key: "CheckInTime" | "CheckOutTime") => {
    const values = records.filter((record) => record[key]).map((record) => timeToMinutes(record[key]));
    if (!values.length) return "--:--";
    return minutesToTime(Math.round(values.reduce((sum, value) => sum + value, 0) / values.length));
  };
  const counts: Record<WorkType, number> = { 출근: 0, 반차: 0, 연차: 0, 공휴일: 0 };
  records.forEach((record) => counts[record.WorkType]++);

  const [year, selectedMonth] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, selectedMonth - 1, 1));
  const last = new Date(Date.UTC(year, selectedMonth, 0));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  let weekStart = new Date(first.getTime() - mondayOffset * DAY_MS);
  const weeks: Array<{
    start: string;
    end: string;
    total: number;
    target: number;
    overtime: number;
    hasRecords: boolean;
    state: "done" | "current" | "upcoming";
  }> = [];

  while (weekStart <= last) {
    const weekEnd = new Date(weekStart.getTime() + 6 * DAY_MS);
    const start = dateKey(weekStart);
    const end = dateKey(weekEnd);
    const weekRecords = allRecords.filter((record) => record.WorkDate >= start && record.WorkDate <= end);
    const recordsByDate = new Map(weekRecords.map((record) => [record.WorkDate, record]));
    const weekTotal = weekRecords
      .filter((record) => record.WorkDate >= start && record.WorkDate <= end)
      .reduce((sum, record) => sum + workDuration(record), 0);
    let weekTarget = 0;
    for (let index = 0; index < 5; index++) {
      const workDate = dateKey(new Date(weekStart.getTime() + index * DAY_MS));
      const record = recordsByDate.get(workDate);
      if (holidayName(workDate) || record?.WorkType === "연차" || record?.WorkType === "공휴일") continue;
      weekTarget += record?.WorkType === "반차" ? 240 : 480;
    }
    const state = end < todayDate ? "done" : start <= todayDate ? "current" : "upcoming";
    weeks.push({
      start,
      end,
      total: weekTotal,
      target: weekTarget,
      overtime: weekTotal - weekTarget,
      hasRecords: weekRecords.length > 0,
      state,
    });
    weekStart = new Date(weekStart.getTime() + 7 * DAY_MS);
  }

  const completedWeeksOvertime = weeks
    .filter((week) => week.state === "done" && week.hasRecords)
    .reduce((sum, week) => sum + week.overtime, 0);

  return {
    days: timedRecords.length + counts.반차 * 0.5,
    total,
    overtime: completedWeeksOvertime,
    avgIn: average("CheckInTime"),
    avgOut: average("CheckOutTime"),
    counts,
    weeks,
  };
}

function MonthNav({ month, onPrev, onNext }: { month: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="month-nav">
      <button onClick={onPrev}>‹</button>
      <strong>{month.slice(0, 4)}년 {month.slice(5)}월</strong>
      <button onClick={onNext}>›</button>
    </div>
  );
}

function RecordsView({
  todayDate,
  now,
  month,
  records,
  loading,
  mode,
  highlightedDate,
  onMode,
  onPrev,
  onNext,
  onAdd,
  onAddDate,
  onEdit,
  onDelete,
}: {
  todayDate: string;
  now: string;
  month: string;
  records: RecordItem[];
  loading: boolean;
  mode: "calendar" | "list";
  highlightedDate: string | null;
  onMode: (mode: "calendar" | "list") => void;
  onPrev: () => void;
  onNext: () => void;
  onAdd: () => void;
  onAddDate: (date: string) => void;
  onEdit: (record: RecordItem) => void;
  onDelete: (record: RecordItem) => void;
}) {
  return (
    <>
      <section className="page-heading">
        <div><p>근무 기록</p><h1>나의 일상을 한눈에</h1></div>
        <button className="primary" onClick={onAdd}>＋ 기록 추가</button>
      </section>
      <section className="toolbar">
        <MonthNav month={month} onPrev={onPrev} onNext={onNext} />
        <div className="toolbar-actions">
          <span className="segmented">
            <button className={mode === "calendar" ? "active" : ""} onClick={() => onMode("calendar")}>달력</button>
            <button className={mode === "list" ? "active" : ""} onClick={() => onMode("list")}>목록</button>
          </span>
        </div>
      </section>

      {loading ? (
        <div className="empty">기록을 불러오는 중입니다…</div>
      ) : mode === "calendar" ? (
        <Calendar
          todayDate={todayDate}
          month={month}
          now={now}
          records={records}
          onEdit={onEdit}
          onAddDate={onAddDate}
        />
      ) : !records.length ? (
        <div className="empty">
          <strong>아직 기록이 없어요</strong>
          <span>첫 출퇴근 기록을 추가해보세요.</span>
          <button className="primary" onClick={onAdd}>기록 추가</button>
        </div>
      ) : (
        <div className="record-list">
          {records.map((record) => (
            <RecordRow
              key={record.Id}
              record={record}
              highlighted={record.WorkDate === highlightedDate}
              onEdit={() => onEdit(record)}
              onDelete={() => onDelete(record)}
            />
          ))}
        </div>
      )}
    </>
  );
}

function RecordRow({ record, highlighted, onEdit, onDelete }: { record: RecordItem; highlighted: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <article className={`record-row ${highlighted ? "record-highlight" : ""}`}>
      <div className="record-date"><strong>{record.WorkDate.slice(8)}</strong><span>{formatDateWithWeekday(record.WorkDate)}</span></div>
      <span className={`type type-${record.WorkType}`}>{record.WorkType}</span>
      <div><small>시간</small><b>{recordTimeSummary(record)}</b></div>
      <div><small>반영 근무</small><b>{recordWorkSummary(record)}</b></div>
      <div><small>추가 시간</small><b className={record.WorkType === "반차" || (record.WorkType === "출근" && Boolean(record.CheckOutTime) && workDuration(record) >= 480) ? "record-positive" : ""}>{record.WorkType === "연차" || record.WorkType === "공휴일" ? "-" : record.WorkType === "반차" ? "0분" : !record.CheckOutTime ? "근무 중" : formatWorkDelta(workDuration(record) - 480)}</b></div>
      <div className="row-actions"><button onClick={onEdit}>수정</button><button className="danger" onClick={onDelete}>삭제</button></div>
    </article>
  );
}

function Calendar({
  todayDate,
  month,
  now,
  records,
  onEdit,
  onAddDate,
}: {
  todayDate: string;
  month: string;
  now: string;
  records: RecordItem[];
  onEdit: (record: RecordItem) => void;
  onAddDate: (date: string) => void;
}) {
  const [year, selectedMonth] = month.split("-").map(Number);
  const firstDay = new Date(year, selectedMonth - 1, 1).getDay();
  const dayCount = new Date(year, selectedMonth, 0).getDate();
  const cells = Array(firstDay).fill(null).concat(Array.from({ length: dayCount }, (_, index) => index + 1));

  return (
    <section className="calendar">
      <div className="weekdays">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <b key={day}>{day}</b>)}</div>
      <div className="calendar-grid">
        {cells.map((day, index) => {
          if (!day) return <div className="calendar-blank" key={`blank-${index}`} />;
          const key = `${month}-${pad(day)}`;
          const record = records.find((item) => item.WorkDate === key);
          const holiday = holidayName(key);
          const isToday = key === todayDate;
          const weekday = (firstDay + day - 1) % 7;
          const blocked = !record && (weekday === 0 || weekday === 6 || Boolean(holiday));
          const weekendClass = weekday === 0 ? "sunday-cell " : weekday === 6 ? "saturday-cell " : "";
          const accessibleName = record
            ? `${formatDateWithWeekday(key)} 기록 상세`
            : `${formatDateWithWeekday(key)} 기록 추가`;
          const workMinutes = record
            ? workDuration(record, key === todayDate && !record.CheckOutTime ? now : undefined)
            : 0;
          const isWorking = Boolean(record?.CheckInTime && !record.CheckOutTime && key === todayDate);
          const targetMinutes = record?.WorkType === "반차" ? 240 : 480;
          const delta = record?.WorkType === "출근" && record.CheckInTime && (!isWorking || workMinutes >= targetMinutes)
            ? workMinutes - targetMinutes
            : null;

          return (
            <button
              key={key}
              aria-label={accessibleName}
              disabled={blocked}
              className={`${record ? "has-record " : "empty-date "}${isToday ? "today-cell " : ""}${weekendClass}${holiday ? "holiday-cell" : ""}`}
              onClick={() => record ? onEdit(record) : onAddDate(key)}
            >
              <span className="day-number">{day}{isToday && <em>오늘</em>}</span>
              {holiday && <span className="holiday-name">{holiday}</span>}
              {record ? (
                <>
                  <i className={`type type-${record.WorkType}`}>{record.WorkType}</i>
                  <small>{recordTimeSummary(record)}</small>
                  {record.WorkType === "연차" || record.WorkType === "공휴일" ? (
                    <strong className="calendar-work-summary leave">{record.WorkType}</strong>
                  ) : (
                    <strong className="calendar-work-summary">
                      <span>{formatDuration(workMinutes)}</span>
                      {isWorking && workMinutes < targetMinutes
                        ? <em className="working">근무 중</em>
                        : delta !== null && <em className={delta < 0 ? "negative" : delta > 0 ? "positive" : "neutral"}>{formatWorkDelta(delta)}</em>}
                    </strong>
                  )}
                </>
              ) : (
                <span className="add-date-hint">＋ 기록 추가</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function StatsView({
  month,
  stats,
  onPrev,
  onNext,
}: {
  month: string;
  stats: ReturnType<typeof getMonthlyStats>;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <section className="page-heading">
        <div><p>월간 통계</p><h1>이번 달 근무 흐름</h1></div>
        <MonthNav month={month} onPrev={onPrev} onNext={onNext} />
      </section>
      <section className="stats-grid">
        <Metric icon="▤" label="총 근무일" value={`${stats.days}일`} />
        <Metric icon="◷" label="총 근무시간" value={formatDuration(stats.total)} />
        <Metric icon="→" label="평균 출근" value={stats.avgIn} />
        <Metric icon="←" label="평균 퇴근" value={stats.avgOut} />
        <Metric
          icon={stats.overtime < 0 ? "−" : "＋"}
          label="총 초과근무"
          value={formatSignedDuration(stats.overtime)}
          danger={stats.overtime < 0}
        />
      </section>
      <section className="stats-layout">
        <div className="chart-card weekly-stats-card">
          <h2>주별 근무시간</h2>
          <div className="weekly-rows">
            {stats.weeks.map((week) => {
              const workWidth = Math.min(100, (week.total / 2400) * 100);
              const status = week.state === "current"
                ? "진행 중"
                : week.state === "upcoming"
                  ? "예정"
                  : !week.hasRecords
                    ? "기록 없음"
                    : formatWorkDelta(week.overtime);
              return (
              <div className="weekly-row" key={week.start}>
                <div className="weekly-row-heading">
                  <span>{week.start.slice(5).replace("-", ".")} — {week.end.slice(5).replace("-", ".")}</span>
                  <strong>
                  <span>{formatDurationPadded(week.total)} / {formatDurationPadded(week.target)}</span>
                  <em className={week.state !== "done" || !week.hasRecords ? "pending" : week.overtime < 0 ? "negative" : week.overtime > 0 ? "positive" : "neutral"}>
                    {status}
                  </em>
                  </strong>
                </div>
                {week.total > 0 && (
                  <i className="weekly-track" aria-label={`${formatDurationPadded(week.total)} 근무`}>
                    <b className="weekly-regular" style={{ width: `${workWidth}%` }} />
                  </i>
                )}
              </div>
              );
            })}
          </div>
        </div>
        <div className="type-summary">
          <h2>근무 유형</h2>
          {Object.entries(stats.counts).map(([key, value]) => (
            <div key={key}><span className={`type type-${key}`}>{key}</span><strong>{value}일</strong></div>
          ))}
        </div>
      </section>
    </>
  );
}

function TimeField({
  label,
  value,
  disabled = false,
  toggle,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  toggle?: { checked: boolean; onChange: (checked: boolean) => void };
  onChange: (value: string) => void;
}) {
  const [hour = "00", minute = "00"] = value.split(":");
  const hours = Array.from({ length: 24 }, (_, index) => pad(index));
  const minutes = Array.from({ length: 60 }, (_, index) => pad(index));

  return (
    <label>
      <span className="time-field-label">{label}{toggle && <input type="checkbox" aria-label="퇴근시간 사용" checked={toggle.checked} onChange={(event) => toggle.onChange(event.target.checked)} />}</span>
      <span className="time-24-field">
        <select
          aria-label={`${label} 시`}
          disabled={disabled}
          value={hour}
          onChange={(event) => onChange(`${event.target.value}:${minute}`)}
        >
          {hours.map((option) => <option key={option} value={option}>{option}시</option>)}
        </select>
        <b>:</b>
        <select
          aria-label={`${label} 분`}
          disabled={disabled}
          value={minute}
          onChange={(event) => onChange(`${hour}:${event.target.value}`)}
        >
          {minutes.map((option) => <option key={option} value={option}>{option}분</option>)}
        </select>
      </span>
    </label>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" className="modal">
        <header><h2>{title}</h2><button aria-label="닫기" onClick={onClose}>×</button></header>
        {children}
      </section>
    </div>
  );
}

function formatLastActive(value: string | null) {
  if (!value) return "아직 없음";
  const date = new Date(value);
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (elapsedMinutes < 1) return "방금 전";
  if (elapsedMinutes < 60) return `${elapsedMinutes}분 전`;
  if (elapsedMinutes < 24 * 60) return `${Math.floor(elapsedMinutes / 60)}시간 전`;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function Avatar({
  user,
  className = "",
}: {
  user: Pick<User, "display_name" | "profile_photo">;
  className?: string;
}) {
  return user.profile_photo
    ? <span className={`avatar-image ${className}`}><img src={user.profile_photo} alt="" /></span>
    : <span className={className}>{user.display_name.slice(0, 1)}</span>;
}

async function prepareProfilePhoto(file: File) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error("JPG, PNG, WebP 이미지만 사용할 수 있습니다.");
  if (file.size > 5 * 1024 * 1024) throw new Error("원본 사진은 5MB 이하여야 합니다.");
  const bitmap = await createImageBitmap(file);
  const size = Math.min(256, Math.max(bitmap.width, bitmap.height));
  const scale = size / Math.max(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("사진을 처리하지 못했습니다.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const result = canvas.toDataURL("image/webp", 0.8);
  if (result.length > 250_000) throw new Error("압축된 사진 용량이 너무 큽니다. 다른 사진을 선택해 주세요.");
  return result;
}

type DirectoryUser = Pick<User, "id" | "username" | "display_name" | "profile_photo" | "bio"> & Partial<Pick<User, "role" | "is_active">> & {
  created_at?: string;
  last_login_at?: string | null;
  last_active_at?: string | null;
};

function UserManagement({ currentUserId, isAdmin }: { currentUserId: string; isAdmin: boolean }) {
  const [users, setUsers] = useState<DirectoryUser[]>([]);
  const load = useCallback(() => (isAdmin ? api.adminUsers() : api.directory()).then(setUsers), [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className={`settings-card account-user-list ${isAdmin ? "admin" : "directory"}`}>
      {users.map((managedUser) => (
        <article className="account-user-row" key={managedUser.id}>
          <div className="user-identity">
            <Avatar user={managedUser} />
            <div><strong>{managedUser.display_name}</strong><small>@{managedUser.username}</small>{managedUser.bio && <p>{managedUser.bio}</p>}</div>
          </div>
          {isAdmin && <div className="account-user-controls"><select
            aria-label={`${managedUser.display_name} 권한`}
            value={managedUser.role}
            disabled={managedUser.id === currentUserId}
            onChange={async (event) => {
              await api.updateUser(managedUser.id, { role: event.target.value as "user" | "admin" });
              await load();
            }}
          >
            <option value="user">일반 사용자</option>
            <option value="admin">관리자</option>
          </select>
          <span className="last-seen" title="마지막 활동">
            {formatLastActive(managedUser.last_active_at ?? null)}
          </span></div>}
        </article>
      ))}
    </div>
  );
}
