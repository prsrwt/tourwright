// A coding agent's chat, for the intro video: the request and what the agent did, taken from the
// recorded unattended run in docs/agent-runs/team (its prompt, and the steps its transcript shows).

export interface AgentStep {
  text: string;
  detail?: string;
}

export function AgentChat({ request, steps }: { request: string; steps: AgentStep[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 shadow-2xl">
      <div className="flex items-center gap-2 border-b border-slate-800 px-6 py-4">
        <span className="h-3.5 w-3.5 rounded-full bg-red-400" />
        <span className="h-3.5 w-3.5 rounded-full bg-amber-400" />
        <span className="h-3.5 w-3.5 rounded-full bg-emerald-400" />
        <span className="ml-4 font-mono text-lg text-slate-400">coding agent</span>
      </div>
      <div className="flex flex-col gap-8 p-10 text-[28px] leading-relaxed">
        <div data-focus="prompt" className="w-fit max-w-[80%] self-end rounded-2xl bg-indigo-600 px-7 py-5 text-white">
          {request}
        </div>
        <ol data-focus="agent-steps" className="flex flex-col gap-4 font-mono text-[24px]">
          {steps.map((step) => (
            <li key={step.text} className="flex gap-4">
              <span className="text-emerald-400">✓</span>
              <span className="text-slate-100">
                {step.text}
                {step.detail && <span className="text-slate-400">{`  ${step.detail}`}</span>}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
