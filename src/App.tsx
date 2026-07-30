import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleGauge,
  ClipboardCheck,
  Flame,
  LayoutDashboard,
  LockKeyhole,
  Map,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Trash2,
} from "lucide-react";
import { dimensions, scaleLabels } from "./data/dimensions";

const AdminModal = lazy(() => import("./components/AdminModal").then((module) => ({ default: module.AdminModal })));
const BookViewer = lazy(() => import("./components/BookViewer").then((module) => ({ default: module.BookViewer })));

type View = "today" | "diagnosis" | "map" | "plan" | "book" | "coach";
type ActionItem = { id: string; text: string; done: boolean; createdAt: string };
type FailureLog = { id: string; event: string; learning: string; next: string; createdAt: string };
type AppState = {
  answers: Record<string, number>;
  baselineAt: string | null;
  goal: string;
  why: string;
  actions: ActionItem[];
  failureLogs: FailureLog[];
  bookPage: number;
};

const initialState: AppState = {
  answers: {},
  baselineAt: null,
  goal: "",
  why: "",
  actions: [],
  failureLogs: [],
  bookPage: 0,
};

const navItems: { id: View; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "today", label: "오늘", icon: LayoutDashboard },
  { id: "diagnosis", label: "나의 진단", icon: ClipboardCheck },
  { id: "map", label: "퍼즐맵", icon: Map },
  { id: "plan", label: "실행 플랜", icon: Target },
  { id: "book", label: "전자책", icon: BookOpen },
  { id: "coach", label: "AI 코치", icon: Bot },
];

function uid() {
  return crypto.randomUUID();
}

