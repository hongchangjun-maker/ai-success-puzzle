import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize2, Search } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type LogicalPage = { pdf: number; side: "full" | "left" | "right"; label: number };
type TurnDirection = "next" | "prev" | "";

function PageCanvas({
  document: pdfDocument,
  page,
  position,
}: {
  document: pdfjsLib.PDFDocumentProxy;
  page?: LogicalPage;
  position: "left" | "right";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!page || !canvasRef.current) return;
    let cancelled = false;
    void (async () => {
      const sourcePage = await pdfDocument.getPage(page.pdf);
      const viewport = sourcePage.getViewport({ scale: 1.5 });
      const full = window.document.createElement("canvas");
      full.width = Math.ceil(viewport.width);
      full.height = Math.ceil(viewport.height);
      const context = full.getContext("2d");
      if (!context) return;
      await sourcePage.render({ canvas: full, canvasContext: context, viewport }).promise;
      if (cancelled || !canvasRef.current) return;
      const target = canvasRef.current;
      const split = page.side !== "full";
      const sourceWidth = split ? full.width / 2 : full.width;
      target.width = Math.ceil(sourceWidth);
      target.height = full.height;
      const targetContext = target.getContext("2d");
      if (!targetContext) return;
      const sourceX = page.side === "right" ? full.width / 2 : 0;
      targetContext.drawImage(full, sourceX, 0, sourceWidth, full.height, 0, 0, target.width, target.height);
    })();
    return () => {
      cancelled = true;
    };
  }, [pdfDocument, page]);

  return (
    <div className={`book-page book-page--${position} ${page ? "" : "book-page--empty"}`}>
      {page ? <canvas ref={canvasRef} aria-label={`책 ${page.label}면`} /> : <div />}
    </div>
  );
}

