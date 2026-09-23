// A terminal window for the setup walkthrough. Each block is one command and its output, copied
// from real runs (paths shortened, noise trimmed), and wrapped in data-focus so the camera can
// visit it.

export interface TerminalBlock {
  focus: string;
  command: string;
  output: string[];
  /** Output lines to wrap in their own target, as [target, first line, last line]. */
  marks?: [string, number, number][];
}

export function Terminal({ blocks }: { blocks: TerminalBlock[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-slate-800 px-6 py-4">
        <span className="h-3.5 w-3.5 rounded-full bg-red-400" />
        <span className="h-3.5 w-3.5 rounded-full bg-amber-400" />
        <span className="h-3.5 w-3.5 rounded-full bg-emerald-400" />
        <span className="ml-4 font-mono text-lg text-slate-400">my-app</span>
      </div>
      <div className="flex flex-col gap-10 p-10 font-mono text-[26px] leading-relaxed">
        {blocks.map((block) => (
          <div key={block.focus} data-focus={block.focus}>
            <div className="text-slate-100">
              <span className="text-emerald-400">$ </span>
              {block.command}
            </div>
            <Output lines={block.output} marks={block.marks ?? []} />
          </div>
        ))}
      </div>
    </div>
  );
}

function Output({ lines, marks }: { lines: string[]; marks: [string, number, number][] }) {
  const out = [];
  for (let i = 0; i < lines.length; ) {
    const mark = marks.find(([, first]) => first === i);
    if (mark) {
      const [name, first, last] = mark;
      out.push(
        <div key={i} data-focus={name} className="w-fit max-w-full">
          {lines.slice(first, last + 1).map((line, j) => (
            <Line key={j} text={line} />
          ))}
        </div>,
      );
      i = last + 1;
    } else {
      out.push(<Line key={i} text={lines[i]!} />);
      i += 1;
    }
  }
  return <div className="mt-2">{out}</div>;
}

function Line({ text }: { text: string }) {
  const colour = text.startsWith('ok ') ? 'text-emerald-300' : text.startsWith('  created') ? 'text-sky-300' : 'text-slate-400';
  return <div className={`whitespace-pre ${colour}`}>{text || ' '}</div>;
}
