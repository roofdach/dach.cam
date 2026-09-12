"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useCopy } from "@/lib/hooks";
import {
  DEFAULT_OPTIONS,
  run,
  runHash,
  TOOLS,
  type Field,
  type Result,
  type ToolId,
  type ToolOptions,
} from "@/lib/snip/tools";
import { CheckIcon, CopyIcon } from "../Icons";

const ALGORITHMS: ToolOptions["algorithm"][] = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];
const SWAPPABLE = new Set<ToolId>(["base64", "url"]);

function CopyButton({ value, label = "copy" }: { value: string; label?: string }) {
  const reduce = useReducedMotion();
  const { copied, copy } = useCopy();

  return (
    <button
      onClick={() => copy(value)}
      className="inline-flex items-center gap-1.5 text-[11.5px] text-muted transition-colors hover:text-ink"
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
          {copied ? "copied" : label}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}

function Rows({ caption, rows }: { caption: string; rows: Field[] }) {
  return (
    <section className="mt-5 border-t border-line pt-4">
      <h3 className="label mb-2.5">{caption}</h3>
      <dl className="space-y-1">
        {rows.map((row, i) => (
          <div key={`${row.label}-${i}`} className="group grid grid-cols-[8.5rem_1fr_auto] items-baseline gap-3">
            <dt className="truncate font-mono text-[11.5px] text-muted" title={row.label}>
              {row.label}
            </dt>
            <dd className="min-w-0 break-all font-mono text-[12px] text-ink-2">{row.value || <span className="text-faint">empty</span>}</dd>
            <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <CopyButton value={row.value} label="" />
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function Snip() {
  const reduce = useReducedMotion();
  const id = useId();
  const [tool, setTool] = useState<ToolId>("json");
  const [inputs, setInputs] = useState<Partial<Record<ToolId, string>>>({ json: TOOLS[0].placeholder });
  const [options, setOptions] = useState<ToolOptions>(DEFAULT_OPTIONS);
  const [hashed, setHashed] = useState<Result>({ ok: true, output: "" });

  const input = inputs[tool] ?? "";
  const current = TOOLS.find((t) => t.id === tool)!;
  const setInput = useCallback((value: string) => setInputs((prev) => ({ ...prev, [tool]: value })), [tool]);

  const synchronous = useMemo(() => (tool === "hash" ? null : run(tool, input, options)), [tool, input, options]);

  useEffect(() => {
    if (tool !== "hash") return;
    let alive = true;
    runHash(input, options.algorithm)
      .then((next) => alive && setHashed(next))
      .catch(() => alive && setHashed({ ok: false, error: "this browser wouldn't hash that. crypto.subtle needs a secure context." }));
    return () => {
      alive = false;
    };
  }, [tool, input, options.algorithm]);

  const result = synchronous ?? hashed;

  // alt+number jumps between tools without leaving the keyboard.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < TOOLS.length) {
        event.preventDefault();
        setTool(TOOLS[index].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const swap = () => {
    if (!result.ok || !result.output) return;
    setInput(result.output);
    setOptions((prev) => ({ ...prev, mode: prev.mode === "encode" ? "decode" : "encode" }));
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[13.5rem_1fr] lg:gap-10">
      <nav aria-label="Conversions" className="lg:sticky lg:top-8 lg:self-start">
        <h2 className="label mb-3">conversions</h2>
        <ul className="-mx-2 grid gap-0.5 sm:grid-cols-2 lg:grid-cols-1">
          {TOOLS.map((t, i) => {
            const on = t.id === tool;
            return (
              <li key={t.id}>
                <button
                  onClick={() => setTool(t.id)}
                  aria-current={on ? "true" : undefined}
                  className={`group flex w-full items-baseline gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    on ? "bg-paper-2 text-ink" : "text-muted hover:text-ink"
                  }`}
                >
                  <span className="text-[14px]">{t.label}</span>
                  <span className="ml-auto font-mono text-[10.5px] text-faint" aria-hidden>
                    ⌥{i + 1}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 hidden px-2 text-[12px] leading-relaxed text-muted lg:block">{current.blurb}</p>
      </nav>

      <div className="min-w-0 overflow-hidden rounded-xl border border-line bg-paper-2">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <h2 className="text-[14px] font-medium text-ink">{current.label}</h2>
            <p className="truncate text-[12.5px] text-muted lg:hidden">{current.blurb}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-[12px] text-muted">
            {tool === "json" && (
              <>
                <label className="flex items-center gap-1.5">
                  indent
                  <select
                    value={options.indent}
                    onChange={(e) => setOptions((p) => ({ ...p, indent: +e.target.value }))}
                    className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-ink"
                  >
                    <option value={0}>minified</option>
                    <option value={2}>2</option>
                    <option value={4}>4</option>
                  </select>
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={options.sortKeys}
                    onChange={(e) => setOptions((p) => ({ ...p, sortKeys: e.target.checked }))}
                    className="accent-(--accent)"
                  />
                  sort keys
                </label>
              </>
            )}

            {tool === "base64" && (
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={options.urlSafe}
                  onChange={(e) => setOptions((p) => ({ ...p, urlSafe: e.target.checked }))}
                  className="accent-(--accent)"
                />
                url-safe
              </label>
            )}

            {tool === "hash" && (
              <label className="flex items-center gap-1.5">
                algorithm
                <select
                  value={options.algorithm}
                  onChange={(e) => setOptions((p) => ({ ...p, algorithm: e.target.value as ToolOptions["algorithm"] }))}
                  className="rounded-md border border-line bg-paper px-1.5 py-0.5 text-ink"
                >
                  {ALGORITHMS.map((a) => (
                    <option key={a} value={a}>
                      {a.toLowerCase()}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {SWAPPABLE.has(tool) && (
              <div role="group" aria-label="Direction" className="flex rounded-full border border-line bg-paper p-0.5">
                {(["encode", "decode"] as const).map((m) => (
                  <button
                    key={m}
                    aria-pressed={options.mode === m}
                    onClick={() => setOptions((p) => ({ ...p, mode: m }))}
                    className={`rounded-full px-2.5 py-0.5 transition-colors ${
                      options.mode === m ? "bg-ink text-paper" : "text-muted hover:text-ink"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid lg:grid-cols-2">
          <div className="flex min-w-0 flex-col border-b border-line lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between px-4 pt-3 sm:px-5">
              <span className="label">input</span>
              <div className="flex items-center gap-3 text-[11.5px] text-muted">
                <button onClick={() => setInput(current.placeholder)} className="transition-colors hover:text-ink">
                  sample
                </button>
                {SWAPPABLE.has(tool) && result.ok && result.output && (
                  <button onClick={swap} className="transition-colors hover:text-ink">
                    swap
                  </button>
                )}
                {input && (
                  <button onClick={() => setInput("")} className="transition-colors hover:text-ink">
                    clear
                  </button>
                )}
              </div>
            </div>
            <label htmlFor={`${id}-input`} className="sr-only">
              {current.label} input
            </label>
            <textarea
              id={`${id}-input`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={current.placeholder}
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              className="min-h-[15rem] flex-1 resize-none bg-transparent px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-faint sm:px-5 sm:pb-5 lg:min-h-[28rem]"
            />
          </div>

          <div className="flex min-w-0 flex-col">
            <div className="flex items-center justify-between px-4 pt-3 sm:px-5">
              <span className="label">output</span>
              {result.ok && result.output && <CopyButton value={result.output} />}
            </div>

            <div className="min-h-[15rem] flex-1 px-4 py-3 sm:px-5 sm:pb-5 lg:min-h-[28rem]">
              {result.ok ? (
                <>
                  {result.swatch && (
                    <div className="mb-4 flex items-center gap-3">
                      <span
                        className="size-12 shrink-0 rounded-lg border border-line"
                        style={{ backgroundColor: result.swatch }}
                      />
                      <span className="font-mono text-[16px] text-ink">{result.output}</span>
                    </div>
                  )}

                  {result.ramp && (
                    <ul className="mb-4 flex h-7 overflow-hidden rounded-md border border-line" aria-label="Lightness ramp">
                      {result.ramp.map((step) => (
                        <li key={step} className="flex-1" style={{ backgroundColor: step }} title={step} />
                      ))}
                    </ul>
                  )}

                  {!result.swatch && (
                    <pre className="whitespace-pre-wrap break-all font-mono text-[12.5px] leading-relaxed text-ink">
                      {result.output || <span className="text-faint">nothing yet</span>}
                    </pre>
                  )}

                  {result.extra && (
                    <dl className="mt-4 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-[12px]">
                      {result.extra.map((e) => (
                        <div key={e.label} className="contents">
                          <dt className="text-muted">{e.label}</dt>
                          <dd className="min-w-0 break-all font-mono text-[11.5px] text-ink-2">{e.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}

                  {result.table && <Rows caption={result.table.caption} rows={result.table.rows} />}

                  {result.hint && <p className="mt-5 text-[12px] italic leading-relaxed text-muted">{result.hint}</p>}
                </>
              ) : (
                <p
                  className="font-mono text-[12.5px] leading-relaxed text-accent"
                  role="status"
                  aria-live={reduce ? "off" : "polite"}
                >
                  {result.error}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
