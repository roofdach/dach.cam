"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useMemo, useState } from "react";
import { useCopy } from "@/lib/hooks";
import { DEFAULT_OPTIONS, run, TOOLS, type ToolId } from "@/lib/snip/tools";
import { CheckIcon, CopyIcon } from "../Icons";

/** The preview shows the four conversions that read well at this size. */
const SHOWN: ToolId[] = ["json", "base64", "url", "color"];
const PREVIEW_TOOLS = SHOWN.map((id) => TOOLS.find((t) => t.id === id)!);

export function UtilityPreview() {
  const reduce = useReducedMotion();
  const [tool, setTool] = useState<ToolId>("json");
  const [inputs, setInputs] = useState<Record<string, string>>({ json: PREVIEW_TOOLS[0].placeholder });
  const [indent, setIndent] = useState(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [mode, setMode] = useState<"encode" | "decode">("encode");
  const { copied, copy } = useCopy();
  const id = useId();

  const input = inputs[tool] ?? "";
  const result = useMemo(
    () => run(tool, input, { ...DEFAULT_OPTIONS, indent, mode, sortKeys }),
    [tool, input, indent, mode, sortKeys],
  );
  const current = PREVIEW_TOOLS.find((t) => t.id === tool)!;

  return (
    <div className="flex h-full flex-col text-ink">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5 @md:px-6 @md:pt-6">
        <div role="tablist" aria-label="Tool" className="flex flex-wrap gap-1 text-[13px]">
          {PREVIEW_TOOLS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`${id}-tab-${t.id}`}
              aria-selected={tool === t.id}
              aria-controls={`${id}-panel`}
              onClick={() => setTool(t.id)}
              className={`relative rounded-full px-3 py-1 transition-colors ${
                tool === t.id ? "text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {tool === t.id && (
                <motion.span
                  layoutId={`${id}-tab-pill`}
                  className="absolute inset-0 -z-10 rounded-full border border-line bg-paper"
                  transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 text-[12px] text-muted">
          {tool === "json" && (
            <>
              <label className="flex items-center gap-1.5">
                indent
                <select
                  value={indent}
                  onChange={(e) => setIndent(+e.target.value)}
                  className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-ink"
                >
                  <option value={0}>min</option>
                  <option value={2}>2</option>
                  <option value={4}>4</option>
                </select>
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={sortKeys}
                  onChange={(e) => setSortKeys(e.target.checked)}
                  className="accent-(--accent)"
                />
                sort keys
              </label>
            </>
          )}
          {(tool === "base64" || tool === "url") && (
            <div role="group" aria-label="Direction" className="flex rounded-full border border-line bg-paper p-0.5">
              {(["encode", "decode"] as const).map((m) => (
                <button
                  key={m}
                  aria-pressed={mode === m}
                  onClick={() => setMode(m)}
                  className={`rounded-full px-2.5 py-0.5 transition-colors ${
                    mode === m ? "bg-ink text-paper" : "text-muted hover:text-ink"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${tool}`}
        className="mt-4 grid flex-1 grid-rows-[auto_auto] gap-0 @xl:grid-cols-2 @xl:grid-rows-1"
      >
        <div className="flex flex-col border-t border-line @xl:border-r">
          <div className="flex items-center justify-between px-5 pt-3 @md:px-6">
            <span className="label">input</span>
            {input && (
              <button
                onClick={() => setInputs((p) => ({ ...p, [tool]: "" }))}
                className="text-[11px] text-muted transition-colors hover:text-ink"
              >
                clear
              </button>
            )}
          </div>
          <label htmlFor={`${id}-input`} className="sr-only">
            {current.label} input
          </label>
          <textarea
            id={`${id}-input`}
            value={input}
            onChange={(e) => setInputs((p) => ({ ...p, [tool]: e.target.value }))}
            placeholder={current.placeholder}
            spellCheck={false}
            className="min-h-[9rem] flex-1 resize-none bg-transparent px-5 py-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-faint @md:px-6 @md:pb-6"
          />
        </div>

        <div className="relative flex flex-col border-t border-line">
          <div className="flex items-center justify-between px-5 pt-3 @md:px-6">
            <span className="label">output</span>
            {result.ok && result.output && (
              <button
                onClick={() => copy(result.output)}
                className="inline-flex items-center gap-1.5 text-[11px] text-muted transition-colors hover:text-ink"
                aria-live="polite"
              >
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={copied ? "copied" : "copy"}
                    initial={reduce ? false : { opacity: 0, y: 3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -3 }}
                    transition={{ duration: 0.15 }}
                    className="inline-flex items-center gap-1.5"
                  >
                    {copied ? <CheckIcon width={13} height={13} /> : <CopyIcon width={13} height={13} />}
                    {copied ? "copied" : "copy"}
                  </motion.span>
                </AnimatePresence>
              </button>
            )}
          </div>
          <div className="min-h-[9rem] flex-1 px-5 py-3 font-mono text-[12.5px] leading-relaxed @md:px-6 @md:pb-6">
            {result.ok ? (
              <>
                {result.swatch && (
                  <div className="mb-3 flex items-center gap-3">
                    <span className="size-9 rounded-md border border-line" style={{ backgroundColor: result.swatch }} />
                    <span className="text-[15px] text-ink">{result.output}</span>
                  </div>
                )}
                {!result.swatch && (
                  <pre className="whitespace-pre-wrap break-all text-ink">
                    {result.output || <span className="text-faint">nothing yet</span>}
                  </pre>
                )}
                {result.extra && (
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11.5px]">
                    {result.extra.slice(0, 4).map((e) => (
                      <div key={e.label} className="contents">
                        <dt className="text-muted">{e.label}</dt>
                        <dd className="truncate text-ink-2">{e.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            ) : (
              <p className="text-accent">{result.error}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