export function BookViewer({
  savedPage,
  onPageChange,
}: {
  savedPage: number;
  onPageChange: (page: number) => void;
}) {
  const [document, setDocument] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [logicalPages, setLogicalPages] = useState<LogicalPage[]>([]);
  const [index, setIndex] = useState(Math.max(0, savedPage));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<TurnDirection>("");
  const [turnProgress, setTurnProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [fitMode, setFitMode] = useState<"page" | "width">("page");
  const [singlePage, setSinglePage] = useState(false);
  const pointer = useRef<{ x: number; moved: boolean } | null>(null);
  const turnProgressRef = useRef(0);
  const directionRef = useRef<TurnDirection>("");
  const suppressClick = useRef(false);
  const turnTimer = useRef<number | null>(null);
  const turnFrame = useRef<number | null>(null);
  const readerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 720px)");
    const update = () => setSinglePage(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => () => {
    if (turnTimer.current !== null) window.clearTimeout(turnTimer.current);
    if (turnFrame.current !== null) window.cancelAnimationFrame(turnFrame.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const task = pdfjsLib.getDocument({ url: "/api/book/pdf", withCredentials: true });
        const loaded = await task.promise;
        const pages: LogicalPage[] = [];
        for (let pdf = 1; pdf <= loaded.numPages; pdf += 1) {
          const sourcePage = await loaded.getPage(pdf);
          const viewport = sourcePage.getViewport({ scale: 1 });
          if (viewport.width / viewport.height > 1.1) {
            pages.push({ pdf, side: "left", label: pages.length + 1 });
            pages.push({ pdf, side: "right", label: pages.length + 1 });
          } else {
            pages.push({ pdf, side: "full", label: pages.length + 1 });
          }
        }
        if (!cancelled) {
          setDocument(loaded);
          setLogicalPages(pages);
        }
      } catch {
        if (!cancelled) setError("전자책을 불러오지 못했습니다. 관리자에게 원본 공개 상태를 확인해 주세요.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const spreadIndex = Math.max(0, Math.min(singlePage ? index : index - (index % 2), Math.max(0, logicalPages.length - 1)));
  const current = useMemo(
    () => [logicalPages[spreadIndex], singlePage ? undefined : logicalPages[spreadIndex + 1]],
    [logicalPages, singlePage, spreadIndex],
  );
  const pagesShown = current[1] ? 2 : 1;
  const progress = logicalPages.length ? Math.round((Math.min(logicalPages.length, spreadIndex + pagesShown) / logicalPages.length) * 100) : 0;

  function canTurn(turn: Exclude<TurnDirection, "">) {
    return turn === "prev" ? spreadIndex > 0 : spreadIndex < logicalPages.length - pagesShown;
  }

  function finishTurn(turn: Exclude<TurnDirection, "">) {
    if (settling || !canTurn(turn)) return;
    const continuesDrag = directionRef.current === turn && turnProgressRef.current > 0;
    directionRef.current = turn;
    setDirection(turn);
    setDragging(false);
    setSettling(true);
    if (continuesDrag) {
      turnProgressRef.current = 1;
      setTurnProgress(1);
    } else {
      turnProgressRef.current = 0;
      setTurnProgress(0);
      if (turnFrame.current !== null) window.cancelAnimationFrame(turnFrame.current);
      turnFrame.current = window.requestAnimationFrame(() => {
        turnFrame.current = window.requestAnimationFrame(() => {
          turnProgressRef.current = 1;
          setTurnProgress(1);
          turnFrame.current = null;
        });
      });
    }
    if (turnTimer.current !== null) window.clearTimeout(turnTimer.current);
    turnTimer.current = window.setTimeout(() => {
      const delta = turn === "next" ? 1 : -1;
      const step = singlePage ? 1 : 2;
      const next = Math.max(0, Math.min(spreadIndex + delta * step, Math.max(0, logicalPages.length - 1)));
      setIndex(next);
      onPageChange(next);
      directionRef.current = "";
      turnProgressRef.current = 0;
      setDirection("");
      setSettling(false);
      setTurnProgress(0);
    }, 980);
  }

  function cancelTurn() {
    setDragging(false);
    setSettling(true);
    turnProgressRef.current = 0;
    setTurnProgress(0);
    if (turnTimer.current !== null) window.clearTimeout(turnTimer.current);
    turnTimer.current = window.setTimeout(() => {
      directionRef.current = "";
      setDirection("");
      setSettling(false);
    }, 360);
  }

  function move(delta: number) {
    const turn = delta > 0 ? "next" : "prev";
    if (!canTurn(turn)) return;
    finishTurn(turn);
  }

  function updateDrag(clientX: number, width: number) {
    if (!pointer.current || settling) return;
    const distance = clientX - pointer.current.x;
    if (Math.abs(distance) < 3) return;
    const turn: Exclude<TurnDirection, ""> = distance < 0 ? "next" : "prev";
    if (!canTurn(turn)) return;
    const nextProgress = Math.min(0.96, Math.abs(distance) / Math.max(160, width * 0.72));
    pointer.current.moved = true;
    directionRef.current = turn;
    turnProgressRef.current = nextProgress;
    setDirection(turn);
    setDragging(true);
    setTurnProgress(nextProgress);
  }

  function releaseDrag() {
    if (!pointer.current) return;
    const moved = pointer.current.moved;
    pointer.current = null;
    suppressClick.current = moved;
    if (!moved || !directionRef.current) return;
    if (turnProgressRef.current >= 0.18) finishTurn(directionRef.current);
    else cancelTurn();
  }

  function turnFromClick(clientX: number, element: HTMLDivElement) {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    const rect = element.getBoundingClientRect();
    const turn = clientX < rect.left + rect.width / 2 ? "prev" : "next";
    if (canTurn(turn)) finishTurn(turn);
  }

  if (loading) {
    return <div className="book-loading"><LoaderCircle className="spin" /> 원본 책을 펼치는 중입니다.</div>;
  }
  if (error || !document) {
    return <div className="empty-state"><strong>전자책을 열 수 없습니다.</strong><p>{error}</p></div>;
  }

  return (
    <section ref={readerRef} className="reader-shell" aria-label="전자책 뷰어">
      <div className="reader-toolbar">
        <div>
          <span className="eyebrow">원문 전자책</span>
          <strong>비즈니스 성공의 퍼즐조각</strong>
        </div>
        <div className="reader-actions">
          <div className="fit-switch" aria-label="페이지 표시 방식">
            <button className={fitMode === "page" ? "active" : ""} aria-pressed={fitMode === "page"} onClick={() => setFitMode("page")}>전체 보기</button>
            <button className={fitMode === "width" ? "active" : ""} aria-pressed={fitMode === "width"} onClick={() => setFitMode("width")}>너비 맞춤</button>
          </div>
          <label className="page-jump">
            <Search size={16} />
            <input
              aria-label="페이지 이동"
              type="number"
              min={1}
              max={logicalPages.length}
              value={spreadIndex + 1}
              onChange={(event) => {
                const next = Math.max(0, Math.min(Number(event.target.value) - 1, logicalPages.length - 1));
                setIndex(next);
                onPageChange(next);
              }}
            />
            / {logicalPages.length}
          </label>
          <button className="icon-button" onClick={() => readerRef.current?.requestFullscreen?.()} aria-label="전자책 전체화면" title="전자책 전체화면">
            <Maximize2 size={18} />
          </button>
        </div>
      </div>
      <div className="reader-progress" aria-label={`독서 진행률 ${progress}%`}><i style={{ width: `${progress}%` }} /></div>
      <div
        className={`book-spread fit-${fitMode} ${direction ? `turn-${direction}` : ""} ${dragging ? "is-dragging" : ""} ${settling ? "is-settling" : ""}`}
        style={{ "--turn-angle": `${(direction === "next" ? -1 : 1) * turnProgress * 178}deg` } as React.CSSProperties}
        role="group"
        aria-label="책 페이지. 왼쪽을 누르면 이전 면, 오른쪽을 누르면 다음 면으로 이동합니다."
        tabIndex={0}
        onPointerDown={(event) => {
          if (settling) return;
          pointer.current = { x: event.clientX, moved: false };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => updateDrag(event.clientX, event.currentTarget.clientWidth)}
        onPointerUp={releaseDrag}
        onPointerCancel={cancelTurn}
        onClick={(event) => turnFromClick(event.clientX, event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") move(-1);
          if (event.key === "ArrowRight") move(1);
        }}
      >
        <PageCanvas document={document} page={current[0]} position="left" />
        <div className="book-gutter" />
        <PageCanvas document={document} page={current[1]} position="right" />
        <span className="page-corner page-corner--left" aria-hidden="true" />
        <span className="page-corner page-corner--right" aria-hidden="true" />
      </div>
      <div className="reader-nav">
        <button onClick={() => move(-1)} disabled={spreadIndex === 0}><ChevronLeft /> 이전</button>
        <span aria-live="polite">{current[1] ? `${current[0]?.label ?? 1}–${current[1].label}면` : `${current[0]?.label ?? 1}면`} · {progress}%</span>
        <button onClick={() => move(1)} disabled={spreadIndex >= logicalPages.length - pagesShown}>다음 <ChevronRight /></button>
      </div>
      <p className="reader-note">‘전체 보기’는 페이지 끝까지 한 화면에 표시합니다. 글자가 작으면 ‘너비 맞춤’으로 바꾸고 위아래로 스크롤하세요. 읽던 면은 자동 저장됩니다.</p>
    </section>
  );
}
