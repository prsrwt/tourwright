// Who does what, for someone new: you ask, the agent makes the video, you review it in Muse (and the
// agent handles your notes), and the final video comes out. Muse is the only part you touch.
import type { ReactNode } from 'react';

function Step({ focus, who, title, children, muse }: { focus: string; who: string; title: string; children: ReactNode; muse?: boolean }) {
  return (
    <div data-focus={focus} className={`flex w-[380px] flex-col gap-4 rounded-3xl border-2 p-8 ${muse ? 'border-[#EDB8A4] bg-[#FCDED3]' : 'border-slate-200 bg-white'}`}>
      <div className="text-xl font-semibold uppercase tracking-widest text-slate-600">{who}</div>
      <div className="text-4xl font-semibold text-slate-900">{title}</div>
      <div className="text-2xl leading-relaxed text-slate-700">{children}</div>
    </div>
  );
}

const Arrow = () => <div className="text-6xl text-slate-400" aria-hidden="true">→</div>;

export function Roles() {
  return (
    <main className="flex h-[1080px] w-[1920px] flex-col items-center justify-center gap-16 bg-[#FBF8F6] px-20">
      <h1 data-focus="heading" className="text-6xl font-semibold text-slate-900">
        Making a video with your agent
      </h1>
      <div data-focus="steps" className="flex items-stretch gap-8">
        <Step focus="ask" who="You" title="Ask">
          &ldquo;Make a short video of the Team page for new joiners.&rdquo;
        </Step>
        <Arrow />
        <Step focus="make" who="Your agent" title="Makes it">
          Writes the narration, sets up your screens and checks every moment.
        </Step>
        <Arrow />
        <Step focus="review" who="You, in Muse" title="Review" muse>
          Watch it, leave notes, and approve it when it is right.
        </Step>
        <Arrow />
        <Step focus="final" who="Muse" title="Final video">
          An MP4 with the real voice, ready to share.
        </Step>
      </div>
      <div data-focus="loop" className="flex items-center gap-6 rounded-full border-2 border-dashed border-slate-300 px-10 py-5 text-3xl text-slate-700">
        <span aria-hidden="true">↺</span> Your notes go back to the agent, and it sends you a new version
      </div>
    </main>
  );
}
