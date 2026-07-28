import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays, ChartNoAxesColumnIncreasing, Clock3, LogOut, Settings, UserRound,
} from "lucide-react";
import { api } from "./api";
import { dateRangeForMonth, formatDuration, localDate, overtimeMinutes, workedMinutes } from "./date-utils";
import type { Attendance, User, WorkType } from "./types";

type Tab = "today" | "records" | "stats" | "account";

function seoulTime() {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date());
}

function monthLabel(month: string) {
  const [year, value] = month.split("-");
  return `${year}년 ${Number(value)}월`;
}

function shiftMonth(month: string, amount: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

function blankRecord(date: string): Attendance {
  return {
    work_date: date, check_in_time: null, check_out_time: null,
    break_minutes: 60, work_type: "work", memo: "",
  };
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("today");
  const [month, setMonth] = useState(localDate().slice(0, 7));
  const [records, setRecords] = useState<Attendance[]>([]);
  const [error, setError] = useState("");

  const loadRecords = useCallback(async () => {
    const range = dateRangeForMonth(month);
    setRecords(await api.records(range.from, range.to));
  }, [month]);

  useEffect(() => {
    api.me().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (user) loadRecords().catch((e: Error) => setError(e.message));
  }, [user, loadRecords]);

  if (loading) return <div className="center-screen"><div className="spinner" /></div>;
  if (!user) return <Auth onSuccess={() => api.me().then(setUser)} />;

  const handleLogout = async () => {
    await api.logout();
    setUser(null);
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">✓</span><span>출퇴근 기록</span></div>
        <nav>
          <NavButton active={tab === "today"} icon={<Clock3 />} text="오늘" onClick={() => setTab("today")} />
          <NavButton active={tab === "records"} icon={<CalendarDays />} text="기록" onClick={() => setTab("records")} />
          <NavButton active={tab === "stats"} icon={<ChartNoAxesColumnIncreasing />} text="통계" onClick={() => setTab("stats")} />
        </nav>
        <button className="profile" onClick={() => setTab("account")}>
          <span className="avatar">{user.display_name.slice(0, 1)}</span>
          <span><strong>{user.display_name}</strong><small>@{user.username}</small></span>
          <Settings size={18} />
        </button>
      </aside>

      <main>
        {error && <div className="toast" onClick={() => setError("")}>{error}</div>}
        {tab === "today" && <Today records={records} reload={loadRecords} />}
        {tab === "records" && (
          <Records
            records={records} month={month} setMonth={setMonth}
            reload={loadRecords} setError={setError}
          />
        )}
        {tab === "stats" && <Stats records={records} month={month} setMonth={setMonth} />}
        {tab === "account" && (
          <Account user={user} refresh={() => api.me().then(setUser)} logout={handleLogout} />
        )}
      </main>

      <nav className="mobile-nav">
        <NavButton active={tab === "today"} icon={<Clock3 />} text="오늘" onClick={() => setTab("today")} />
        <NavButton active={tab === "records"} icon={<CalendarDays />} text="기록" onClick={() => setTab("records")} />
        <NavButton active={tab === "stats"} icon={<ChartNoAxesColumnIncreasing />} text="통계" onClick={() => setTab("stats")} />
        <NavButton active={tab === "account"} icon={<UserRound />} text="계정" onClick={() => setTab("account")} />
      </nav>
    </div>
  );
}

function NavButton(props: { active: boolean; icon: React.ReactNode; text: string; onClick: () => void }) {
  return <button className={props.active ? "nav-active" : ""} onClick={props.onClick}>{props.icon}<span>{props.text}</span></button>;
}

function Auth({ onSuccess }: { onSuccess: () => void }) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      if (register) await api.register(username, displayName, password);
      else await api.login(username, password);
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <section className="auth-card">
        <div className="auth-logo">✓</div>
        <h1>나의 출퇴근 기록</h1>
        <p>{register ? "계정을 만들고 근무 기록을 시작하세요." : "내 기록을 확인하려면 로그인하세요."}</p>
        <form onSubmit={submit}>
          {register && <label>이름<input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="표시 이름" required /></label>}
          <label>아이디<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="영문, 숫자, . _ -" required /></label>
          <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} placeholder="8자 이상" required /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary" disabled={busy}>{busy ? "처리 중..." : register ? "회원가입" : "로그인"}</button>
        </form>
        <button className="text-button" onClick={() => { setRegister(!register); setError(""); }}>
          {register ? "이미 계정이 있어요 · 로그인" : "처음인가요? · 회원가입"}
        </button>
      </section>
    </div>
  );
}

