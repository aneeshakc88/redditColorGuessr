const SEGMENTS = ['#a855f7', '#a3e635', '#38bdf8'];

const SPECTRUM = 'conic-gradient(#ff0000,#ffff00,#00ff00,#00ffff,#0000ff,#ff00ff,#ff0000)';

export const Loader = ({ label, size = 76 }: { label?: string; size?: number }) => (
  <div className="flex h-dvh flex-col items-center justify-center gap-5 bg-white dark:bg-[#0d0d0f]">
    <style>{`
      @keyframes cg-spin { to { transform: rotate(360deg); } }
      @keyframes cg-seg { 0% { transform: scaleX(0); } 22%, 100% { transform: scaleX(1); } }
      .cg-wheel { animation: cg-spin 8s linear infinite; }
      .cg-seg-fill { transform-origin: left; animation: cg-seg 2.1s cubic-bezier(0.4,0,0.2,1) infinite; }
    `}</style>

    <div className="cg-wheel" style={{ width: size, height: size, borderRadius: '50%', background: SPECTRUM }} />

    <div style={{ display: 'flex', gap: 5, width: size * 1.95 }}>
      {SEGMENTS.map((c, i) => (
        <div key={c} style={{ flex: 1, height: 5, borderRadius: 3, background: 'rgba(128,128,128,0.28)', overflow: 'hidden' }}>
          <div className="cg-seg-fill" style={{ height: '100%', borderRadius: 3, background: c, animationDelay: `${i * 0.42}s` }} />
        </div>
      ))}
    </div>

    {label && <p className="text-xs font-semibold tracking-wide text-gray-400">{label}</p>}
  </div>
);
