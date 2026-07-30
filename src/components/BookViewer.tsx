import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize2, Search } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type LogicalPage = { pdf: number; side: "full" | "left" | "right"; label: number };

function PageCanvas({
  document: pdfDocument,
  page,
}: {
  document: pdfjsLib.PDFDocumentProxy;
  page?: LogicalPage;
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
    <div className={`book-page ${page ? "" : "book-page--empty"}`}>
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
  const [direction, setDirection] = useState<"next" | "prev" | "">("");
  const dragStart = useRef<number | null>(null);

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

  const spreadIndex = Math.max(0, Math.min(index - (index % 2), Math.max(0, logicalPages.length - 1)));
  const current = useMemo(
    () => [logicalPages[spreadIndex], logicalPages[spreadIndex + 1]],
    [logicalPages, spreadIndex],
  );

  function move(delta: number) {
    const next = Math.max(0, Math.min(spreadIndex + delta * 2, Math.max(0, logicalPages.length - 1)));
    setDirection(delta > 0 ? "next" : "prev");
    setIndex(next);
    onPageChange(next);
    window.setTimeout(() => setDirection(""), 460);
  }

  if (loading) {
    return <div className="book-loading"><LoaderCircle className="spin" /> 원본 책을 펼치는 중입니다.</div>;
  }
  if (error || !document) {
    return <div className="empty-state"><strong>전자책을 열 수 없습니다.</strong><p>{error}</p></div>;
  }

  return (
    <section className="reader-shell" aria-label="전자책 뷰어">
      <div className="reader-toolbar">
        <div>
          <span className="eyebrow">원문 전자책</span>
          <strong>비즈니스 성공의 퍼즐조각</strong>
        </div>
        <div className="reader-actions">
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
          <button className="icon-button" onClick={() => window.document.documentElement.requestFullscreen?.()} aria-label="전체화면">
            <Maximize2 size={18} />
          </button>
        </div>
      </div>
      <div
        className={`book-spread ${direction ? `turn-${direction}` : ""}`}
        onPointerDown={(event) => {
          dragStart.current = event.clientX;
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerUp={(event) => {
          if (dragStart.current === null) return;
          const distance = event.clientX - dragStart.current;
          if (Math.abs(distance) > 45) move(distance < 0 ? 1 : -1);
          dragStart.current = null;
        }}
      >
        <PageCanvas document={document} page={current[0]} />
        <div className="book-gutter" />
        <PageCanvas document={document} page={current[1]} />
      </div>
      <div className="reader-nav">
        <button onClick={() => move(-1)} disabled={spreadIndex === 0}><ChevronLeft /> 이전</button>
        <span>{current[0]?.label ?? 1}–{current[1]?.label ?? current[0]?.label}면</span>
        <button onClick={() => move(1)} disabled={spreadIndex >= logicalPages.length - 2}>다음 <ChevronRight /></button>
      </div>
      <p className="reader-note">모서리를 좌우로 드래그하거나 버튼을 눌러 넘기세요. 원문은 저자의 시대적 관점을 포함합니다.</p>
    </section>
  );
}