export default function App() {
  const [view, setView] = useState<View>("today");
  const [state, setState] = useState<AppState>(initialState);
  const [hydrated, setHydrated] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "error">("saved");
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/state");
        if (response.ok) {
          const data = (await response.json()) as { state?: Partial<AppState> };
          if (data.state) setState({ ...initialState, ...data.state });
        }
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      setSaveStatus("saving");
      void fetch("/api/state", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state }),
      }).then((response) => setSaveStatus(response.ok ? "saved" : "error")).catch(() => setSaveStatus("error"));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [state, hydrated]);

  const scores = useMemo(
    () =>
      dimensions.map((dimension) => {
        const values = dimension.questions.map((_, index) => state.answers[`${dimension.id}-${index}`]).filter(Boolean);
        const score = values.length ? Math.round(((values.reduce((sum, value) => sum + value, 0) / values.length - 1) / 4) * 100) : 0;
        return { ...dimension, score, answered: values.length };
      }),
    [state.answers],
  );
  const answeredCount = Object.keys(state.answers).length;
  const ranked = [...scores].sort((a, b) => b.score - a.score);
  const strongest = ranked[0];
  const growth = [...scores].filter((score) => score.answered > 0).sort((a, b) => a.score - b.score)[0];
  const average = answeredCount ? Math.round(scores.reduce((sum, score) => sum + score.score, 0) / dimensions.length) : 0;

  function patch(partial: Partial<AppState>) {
    setState((current) => ({ ...current, ...partial }));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("today")}>
          <span className="brand-mark"><Sparkles size={19} /></span>
          <span><strong>AI 성공의 퍼즐조각</strong><small>읽고 · 점검하고 · 행동하다</small></span>
        </button>
        <div className="topbar-actions">
          <span className={`save-status ${saveStatus}`}>
            {saveStatus === "saving" ? <CircleGauge size={15} /> : <Save size={15} />}
            {saveStatus === "saving" ? "저장 중" : saveStatus === "error" ? "저장 오류" : "자동 저장"}
          </span>
          <button className="admin-button" onClick={() => setShowAdmin(true)}><LockKeyhole size={16} /> 마스터 관리자</button>
        </div>
      </header>

      <section className="hero">
        <img src="/success-hero.png" alt="유럽 여성과 한국 남성이 비즈니스 대화를 나누는 모습" />
        <div className="hero-overlay" />
        <div className="hero-copy">
          <span className="hero-kicker">YOUR SUCCESS, PIECE BY PIECE</span>
          <h1>성공은 한 번의 도약이 아니라<br /><em>매일 맞추는 퍼즐</em>입니다.</h1>
          <p>책의 원리를 나의 강점과 행동으로 바꾸는 90일 여정을 시작하세요.</p>
          <button onClick={() => setView(answeredCount ? "today" : "diagnosis")}>{answeredCount ? "오늘의 조각 보기" : "무료 진단 시작"} <ChevronRight /></button>
        </div>
      </section>

      <nav className="main-nav" aria-label="주요 메뉴">
        {navItems.map((item) => {
          const Icon = item.icon;
          return <button key={item.id} className={view === item.id ? "active" : ""} onClick={() => setView(item.id)}><Icon size={19} /><span>{item.label}</span></button>;
        })}
      </nav>

      <main className="main-frame">
        {view === "today" && (
          <Today
            state={state}
            average={average}
            strongest={strongest}
            growth={growth}
            onNavigate={setView}
            onToggle={(id) => patch({ actions: state.actions.map((action) => action.id === id ? { ...action, done: !action.done } : action) })}
          />
        )}
        {view === "diagnosis" && (
          <Diagnosis
            answers={state.answers}
            baselineAt={state.baselineAt}
            onAnswer={(key, value) => patch({ answers: { ...state.answers, [key]: value } })}
            onComplete={() => {
              patch({ baselineAt: state.baselineAt ?? new Date().toISOString() });
              setView("map");
            }}
          />
        )}
        {view === "map" && <PuzzleMap scores={scores} average={average} onPlan={() => setView("plan")} />}
        {view === "plan" && <Plan state={state} patch={patch} />}
        {view === "book" && <Suspense fallback={<div className="book-loading">전자책 모듈을 준비하는 중입니다.</div>}><BookViewer savedPage={state.bookPage} onPageChange={(bookPage) => patch({ bookPage })} /></Suspense>}
        {view === "coach" && <Coach scores={scores} state={state} />}
      </main>

      <footer>
        <div><strong>AI 성공의 퍼즐조각</strong><span>© 2026 Hong Chang Jun. All rights reserved.</span></div>
        <p>이 서비스는 자기성찰 도구이며 성공을 보장하거나 의학·심리·재무 진단을 제공하지 않습니다.</p>
      </footer>
      {showAdmin && <Suspense fallback={null}><AdminModal onClose={() => setShowAdmin(false)} /></Suspense>}
    </div>
  );
}

