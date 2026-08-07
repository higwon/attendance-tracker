import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, LoaderCircle, ShieldCheck } from "lucide-react";
import { api } from "./api";
import type { ErpAttendanceImportPayload, ErpImportPreview, User } from "./types";

const ERP_ORIGIN = "https://erp.parksystems.com";

type ImportResult = { created: number; updated: number; unchanged: number; conflicts: number };
type ImportMessage = { type: "ATTENDANCE_IMPORT_DATA"; payload: ErpAttendanceImportPayload };

function sendToOpener(message: object) {
  if (window.opener && !window.opener.closed) window.opener.postMessage(message, ERP_ORIGIN);
}

function labelForAction(action: ErpImportPreview["items"][number]["action"]) {
  return { create: "신규", update: "업데이트", unchanged: "변경 없음", conflict: "충돌" }[action];
}

export function ErpImportPage({ user }: { user: User }) {
  const [payload, setPayload] = useState<ErpAttendanceImportPayload | null>(null);
  const [preview, setPreview] = useState<ErpImportPreview | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, "keep" | "replace">>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    const receive = async (event: MessageEvent<unknown>) => {
      if (event.origin !== ERP_ORIGIN || event.source !== window.opener) return;
      const message = event.data as Partial<ImportMessage> | null;
      if (!message || message.type !== "ATTENDANCE_IMPORT_DATA" || !message.payload) return;
      setBusy(true);
      setError("");
      setResult(null);
      try {
        const nextPreview = await api.previewErpImport(message.payload);
        setPayload(message.payload);
        setPreview(nextPreview);
        setResolutions(Object.fromEntries(
          nextPreview.items.filter((item) => item.action === "conflict").map((item) => [item.workDate, "keep"]),
        ));
        sendToOpener({ type: "ATTENDANCE_IMPORT_RECEIVED", recordCount: message.payload.records.length });
      } catch (cause) {
        const text = cause instanceof Error ? cause.message : "ERP 근태 데이터를 확인하지 못했습니다.";
        setError(text);
        sendToOpener({ type: "ATTENDANCE_IMPORT_ERROR", message: text });
      } finally {
        setBusy(false);
      }
    };
    window.addEventListener("message", receive);
    sendToOpener({ type: "ATTENDANCE_IMPORT_READY" });
    return () => window.removeEventListener("message", receive);
  }, []);

  const replacementCount = useMemo(
    () => Object.values(resolutions).filter((resolution) => resolution === "replace").length,
    [resolutions],
  );

  const commit = async () => {
    if (!payload) return;
    setBusy(true);
    setError("");
    try {
      const nextResult = await api.commitErpImport(payload, Object.entries(resolutions).map(([workDate, resolution]) => ({ workDate, resolution })));
      setResult(nextResult);
      sendToOpener({ type: "ATTENDANCE_IMPORT_COMPLETED", ...nextResult });
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : "ERP 근태 기록을 저장하지 못했습니다.";
      setError(text);
      sendToOpener({ type: "ATTENDANCE_IMPORT_ERROR", message: text });
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="erp-import-page">
      <section className="erp-import-card page-transition">
        <header className="erp-import-heading">
          <span className="erp-import-icon">{result ? <CheckCircle2 /> : <Download />}</span>
          <div><p>ERP 근태 가져오기</p><h1>{result ? "가져오기 완료" : "내 계정에 근태 기록 가져오기"}</h1><span><b>{user.display_name}</b> (@{user.username}) 계정에 저장합니다.</span></div>
        </header>

        {!preview && !result && <div className="erp-import-waiting">
          {busy ? <LoaderCircle className="erp-spinner" /> : <ShieldCheck />}
          <h2>{busy ? "ERP 근태 데이터를 확인하는 중입니다." : "ERP 근태 데이터를 기다리는 중입니다."}</h2>
          <p>ERP 화면에서 가져오기 버튼을 눌러주세요.</p>
        </div>}

        {error && <div className="erp-import-error" role="alert"><strong>가져오지 못했습니다.</strong><span>{error}</span></div>}

        {preview && !result && <>
          <div className="erp-import-count"><strong>ERP 근태 기록 {preview.items.length}건</strong><span>저장 전에 변경 내용을 확인해 주세요.</span></div>
          <div className="erp-import-summary">
            <span><small>신규</small><b>{preview.summary.create}건</b></span>
            <span><small>업데이트 예정</small><b>{preview.summary.update}건</b></span>
            <span><small>변경 없음</small><b>{preview.summary.unchanged}건</b></span>
            <span className={preview.summary.conflict ? "has-conflict" : ""}><small>충돌</small><b>{preview.summary.conflict}건</b></span>
          </div>
          <div className="erp-import-list">
            {preview.items.map((item) => <div className={`erp-import-row action-${item.action}`} key={item.workDate}>
              <div><strong>{item.workDate}</strong><span>{item.incoming.workItemName || item.incoming.workType} · {item.incoming.checkInTime ?? "--:--"}–{item.incoming.checkOutTime ?? "--:--"}{item.incoming.paidWorkHours > 0 ? ` · 유급 ${item.incoming.paidWorkHours}시간` : ""}</span></div>
              <i>{labelForAction(item.action)}</i>
              {item.action === "conflict" && <label>처리
                <select value={resolutions[item.workDate] ?? "keep"} onChange={(event) => setResolutions({ ...resolutions, [item.workDate]: event.target.value as "keep" | "replace" })}>
                  <option value="keep">기존 수동 기록 유지</option><option value="replace">ERP 기록으로 교체</option>
                </select>
              </label>}
            </div>)}
          </div>
          <p className="erp-import-note">수동 기록 충돌 {preview.summary.conflict}건 중 {replacementCount}건을 ERP 기록으로 교체합니다. ERP에 없는 날짜는 삭제하지 않습니다.</p>
          <div className="erp-import-actions"><button className="secondary" onClick={() => window.close()}>취소</button><button className={`primary ${busy ? "is-loading" : ""}`} disabled={busy} onClick={commit}>{busy ? "저장 중..." : "내 계정에 저장"}</button></div>
        </>}

        {result && <div className="erp-import-complete">
          <div className="erp-import-summary">
            <span><small>신규</small><b>{result.created}건</b></span><span><small>업데이트</small><b>{result.updated}건</b></span><span><small>변경 없음</small><b>{result.unchanged}건</b></span><span><small>충돌 유지</small><b>{result.conflicts}건</b></span>
          </div>
          <p>기존 출퇴근 기록 화면으로 돌아가면 최신 데이터가 자동으로 반영됩니다.</p>
          <button className="primary" onClick={() => window.close()}>창 닫기</button>
        </div>}
      </section>
    </main>
  );
}
