"use client";

import { useRef, useState } from "react";

type Status = "idle" | "copied" | "downloaded" | "failed";

/**
 * Wraps a chart and adds "Copy PNG" / "Download PNG" actions.
 *
 * The child must render a single <svg> with explicit width/height attributes and
 * literal colours (see palette.ts). The SVG is serialised, painted onto a canvas
 * at 2x for a crisp raster, then written to the clipboard as image/png.
 *
 * Clipboard image writes need a secure context and are unsupported in Firefox,
 * so a failed copy falls back to a file download rather than dead-ending.
 */
export default function ChartFrame({
  title,
  subtitle,
  filename,
  children,
  wide,
}: {
  title: string;
  subtitle?: string;
  filename: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("idle");

  function flash(s: Status) {
    setStatus(s);
    window.setTimeout(() => setStatus("idle"), 2200);
  }

  async function toBlob(): Promise<Blob | null> {
    const svg = hostRef.current?.querySelector("svg");
    if (!svg) return null;

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const w = Number(svg.getAttribute("width")) || svg.clientWidth || 1000;
    const h = Number(svg.getAttribute("height")) || svg.clientHeight || 400;

    // Paint an opaque background so the PNG is usable on a dark slide.
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", "0");
    bg.setAttribute("y", "0");
    bg.setAttribute("width", String(w));
    bg.setAttribute("height", String(h));
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, clone.firstChild);

    const svgText = new XMLSerializer().serializeToString(clone);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;

    const img = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG did not load"));
    });
    img.src = url;
    await loaded;

    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  function download(blob: Blob) {
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `${filename}.png`;
    a.click();
    URL.revokeObjectURL(href);
  }

  async function onCopy() {
    try {
      const blob = await toBlob();
      if (!blob) return flash("failed");
      const anyWindow = window as unknown as { ClipboardItem?: typeof ClipboardItem };
      if (navigator.clipboard && "write" in navigator.clipboard && anyWindow.ClipboardItem) {
        await navigator.clipboard.write([new anyWindow.ClipboardItem({ "image/png": blob })]);
        flash("copied");
      } else {
        // Firefox and insecure contexts cannot write images to the clipboard.
        download(blob);
        flash("downloaded");
      }
    } catch {
      try {
        const blob = await toBlob();
        if (blob) {
          download(blob);
          return flash("downloaded");
        }
      } catch {
        /* fall through */
      }
      flash("failed");
    }
  }

  async function onDownload() {
    try {
      const blob = await toBlob();
      if (!blob) return flash("failed");
      download(blob);
      flash("downloaded");
    } catch {
      flash("failed");
    }
  }

  const msg =
    status === "copied"
      ? "Copied to clipboard"
      : status === "downloaded"
        ? "PNG downloaded"
        : status === "failed"
          ? "Could not export"
          : "";

  return (
    <div className={`card chart-card${wide ? " chart-wide" : ""}`}>
      <div className="chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle ? <div className="chart-sub">{subtitle}</div> : null}
        </div>
        <div className="chart-actions">
          {msg ? <span className={`chart-msg${status === "failed" ? " bad" : ""}`}>{msg}</span> : null}
          <button type="button" className="btn ghost sm" onClick={onCopy}>
            Copy PNG
          </button>
          <button type="button" className="btn ghost sm" onClick={onDownload}>
            Download
          </button>
        </div>
      </div>
      <div className="chart-host" ref={hostRef}>
        {children}
      </div>
    </div>
  );
}