function Today({
  state,
  average,
  strongest,
  growth,
  onNavigate,
  onToggle,
}: {
  state: AppState;
  average: number;
  strongest: (typeof dimensions)[number] & { score: number; answered: number };
  growth?: (typeof dimensions)[number] & { score: number; answered: number };
  onNavigate: (view: View) => void;
  onToggle: (id: string) => void;
}) {
  const completed = state.actions.filter((action) => action.done).length;
  if (!Object.keys(state.answers).length) {
    return (
      <section className="welcome-panel">
        <div className="welcome-icon"><Sparkles /></div>
        <span className="eyebrow">첫 번째 퍼즐조각</span>
        <h2>먼저 지금의 나를 정직하게 바라봅니다.</h2>
        <p>48개의 행동 질문으로 강점과 성장조각을 확인하세요. 결과는 능력 판정이 아니라 현재의 출발점입니다.</p>
        <button className="primary-button" onClick={() => onNavigate("diagnosis")}>진단 시작하기 <ChevronRight /></button>
      </section>
    );
  }
  return (
    <div className="dashboard">
      <section className="section-heading"><div><span className="eyebrow">TODAY'S PUZZLE</span><h2>오늘 맞출 성공의 조각</h2></div><p>작은 행동 하나가 큰 그림을 바꿉니다.</p></section>
      <div className="metric-grid">
        <article className="score-card">
          <div className="score-ring" style={{ "--score": `${average * 3.6}deg` } as React.CSSProperties}><span><strong>{average}</strong><small>/100</small></span></div>
          <div><span>전체 퍼즐 균형</span><h3>{average >= 70 ? "좋은 흐름입니다" : average >= 45 ? "성장 중입니다" : "출발점을 찾았습니다"}</h3><p>12개 영역의 현재 응답 평균</p></div>
        </article>
        <article className="mini-card strength"><span>가장 단단한 조각</span><strong>{strongest.name}</strong><p>{strongest.principle}</p></article>
        <article className="mini-card growth"><span>우선 성장조각</span><strong>{growth?.name ?? "진단 진행 중"}</strong><p>{growth?.action ?? "진단을 완료하면 추천 행동이 나타납니다."}</p></article>
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-title"><div><Flame /><span><strong>오늘의 행동</strong><small>{completed}/{state.actions.length} 완료</small></span></div><button className="text-button" onClick={() => onNavigate("plan")}>계획 관리</button></div>
          {state.actions.length ? (
            <div className="today-actions">
              {state.actions.slice(0, 4).map((action) => <label key={action.id} className={action.done ? "done" : ""}><input type="checkbox" checked={action.done} onChange={() => onToggle(action.id)} /><span>{action.text}</span><Check size={17} /></label>)}
            </div>
          ) : <div className="empty-mini"><p>아직 등록된 행동이 없습니다.</p><button onClick={() => onNavigate("plan")}>첫 행동 만들기</button></div>}
        </section>
        <section className="panel book-teaser">
          <span className="eyebrow">BOOK INSIGHT</span>
          <BookOpen />
          <h3>실패도 성공의 퍼즐조각입니다.</h3>
          <p>99번의 실패와 재도전이 없었다면 100번째 성공도 없었을 것입니다.</p>
          <button className="secondary-button" onClick={() => onNavigate("book")}>원문 펼쳐보기</button>
        </section>
      </div>
    </div>
  );
}

function Diagnosis({
  answers,
  baselineAt,
  onAnswer,
  onComplete,
}: {
  answers: Record<string, number>;
  baselineAt: string | null;
  onAnswer: (key: string, value: number) => void;
  onComplete: () => void;
}) {
  const [active, setActive] = useState(0);
  const total = dimensions.length * 4;
  const count = Object.keys(answers).length;
  const dimension = dimensions[active];
  return (
    <div className="diagnosis-layout">
      <aside className="diagnosis-sidebar">
        <span className="eyebrow">SELF CHECK</span>
        <h2>나의 성공 퍼즐 진단</h2>
        <div className="progress-orb"><strong>{Math.round((count / total) * 100)}%</strong><span>{count}/{total} 문항</span></div>
        <div className="dimension-list">
          {dimensions.map((item, index) => {
            const answered = item.questions.filter((_, question) => answers[`${item.id}-${question}`]).length;
            return <button key={item.id} className={active === index ? "active" : ""} onClick={() => setActive(index)}><span style={{ background: item.color }}>{index + 1}</span><strong>{item.short}</strong><small>{answered}/4</small></button>;
          })}
        </div>
      </aside>
      <section className="question-panel">
        <div className="question-heading"><span style={{ color: dimension.color }}>{String(active + 1).padStart(2, "0")}</span><div><h3>{dimension.name}</h3><p>{dimension.principle}</p></div></div>
        {dimension.questions.map((question, index) => {
          const key = `${dimension.id}-${index}`;
          return (
            <div className="question-card" key={key}>
              <p><b>{index + 1}</b>{question}</p>
              <div className="scale">
                {scaleLabels.map((label, scaleIndex) => <button key={label} className={answers[key] === scaleIndex + 1 ? "selected" : ""} onClick={() => onAnswer(key, scaleIndex + 1)}><span>{scaleIndex + 1}</span><small>{label}</small></button>)}
              </div>
            </div>
          );
        })}
        <div className="question-footer">
          <button className="secondary-button" disabled={active === 0} onClick={() => setActive((value) => value - 1)}>이전 조각</button>
          {active < dimensions.length - 1 ? <button className="primary-button" onClick={() => setActive((value) => value + 1)}>다음 조각 <ChevronRight /></button> : <button className="primary-button" disabled={count < total} onClick={onComplete}>{baselineAt ? "재진단 결과 보기" : "베이스라인 완성"} <Check /></button>}
        </div>
      </section>
    </div>
  );
}