function Today({ records, reload }: { records: Attendance[]; reload: () => Promise<void> }) {
  const date = localDate();
  const record = records.find((item) => item.work_date === date);
  const [now, setNow] = useState(seoulTime());
  useEffect(() => {
    const timer = setInterval(() => setNow(seoulTime()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const save = async (next: Attendance) => { await api.saveRecord(next); await reload(); };
  const checkIn = () => save({ ...blankRecord(date), check_in_time: now });
  const checkOut = () => record && save({ ...record, check_out_time: now });
  const minutes = record ? workedMinutes(record, now) : 0;
  const overtime = record ? overtimeMinutes(record, now) : -480;
  const target = record?.check_in_time
    ? (() => {
      const [h, m] = record.check_in_time!.split(":").map(Number);
      return `${String(Math.floor((h * 60 + m + 540) / 60) % 24).padStart(2, "0")}:${String((m + 540) % 60).padStart(2, "0")}`;
    })()
    : "--:--";

  return (
    <div className="page">
      <header><div><p className="eyebrow">{date}</p><h1>오늘도 좋은 하루예요</h1></div><div className="live-time">{now}</div></header>
      <section className="hero-card">
        <div>
          <span className={`status ${record?.check_out_time ? "done" : record?.check_in_time ? "working" : ""}`}>
            {record?.check_out_time ? "퇴근 완료" : record?.check_in_time ? "근무 중" : "출근 전"}
          </span>
          <h2>{record ? formatDuration(minutes) : "출근을 기록해 주세요"}</h2>
          <p>{record?.check_in_time ? `${record.check_in_time} 출근${record.check_out_time ? ` · ${record.check_out_time} 퇴근` : ""}` : "버튼을 누르면 현재 시간이 기록됩니다."}</p>
        </div>
        {!record?.check_in_time
          ? <button className="clock-button" onClick={checkIn}>출근하기</button>
          : !record.check_out_time && <button className="clock-button out" onClick={checkOut}>퇴근하기</button>}
      </section>
      <section className="kpi-grid">
        <Kpi title="오늘 근무시간" value={record ? formatDuration(minutes) : "-"} />
        <Kpi title="오늘 초과근무" value={record ? formatDuration(overtime, true) : "-"} tone={overtime < 0 ? "negative" : "positive"} />
        <Kpi title="퇴근 가능시간" value={target} />
      </section>
      <WeeklyMini records={records} today={date} now={now} />
    </div>
  );
}

function Kpi({ title, value, tone = "" }: { title: string; value: string; tone?: string }) {
  return <article className="kpi"><span>{title}</span><strong className={tone}>{value}</strong></article>;
}

function WeeklyMini({ records, today, now }: { records: Attendance[]; today: string; now: string }) {
  const target = new Date(`${today}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() - ((target.getUTCDay() + 6) % 7));
  const days = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(target);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { key, record: records.find((item) => item.work_date === key), label: ["월", "화", "수", "목", "금"][index] };
  });
  return (
    <section className="card weekly">
      <div className="section-title"><h2>이번 주 근무</h2><span>8시간 기준</span></div>
      <div className="week-chart">
        {days.map(({ key, record, label }) => {
          const special = record && record.work_type !== "work";
          const amount = record ? workedMinutes(record, key === today ? now : undefined) : 0;
          const overtime = record ? overtimeMinutes(record, key === today ? now : undefined) : 0;
          return (
            <div className="day-column" key={key}>
              <div className="day-value">
                {special ? <em>{typeLabel(record.work_type)}</em> : amount ? <><b>{formatDuration(amount)}</b><small className={overtime < 0 ? "negative" : "positive"}>{formatDuration(overtime, true)}</small></> : null}
              </div>
              <div className="bar-area">{!special && amount > 0 && <i style={{ height: `${Math.min(100, amount / 480 * 100)}%` }} />}</div>
              <span>{label}<small>{Number(key.slice(8))}</small></span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Records(props: {
  records: Attendance[]; month: string; setMonth: (value: string) => void;
  reload: () => Promise<void>; setError: (value: string) => void;
}) {
  const [editing, setEditing] = useState<Attendance | null>(null);
  const [selected, setSelected] = useState(localDate());
  const [year, monthNumber] = props.month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const offset = first.getUTCDay();
  const cells = Array.from({ length: Math.ceil((offset + lastDay) / 7) * 7 }, (_, index) => {
    const day = index - offset + 1;
    return day > 0 && day <= lastDay ? `${props.month}-${String(day).padStart(2, "0")}` : null;
  });

  const select = (date: string) => {
    setSelected(date);
    setEditing(props.records.find((item) => item.work_date === date) ?? blankRecord(date));
  };
  return (
    <div className="page">
      <header><div><p className="eyebrow">근무 기록</p><h1>기록</h1></div><MonthNav month={props.month} setMonth={props.setMonth} /></header>
      <section className="card calendar">
        <div className="weekday-row">{["일", "월", "화", "수", "목", "금", "토"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">
          {cells.map((date, index) => {
            if (!date) return <div className="calendar-cell empty" key={`empty-${index}`} />;
            const record = props.records.find((item) => item.work_date === date);
            const overtime = record ? overtimeMinutes(record) : 0;
            return (
              <button key={date} className={`calendar-cell ${date === localDate() ? "today" : ""} ${date === selected ? "selected" : ""}`} onClick={() => select(date)}>
                <b>{Number(date.slice(8))}</b>
                {record && (
                  record.work_type === "work"
                    ? <span className="calendar-work">{workedMinutes(record) ? formatDuration(workedMinutes(record)) : "근무 중"}<small className={overtime < 0 ? "negative" : "positive"}>{record.check_out_time ? formatDuration(overtime, true) : "근무 중"}</small></span>
                    : <em>{typeLabel(record.work_type)}</em>
                )}
              </button>
            );
          })}
        </div>
      </section>
      <section className="card record-list">
        <div className="section-title"><h2>{monthLabel(props.month)} 기록</h2><button className="secondary" onClick={() => select(selected)}>기록 추가</button></div>
        {props.records.filter((r) => r.work_date.startsWith(props.month)).length === 0 && <div className="empty-state">아직 기록이 없어요.</div>}
        {props.records.filter((r) => r.work_date.startsWith(props.month)).map((record) => (
          <button key={record.work_date} className="record-row" onClick={() => setEditing(record)}>
            <span><b>{record.work_date.slice(5).replace("-", ".")}</b><small>{typeLabel(record.work_type)}</small></span>
            <span>{record.check_in_time ?? "-"} — {record.check_out_time ?? "-"}</span>
            <strong>{formatDuration(workedMinutes(record))}<small className={overtimeMinutes(record) < 0 ? "negative" : "positive"}>{formatDuration(overtimeMinutes(record), true)}</small></strong>
          </button>
        ))}
      </section>
      {editing && <RecordDialog record={editing} close={() => setEditing(null)} saved={props.reload} setError={props.setError} />}
    </div>
  );
}

function RecordDialog({ record, close, saved, setError }: {
  record: Attendance; close: () => void; saved: () => Promise<void>; setError: (value: string) => void;
}) {
  const [value, setValue] = useState(record);
  const update = <K extends keyof Attendance>(key: K, next: Attendance[K]) => setValue({ ...value, [key]: next });
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    try { await api.saveRecord(value); await saved(); close(); } catch (e) { setError((e as Error).message); }
  };
  const remove = async () => {
    if (!confirm("이 기록을 삭제할까요?")) return;
    await api.deleteRecord(value.work_date); await saved(); close();
  };
  return (
    <div className="dialog-backdrop" onMouseDown={close}>
      <form className="dialog" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()}>
        <div className="section-title"><h2>{value.work_date} 기록</h2><button type="button" className="icon-button" onClick={close}>×</button></div>
        <label>근무 유형<select value={value.work_type} onChange={(e) => update("work_type", e.target.value as WorkType)}><option value="work">출근</option><option value="annual">연차</option><option value="half">반차</option><option value="holiday">공휴일</option></select></label>
        {(value.work_type === "work" || value.work_type === "half") && <div className="form-grid"><label>출근시간<input type="time" value={value.check_in_time ?? ""} onChange={(e) => update("check_in_time", e.target.value || null)} /></label><label>퇴근시간<input type="time" value={value.check_out_time ?? ""} onChange={(e) => update("check_out_time", e.target.value || null)} /></label></div>}
        <label>휴게시간(분)<input type="number" min="0" max="240" value={value.break_minutes} onChange={(e) => update("break_minutes", Number(e.target.value))} /></label>
        <label>메모<textarea value={value.memo} onChange={(e) => update("memo", e.target.value)} placeholder="선택 입력" /></label>
        <div className="dialog-actions"><button type="button" className="danger" onClick={remove}>삭제</button><button className="primary">저장</button></div>
      </form>
    </div>
  );
}

function Stats({ records, month, setMonth }: { records: Attendance[]; month: string; setMonth: (value: string) => void }) {
  const weeks = useMemo(() => {
    const grouped = new Map<string, Attendance[]>();
    records.filter((r) => new Date(`${r.work_date}T00:00:00Z`).getUTCDay() >= 1 && new Date(`${r.work_date}T00:00:00Z`).getUTCDay() <= 5)
      .forEach((record) => {
        const date = new Date(`${record.work_date}T00:00:00Z`);
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        const key = date.toISOString().slice(0, 10);
        grouped.set(key, [...(grouped.get(key) ?? []), record]);
      });
    return [...grouped].map(([start, items]) => {
      const end = new Date(`${start}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
      const required = items.reduce((sum, item) => sum + (item.work_type === "annual" || item.work_type === "holiday" ? 0 : 480), 0);
      const worked = items.reduce((sum, item) => sum + (item.work_type === "annual" || item.work_type === "holiday" ? 0 : workedMinutes(item)), 0);
      return { start, end: end.toISOString().slice(5, 10).replace("-", "."), required, worked };
    }).sort((a, b) => a.start.localeCompare(b.start));
  }, [records]);
  const completed = records.filter((r) => r.check_out_time || r.work_type !== "work");
  const total = completed.reduce((sum, record) => sum + workedMinutes(record), 0);
  const overtime = completed.reduce((sum, record) => sum + overtimeMinutes(record), 0);
  return (
    <div className="page">
      <header><div><p className="eyebrow">월간 리포트</p><h1>통계</h1></div><MonthNav month={month} setMonth={setMonth} /></header>
      <section className="kpi-grid">
        <Kpi title="총 근무시간" value={formatDuration(total)} />
        <Kpi title="총 초과근무" value={formatDuration(overtime, true)} tone={overtime < 0 ? "negative" : "positive"} />
        <Kpi title="근무일" value={`${completed.length}일`} />
      </section>
      <section className="card">
        <div className="section-title"><h2>주별 근무시간</h2><span>실제 / 필요 근무시간</span></div>
        <div className="week-list">
          {weeks.map((week) => {
            const difference = week.worked - week.required;
            return (
              <div className="week-row" key={week.start}>
                <div className="week-row-head"><b>{week.start.slice(5).replace("-", ".")} — {week.end}</b><span>{formatDuration(week.worked)} / {formatDuration(week.required)} <em className={difference < 0 ? "negative" : "positive"}>{formatDuration(difference, true)}</em></span></div>
                {week.worked > 0 && <div className="progress"><i style={{ width: `${Math.min(100, week.required ? week.worked / week.required * 100 : 100)}%` }} /></div>}
              </div>
            );
          })}
          {!weeks.length && <div className="empty-state">표시할 주간 기록이 없어요.</div>}
        </div>
      </section>
    </div>
  );
}

function MonthNav({ month, setMonth }: { month: string; setMonth: (value: string) => void }) {
  return <div className="month-nav"><button onClick={() => setMonth(shiftMonth(month, -1))}>‹</button><b>{monthLabel(month)}</b><button onClick={() => setMonth(shiftMonth(month, 1))}>›</button></div>;
}

function Account({ user, refresh, logout }: { user: User; refresh: () => Promise<void>; logout: () => Promise<void> }) {
  const [name, setName] = useState(user.display_name);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const saveName = async () => { await api.updateMe(name); await refresh(); setMessage("이름을 변경했어요."); };
  const changePassword = async () => {
    try { await api.changePassword(currentPassword, newPassword); setCurrentPassword(""); setNewPassword(""); setMessage("비밀번호를 변경했어요."); }
    catch (e) { setMessage((e as Error).message); }
  };
  return (
    <div className="page">
      <header><div><p className="eyebrow">설정</p><h1>내 계정</h1></div></header>
      {message && <div className="notice">{message}</div>}
      <div className="account-grid">
        <section className="card account-card">
          <div className="large-avatar">{user.display_name.slice(0, 1)}</div>
          <h2>{user.display_name}</h2><p>@{user.username} · {user.role === "admin" ? "관리자" : "일반 사용자"}</p>
          <label>표시 이름<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="primary" onClick={saveName}>이름 저장</button>
        </section>
        <section className="card">
          <div className="section-title"><h2>비밀번호 변경</h2></div>
          <label>현재 비밀번호<input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
          <label>새 비밀번호<input type="password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
          <button className="secondary" onClick={changePassword}>비밀번호 변경</button>
          <button className="logout" onClick={logout}><LogOut size={18} /> 로그아웃</button>
        </section>
      </div>
      {user.role === "admin" && <UserManagement currentUserId={user.id} />}
    </div>
  );
}

function UserManagement({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<Array<User & { created_at: string; last_login_at: string | null }>>([]);
  const load = () => api.users().then(setUsers);
  useEffect(() => { load(); }, []);
  return (
    <section className="card user-management">
      <div className="section-title"><h2>사용자 관리</h2><span>{users.length}명</span></div>
      {users.map((user) => (
        <div className="user-row" key={user.id}>
          <span className="avatar">{user.display_name.slice(0, 1)}</span>
          <span><b>{user.display_name}</b><small>@{user.username}</small></span>
          <select value={user.role} disabled={user.id === currentUserId} onChange={async (e) => { await api.updateUser(user.id, { role: e.target.value as "user" | "admin" }); load(); }}><option value="user">일반</option><option value="admin">관리자</option></select>
          <button className={user.is_active ? "active-pill" : "inactive-pill"} disabled={user.id === currentUserId} onClick={async () => { await api.updateUser(user.id, { isActive: !user.is_active }); load(); }}>{user.is_active ? "활성" : "비활성"}</button>
        </div>
      ))}
    </section>
  );
}

function typeLabel(type: WorkType) {
  return ({ work: "출근", annual: "연차", half: "반차", holiday: "공휴일" } as const)[type];
}
