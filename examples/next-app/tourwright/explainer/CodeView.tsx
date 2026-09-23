// Shows a real source file with line numbers. Ranges of lines become data-focus targets, found by
// the text they start and end with, so the video points at the file as it actually is.

export interface CodeMark {
  focus: string;
  /** Text on the first line of the range. */
  from: string;
  /** Text on the last line of the range; the first line alone when left out. */
  to?: string;
}

/** Show only the lines from the one containing `from` up to, not including, the one containing `until`. */
export interface CodeWindow {
  from: string;
  until: string;
}

export function CodeView({ file, source, marks, window }: { file: string; source: string; marks: CodeMark[]; window?: CodeWindow }) {
  const lines = source.replace(/\r\n/g, '\n').trimEnd().split('\n');
  const find = (text: string, after = 0) => {
    const index = lines.findIndex((line, i) => i >= after && line.includes(text));
    if (index === -1) throw new Error(`CodeView: "${text}" is not in ${file}.`);
    return index;
  };
  const start = window ? find(window.from) : 0;
  const end = window ? find(window.until, start) : lines.length;
  const ranges = marks.map((mark) => {
    const first = find(mark.from, start);
    return { focus: mark.focus, first, last: mark.to ? find(mark.to, first) : first };
  });

  const rows = [];
  for (let i = start; i < end; ) {
    const range = ranges.find((r) => r.first === i);
    const last = range ? range.last : i;
    const block = lines.slice(i, last + 1).map((line, j) => (
      <div key={i + j} className="flex">
        <span className="w-16 shrink-0 select-none pr-6 text-right text-slate-500">{i + j + 1}</span>
        <span className="min-w-0 whitespace-pre-wrap break-words text-slate-100">{line || ' '}</span>
      </div>
    ));
    rows.push(range ? <div key={i} data-focus={range.focus} className="w-fit max-w-full">{block}</div> : block);
    i = last + 1;
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
      <div className="border-b border-slate-800 px-6 py-4 font-mono text-lg text-slate-400">{file}</div>
      <div className="p-8 font-mono text-[22px] leading-relaxed">{rows}</div>
    </div>
  );
}