function PuzzleMap({
  scores,
  average,
  onPlan,
}: {
  scores: ((typeof dimensions)[number] & { score: number; answered: number })[];
  average: number;
  onPlan: () => void;
}) {
  const [selected, setSelected] = useState(scores[0]);
  return (
    <div className="map-layout">
      <section className="map-main">
        <div className="section-heading"><div><span className="eyebrow">MY PUZZLE MAP</span><h2>12개의 조각이 만드는 현재의 나</h2></div><div className="average-badge"><strong>{average}</strong><span>전체 균형</span></div></div>
        <div className="puzzle-grid">
          {scores.map((score) => <button key={score.id} className={selected.id === score.id ? "selected" : ""} style={{ "--piece": score.color } as React.CSSProperties} onClick={() => setSelected(score)}><span>{score.short}</span><strong>{score.answered ? score.score : "–"}</strong><div><i style={{ width: `${score.score}%` }} /></div></button>)}
        </div>
      </section>
      <aside className="insight-panel">
        <span className="insight-number" style={{ color: selected.color }}>{selected.score}</span>
        <span className="eyebrow">SELECTED PIECE</span>
        <h3>{selected.name}</h3>
        <p>{selected.principle}</p>
        <div className="action-callout"><Sparkles /><div><small>추천하는 첫 행동</small><strong>{selected.action}</strong></div></div>
        <div className="chapter-links"><small>다시 읽을 장</small>{selected.chapters.map((chapter) => <span key={chapter}><BookOpen size={14} />{chapter}</span>)}</div>
        <button className="primary-button" onClick={onPlan}>이 행동을 계획에 넣기</button>
      </aside>
    </div>
  );
}

