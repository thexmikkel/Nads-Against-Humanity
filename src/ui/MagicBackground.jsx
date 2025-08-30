import React from 'react'

// positions for twinkles (percent coords + size scalar)
const SPARKLES = [
  [12, 18, 1.0], [28, 35, 0.8], [47, 22, 1.2], [63, 14, 0.9],
  [78, 42, 1.1], [86, 27, 0.7], [14, 62, 0.9], [33, 71, 1.0],
  [52, 64, 0.75],[69, 79, 1.15],[84, 66, 0.85],[22, 83, 1.0],
]

export default function MagicBackground() {
  return (
    <>
      <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        {/* Base deep gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-[#0b0317] via-[#150b2b] to-[#1a1034]" />

        {/* Large mystical glows */}
        <div className="absolute -top-40 -left-40 h-[85vh] w-[85vh] rounded-full blur-3xl
                        bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.18),transparent_60%)]" />
        <div className="absolute top-1/3 -right-52 h-[70vh] w-[70vh] rounded-full blur-3xl
                        bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.12),transparent_60%)]" />
        <div className="absolute bottom-[-15vh] left-1/4 h-[65vh] w-[65vh] rounded-full blur-3xl
                        bg-[radial-gradient(circle_at_center,rgba(91,47,163,0.20),transparent_60%)]" />

        {/* Slow drifting “nebula” blobs */}
        <div className="absolute inset-0 mix-blend-screen opacity-[0.6]">
          <div className="nebula animate-drift"
               style={{
                 top: '15%', left: '20%',
                 width: '36rem', height: '36rem',
                 background: 'radial-gradient(closest-side, rgba(167,139,250,0.14), transparent 60%)'
               }} />
          <div className="nebula animate-drift-slow"
               style={{
                 top: '55%', left: '60%',
                 width: '28rem', height: '28rem',
                 background: 'radial-gradient(closest-side, rgba(34,211,238,0.10), transparent 60%)'
               }} />
          <div className="nebula animate-drift"
               style={{
                 top: '30%', left: '72%',
                 width: '22rem', height: '22rem',
                 background: 'radial-gradient(closest-side, rgba(203,166,247,0.12), transparent 60%)'
               }} />
        </div>

        {/* Twinkling sigils/stars */}
        <div className="absolute inset-0">
          {SPARKLES.map(([x, y, s], i) => (
            <div key={i}
                 className="absolute rounded-full bg-white/80 shadow-[0_0_8px_1px_rgba(167,139,250,0.6)] animate-twinkle"
                 style={{
                   left: `${x}%`, top: `${y}%`,
                   width: `${1.5 * s}px`, height: `${1.5 * s}px`,
                   animationDelay: `${i * 0.35}s`
                 }} />
          ))}
        </div>

        {/* Subtle film grain */}
        <div className="absolute inset-0 opacity-[0.10] mix-blend-overlay grain" />

        {/* Vignette to focus content */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0)_0%,rgba(0,0,0,0.12)_55%,rgba(0,0,0,0.55)_100%)]" />
      </div>

      {/* local styles for keyframes + helpers */}
      <style>{`
        @keyframes drift {
          0%   { transform: translate3d(0, 0, 0) scale(1);   filter: hue-rotate(0deg) }
          50%  { transform: translate3d(-2%, 1%, 0) scale(1.06); filter: hue-rotate(8deg) }
          100% { transform: translate3d(0, 0, 0) scale(1);   filter: hue-rotate(0deg) }
        }
        .animate-drift { animation: drift 20s ease-in-out infinite; }
        .animate-drift-slow { animation: drift 32s ease-in-out infinite; }

        @keyframes twinkle {
          0%   { opacity: .35; transform: scale(1) }
          50%  { opacity: 1;   transform: scale(1.8) }
          100% { opacity: .35; transform: scale(1) }
        }
        .animate-twinkle { animation: twinkle 3.8s ease-in-out infinite; }

        .nebula { position:absolute; border-radius:9999px; filter: blur(40px); }

        /* subtle procedural grain with layered gradients (no images) */
        .grain {
          background-image:
            radial-gradient(1px 1px at 10% 20%, rgba(255,255,255,0.08), transparent),
            radial-gradient(1px 1px at 30% 80%, rgba(255,255,255,0.06), transparent),
            radial-gradient(1px 1px at 70% 40%, rgba(255,255,255,0.05), transparent),
            radial-gradient(1px 1px at 90% 70%, rgba(255,255,255,0.07), transparent);
          animation: grainShift 12s linear infinite;
        }
        @keyframes grainShift {
          0% { transform: translate3d(0,0,0) }
          100% { transform: translate3d(-2%, -1%, 0) }
        }
      `}</style>
    </>
  )
}
