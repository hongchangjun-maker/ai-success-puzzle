import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, Settings, ShieldCheck, X } from "lucide-react";

type AdminStatus = {
  authenticated: boolean;
  users?: number;
  ai?: { enabled: boolean; model: string; keyHint?: string | null };
  book?: { rightsApproved: boolean; public: boolean; uploaded: boolean };
};

export function AdminModal({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<AdminStatus>({ authenticated: false });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [model, setModel] = useState("gpt-4.1-mini");
  const [apiKey, setApiKey] = useState("");
  const [rightsApproved, setRightsApproved] = useState(true);
  const [bookPublic, setBookPublic] = useState(true);
  const [message, setMessage] = useState("");

  async function refresh() {
    const response = await fetch("/api/admin/status");
    const data = (await response.json()) as AdminStatus;
    setStatus(data);
    if (data.ai?.model) setModel(data.ai.model);
    if (data.book) {
      setRightsApproved(data.book.rightsApproved);
      setBookPublic(data.book.public);
    }
    setLoading(false);
  }

  useEffect(() => {
    // The initial remote status is intentionally loaded once when the modal opens.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, []);

  async function login() {
    setError("");
    const response = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!response.ok) {
      setError("비밀번호가 맞지 않거나 잠시 잠겼습니다.");
      return;
    }
    setPassword("");
    await refresh();
  }

  async function save() {
    setMessage("");
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, apiKey: apiKey || undefined, rightsApproved, bookPublic }),
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "저장하지 못했습니다.");
      return;
    }
    setApiKey("");
    setMessage("운영 설정을 저장하고 감사 로그를 남겼습니다.");
    await refresh();
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="마스터 관리자">
      <div className="admin-modal">
        <div className="modal-header">
          <div><span className="eyebrow">MASTER CONSOLE</span><h2>마스터 관리자</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="닫기"><X /></button>
        </div>
        {loading ? (
          <div className="book-loading"><LoaderCircle className="spin" /> 운영 상태 확인 중</div>
        ) : !status.authenticated ? (
          <div className="admin-login">
            <div className="admin-shield"><ShieldCheck /></div>
            <h3>관리자 인증</h3>
            <p>초기 비밀번호는 서버 Secret으로만 확인됩니다.</p>
            <label>비밀번호<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void login()} /></label>
            {error && <p className="form-error">{error}</p>}
            <button className="primary-button" onClick={() => void login()}><KeyRound size={18} /> 로그인</button>
          </div>
        ) : (
          <div className="admin-content">
            <div className="admin-metrics">
              <div><span>누적 사용자</span><strong>{status.users ?? 0}</strong></div>
              <div><span>전자책 원본</span><strong>{status.book?.uploaded ? "R2 연결" : "미업로드"}</strong></div>
              <div><span>AI 상태</span><strong>{status.ai?.enabled ? "연결됨" : "연결 안 됨"}</strong></div>
            </div>
            <section className="settings-section">
              <h3><Settings size={18} /> AI 제공자 설정</h3>
              <label>모델<input value={model} onChange={(e) => setModel(e.target.value)} /></label>
              <label>OpenAI API 키<input type="password" placeholder={status.ai?.keyHint ? `저장됨 ···${status.ai.keyHint}` : "sk-..."} value={apiKey} onChange={(e) => setApiKey(e.target.value)} /></label>
              <p className="helper">키는 서버에서 AES-GCM으로 암호화되며 브라우저에 다시 표시되지 않습니다.</p>
            </section>
            <section className="settings-section">
              <h3><ShieldCheck size={18} /> 원문 권리와 공개</h3>
              <label className="switch-row"><input type="checkbox" checked={rightsApproved} onChange={(e) => setRightsApproved(e.target.checked)} /><span>상업적 전자책 서비스 권리 확인</span></label>
              <label className="switch-row"><input type="checkbox" checked={bookPublic} onChange={(e) => setBookPublic(e.target.checked)} /><span>공개 사용자에게 전자책 제공</span></label>
            </section>
            {message && <p className="save-message">{message}</p>}
            <button className="primary-button" onClick={() => void save()}>운영 설정 저장</button>
          </div>
        )}
      </div>
    </div>
  );
}