function Plan({ state, patch }: { state: AppState; patch: (value: Partial<AppState>) => void }) {
  const [newAction, setNewAction] = useState("");
  const [log, setLog] = useState({ event: "", learning: "", next: "" });
  function addAction() {
    if (!newAction.trim()) return;
    patch({ actions: [...state.actions, { id: uid(), text: newAction.trim(), done: false, createdAt: new Date().toISOString() }] });
    setNewAction("");
  }
  return (
    <div className="plan-layout">
      <section className="panel plan-goal">
        <span className="eyebrow">90 DAY NORTH STAR</span><h2>90일 북극성 목표</h2>
        <label>90일 뒤 확인할 수 있는 결과<textarea value={state.goal} onChange={(e) => patch({ goal: e.target.value })} placeholder="예: 90일 안에 유료 고객 10명의 문제를 해결하고 재구매율을 확인한다." /></label>
        <label>이 목표가 나에게 중요한 이유<textarea value={state.why} onChange={(e) => patch({ why: e.target.value })} placeholder="돈 이외에 삶에서 채우고 싶은 조각까지 적어보세요." /></label>
      </section>
      <section className="panel">
        <div className="panel-title"><div><Target /><span><strong>이번 주 핵심 행동</strong><small>15~60분 안에 시작할 수 있게 적으세요.</small></span></div></div>
        <div className="add-row"><input value={newAction} onChange={(e) => setNewAction(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addAction()} placeholder="새 행동을 입력하세요" /><button onClick={addAction}><Plus /></button></div>
        <div className="plan-actions">
          {state.actions.map((action) => <div key={action.id} className={action.done ? "done" : ""}><button className="check-button" onClick={() => patch({ actions: state.actions.map((item) => item.id === action.id ? { ...item, done: !item.done } : item) })}>{action.done && <Check />}</button><span>{action.text}</span><button className="delete-button" onClick={() => patch({ actions: state.actions.filter((item) => item.id !== action.id) })}><Trash2 /></button></div>)}
        </div>
      </section>
      <section className="panel failure-panel">
        <div className="panel-title"><div><RotateCcw /><span><strong>실패를 퍼즐조각으로</strong><small>비난 대신 다음 실험을 남깁니다.</small></span></div></div>
        <div className="failure-form">
          <input placeholder="무슨 일이 있었나요?" value={log.event} onChange={(e) => setLog({ ...log, event: e.target.value })} />
          <input placeholder="무엇을 배웠나요?" value={log.learning} onChange={(e) => setLog({ ...log, learning: e.target.value })} />
          <input placeholder="다음에는 무엇을 작게 실험할까요?" value={log.next} onChange={(e) => setLog({ ...log, next: e.target.value })} />
          <button className="secondary-button" onClick={() => {
            if (!log.event.trim()) return;
            patch({ failureLogs: [{ id: uid(), ...log, createdAt: new Date().toISOString() }, ...state.failureLogs] });
            setLog({ event: "", learning: "", next: "" });
          }}>복기 저장</button>
        </div>
        <div className="log-list">{state.failureLogs.slice(0, 3).map((item) => <article key={item.id}><strong>{item.event}</strong><p>배움: {item.learning || "아직 정리 중"}</p><small>다음 실험: {item.next || "정하기"}</small></article>)}</div>
      </section>
    </div>
  );
}

function Coach({
  scores,
  state,
}: {
  scores: ((typeof dimensions)[number] & { score: number; answered: number })[];
  state: AppState;
}) {
  const [status, setStatus] = useState<{ connected: boolean; model?: string }>({ connected: false });
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    void fetch("/api/ai/status").then((response) => response.json()).then((data: { connected: boolean; model?: string }) => setStatus(data));
  }, []);
  async function ask() {
    if (!message.trim() || !status.connected) return;
    setLoading(true);
    setAnswer("");
    const response = await fetch("/api/ai/coach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message,
        context: {
          goal: state.goal,
          why: state.why,
          scores: scores.map(({ id, name, score }) => ({ id, name, score })),
          actions: state.actions.slice(0, 10),
        },
      }),
    });
    const data = (await response.json()) as { answer?: string; error?: string };
    setAnswer(data.answer ?? data.error ?? "답변을 만들지 못했습니다.");
    setLoading(false);
  }
  return (
    <div className="coach-layout">
      <section className="coach-intro">
        <div className="coach-orb"><Bot /></div><span className="eyebrow">AI SUCCESS COACH</span><h2>판단하지 않고,<br />다음 행동을 함께 찾습니다.</h2>
        <p>AI는 점수를 바꾸지 않습니다. 나의 기록과 책의 원리를 바탕으로 편집 가능한 초안을 제안합니다.</p>
        <div className={`connection ${status.connected ? "connected" : ""}`}><i />{status.connected ? `${status.model} 연결됨` : "AI 연결 안 됨"}</div>
      </section>
      <section className="chat-panel">
        {!status.connected ? (
          <div className="empty-state"><LockKeyhole /><strong>AI 제공자가 아직 연결되지 않았습니다.</strong><p>기본 Cloudflare AI 또는 관리자가 설정한 OpenAI 연결을 확인해 주세요. 진단·플랜·전자책은 AI 없이도 모두 사용할 수 있습니다.</p></div>
        ) : (
          <>
            <div className="prompt-chips">{["내 성장조각의 첫 행동을 정해줘", "이번 주 계획을 30분 단위로 나눠줘", "최근 실패를 비난 없이 복기해줘"].map((prompt) => <button key={prompt} onClick={() => setMessage(prompt)}>{prompt}</button>)}</div>
            {answer && <div className="ai-answer"><span><Sparkles /> AI 초안</span><p>{answer}</p><small>이 제안을 검토하고 내 상황에 맞게 수정하세요.</small></div>}
            <div className="chat-input"><textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="지금 막힌 점이나 함께 정리할 목표를 적어주세요." /><button disabled={loading} onClick={() => void ask()}>{loading ? "생각 중…" : "코치에게 묻기"}</button></div>
          </>
        )}
      </section>
    </div>
  );
}
