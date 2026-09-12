const groups = [
  { label: "mostly", items: ["typescript", "react", "next.js", "css", "tailwind"] },
  { label: "also", items: ["node.js", "javascript", "git", "rest & websocket apis"] },
  { label: "trying", items: ["canvas", "motion design", "rust"] },
];

export function Skills() {
  return (
    <div className="text-[14px]">
      <h3 className="label mb-4">things i reach for</h3>
      <dl className="space-y-4">
        {groups.map((g) => (
          <div key={g.label} className="grid grid-cols-[4rem_1fr] gap-3">
            <dt className="font-mono text-[11.5px] text-faint pt-0.5">{g.label}</dt>
            <dd className="text-ink-2 leading-relaxed">{g.items.join(", ")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
