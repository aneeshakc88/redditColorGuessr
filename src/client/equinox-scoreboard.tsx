// Equinox leaderboard — same shape as the Colorwire scoreboard (tabbed scores /
// stats / analytics, your-rank strip, stepped 2·1·3 podium, ranked list) in
// Equinox's theme. Shared by the splash overlay and the in-game board.
import { useEffect, useState } from 'react';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';

type EqLbData = inferRouterOutputs<AppRouter>['equinox']['getLeaderboard'];
type EqAnalytics = inferRouterOutputs<AppRouter>['equinox']['getAnalytics'];
type Entry = EqLbData['top'][number];
type Tab = 'scores' | 'stats' | 'analytics';

const BG = 'radial-gradient(120% 90% at 50% -10%, #2a1608 0%, #17110c 45%, #0b0a08 100%)';
const ACCENT = '#f2842b';
const INK_ON_ACCENT = '#2a1403';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';
const MUTED = '#8a7b6b';

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const AVATAR_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#a855f7'];

const Avatar = ({ name, url, size = 30, border }: { name: string; url?: string | undefined; size?: number; border?: string }) => {
  if (url) return <img src={url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />;
  const bg = AVATAR_COLORS[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]!;
  return <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, color: '#fff', flexShrink: 0, border }}>{name[0]?.toUpperCase()}</div>;
};

// Podium reads as a staircase: gold stands tallest, bronze lowest. The cards are
// bottom-aligned, so the extra height on 1 lifts it above 2 and 3.
const STEP: Record<1 | 2 | 3, number> = { 1: 40, 2: 20, 3: 0 };

const ScoresTab = ({ data }: { data: EqLbData | null }) => {
  const top = data?.top ?? [];
  const username = data?.username ?? null;
  const snoovatars = data?.snoovatars ?? {};
  const count = data?.dailyCount ?? 0;
  const podium = [top[1], top[0], top[2]] as (Entry | undefined)[];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT, background: 'rgba(242,132,43,0.16)', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
          Today's Solvers
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MUTED, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {count} {count === 1 ? 'solver' : 'solvers'} · {data?.date ?? ''}
        </span>
      </div>

      {username && (
        <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 10, background: CARD, borderRadius: 12, padding: '9px 14px', border: `1px solid ${BORDER}` }}>
          <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MUTED, margin: 0, whiteSpace: 'nowrap' }}>Your Rank</p>
          <Avatar name={username} url={snoovatars[username]} size={26} />
          <p style={{ flex: 1, fontSize: 13, fontWeight: 900, margin: 0 }}>{data?.userRank ? `#${data.userRank}` : '—'}</p>
          {data?.userTimeSec != null && <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(data.userTimeSec)}</p>}
          <p style={{ fontSize: 13, fontWeight: 800, color: ACCENT, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{data?.userScore ?? '—'}</p>
        </div>
      )}

      {top.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <p style={{ fontSize: 13, color: MUTED, textAlign: 'center' }}>Nobody has solved today's board yet. Be the first!</p>
        </div>
      ) : (
        <div className="eq-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ margin: '16px 16px 4px', display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            {podium.map((entry, podiumIdx) => {
              const rank = (podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3) as 1 | 2 | 3;
              const isFirst = rank === 1;
              const isMe = entry?.member === username;
              return entry ? (
                <div key={entry.member} style={{
                  flex: isFirst ? 1.4 : 1, minWidth: 0, marginBottom: STEP[rank],
                  background: isFirst ? 'rgba(242,132,43,0.14)' : CARD,
                  border: `1.5px solid ${isFirst ? ACCENT : BORDER}`,
                  borderRadius: 16, padding: '12px 6px 10px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                  outline: isMe ? `2px solid ${ACCENT}` : undefined,
                }}>
                  <Avatar name={entry.member} url={snoovatars[entry.member]} size={isFirst ? 44 : 34} border={`1.5px solid ${isFirst ? ACCENT : BORDER}`} />
                  <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? ACCENT : MUTED, margin: 0, lineHeight: 1 }}>{rank}</p>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#d4d4d8', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <span style={{ background: isFirst ? ACCENT : 'rgba(255,255,255,0.1)', color: isFirst ? INK_ON_ACCENT : '#d4d4d8', fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px', fontVariantNumeric: 'tabular-nums' }}>{entry.score}</span>
                  {entry.timeSec != null && <p style={{ fontSize: 9, fontWeight: 600, color: MUTED, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{fmtTime(entry.timeSec)}</p>}
                </div>
              ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1 }} />;
            })}
          </div>

          <div style={{ paddingBottom: 16 }}>
            {top.slice(3).map((entry, i) => {
              const isMe = entry.member === username;
              return (
                <div key={entry.member} style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                  background: isMe ? 'rgba(242,132,43,0.12)' : 'transparent',
                  borderLeft: `3px solid ${isMe ? ACCENT : 'transparent'}`,
                }}>
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: MUTED, margin: 0, fontVariantNumeric: 'tabular-nums' }}>{i + 4}</p>
                  <Avatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#fff' : '#d4d4d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                    {entry.timeSec != null && <p style={{ fontSize: 10, fontWeight: 600, color: MUTED, margin: '1px 0 0', fontVariantNumeric: 'tabular-nums' }}>{fmtTime(entry.timeSec)}</p>}
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 800, color: isMe ? ACCENT : '#a1a1aa', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{entry.score}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const StatCell = ({ label, value, accent }: { label: string; value: string; accent?: boolean }) => (
  <div style={{ background: CARD, borderRadius: 16, padding: '14px 8px', border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
    <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MUTED, margin: 0, textAlign: 'center' }}>{label}</p>
    <p style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-0.03em', color: accent ? ACCENT : '#fff', margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
  </div>
);

const StatsTab = ({ data }: { data: EqLbData | null }) => {
  const stats = data?.stats;
  const username = data?.username;
  const snoovatars = data?.snoovatars ?? {};

  return (
    <div className="eq-scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', overflowY: 'auto', overscrollBehavior: 'contain' }}>
      {!username ? (
        <p style={{ marginTop: 32, fontSize: 14, color: MUTED }}>Sign in to see your stats.</p>
      ) : (
        <>
          <Avatar name={username} url={snoovatars[username]} size={68} border={`2px solid ${ACCENT}`} />
          <p style={{ fontSize: 17, fontWeight: 900, color: '#fff', margin: '10px 0 0' }}>u/{username}</p>
          {stats ? (
            <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0', textAlign: 'center' }}>
              Best: {stats.bestScore} &nbsp;·&nbsp; Fastest: {stats.bestTime ? fmtTime(stats.bestTime) : '—'} &nbsp;·&nbsp; Solves: {stats.games}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: MUTED, margin: '2px 0 0' }}>No daily boards solved yet.</p>
          )}

          {stats && (
            <div style={{ marginTop: 24, width: '100%', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <StatCell label="Best Score" value={String(stats.bestScore)} accent />
              <StatCell label="Fastest Solve" value={stats.bestTime ? fmtTime(stats.bestTime) : '—'} />
              <StatCell label="Daily Solves" value={String(stats.games)} />
              <StatCell label="Day Streak" value={data?.streak != null ? String(data.streak) : '—'} accent />
            </div>
          )}
        </>
      )}
    </div>
  );
};

const AnalyticsTab = ({ data }: { data: EqAnalytics | null }) => {
  if (!data) {
    return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ fontSize: 13, color: MUTED }}>Loading analytics…</p></div>;
  }
  const fmt = (n: number) => n.toLocaleString();
  const maxCount = Math.max(...data.perDay.slice(0, 14).map(d => d.count), 1);

  return (
    <div className="eq-scroll" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflowY: 'auto', overscrollBehavior: 'contain', padding: '16px 16px 24px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {[
          { label: 'Today', value: fmt(data.todayCount) },
          { label: 'Last 7 Days', value: fmt(data.weekTotal) },
          { label: 'Last 30 Days', value: fmt(data.monthTotal) },
          { label: 'All-Time Solvers', value: fmt(data.alltimeCount) },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: CARD, borderRadius: 16, padding: '14px 8px', border: `1px solid ${BORDER}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MUTED, margin: 0, textAlign: 'center' }}>{label}</p>
            <p style={{ fontSize: 24, fontWeight: 900, color: ACCENT, margin: '4px 0 0', fontVariantNumeric: 'tabular-nums' }}>{value}</p>
            <p style={{ fontSize: 9, color: MUTED, margin: 0 }}>solvers</p>
          </div>
        ))}
      </div>

      <p style={{ margin: '20px 0 8px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MUTED }}>Last 14 Days</p>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
        {data.perDay.slice(0, 14).reverse().map(({ date, count }) => (
          // Day-of-month only — MM/DD needs ~26px a column and clips under 360px.
          <div key={date} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={`${date}: ${count}`}>
            <div style={{ width: '100%', height: Math.max(2, Math.round((count / maxCount) * 68)), borderRadius: '3px 3px 0 0', background: ACCENT, opacity: count ? 0.85 : 0.3 }} />
            <p style={{ fontSize: 8, color: MUTED, margin: 0, lineHeight: 1 }}>{date.split('-')[2]}</p>
          </div>
        ))}
      </div>

      <p style={{ margin: '20px 0 6px', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MUTED }}>Daily Breakdown</p>
      <div>
        {data.perDay.map(({ date, count }) => (
          <div key={date} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 10, background: CARD, marginBottom: 3 }}>
            <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: '#a1a1aa', margin: 0 }}>{date}</p>
            <p style={{ fontSize: 12, fontWeight: 800, color: '#fff', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{count}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

export const EquinoxScoreboard = ({ onClose, overlay }: { onClose: () => void; overlay?: boolean }) => {
  const [data, setData] = useState<EqLbData | null>(null);
  const [analytics, setAnalytics] = useState<EqAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMod, setIsMod] = useState(false);
  const [tab, setTab] = useState<Tab>('scores');

  useEffect(() => {
    trpc.equinox.getLeaderboard.query().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
    trpc.game.isMod.query().then(d => setIsMod(d.isMod)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'analytics' && !analytics) trpc.equinox.getAnalytics.query().then(setAnalytics).catch(() => {});
  }, [tab, analytics]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        flex: 1, minWidth: 0, borderRadius: 999, padding: '6px 0',
        fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
        background: tab === t ? ACCENT : 'transparent',
        color: tab === t ? INK_ON_ACCENT : MUTED,
        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      ...(overlay ? { position: 'absolute' as const, inset: 0, zIndex: 20 } : { height: '100vh' }),
      display: 'flex', flexDirection: 'column', overflow: 'hidden', background: BG, color: '#fff',
    }}>
      <style>{`.eq-scroll::-webkit-scrollbar{ width:0; height:0; }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 12px', flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>Leaderboard</h2>
        <button onClick={onClose} aria-label="Close" style={{ flexShrink: 0, width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${BORDER}`, background: 'transparent', cursor: 'pointer', color: '#a1a1aa', fontSize: 15 }}>✕</button>
      </div>

      <div style={{ margin: '0 16px', background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: 3, display: 'flex', flexShrink: 0 }}>
        {tabBtn('scores', 'Scores')}
        {tabBtn('stats', 'Stats')}
        {isMod && tabBtn('analytics', 'Analytics')}
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ fontSize: 13, color: MUTED }}>Loading…</p></div>
      ) : tab === 'scores' ? (
        <ScoresTab data={data} />
      ) : tab === 'stats' ? (
        <StatsTab data={data} />
      ) : (
        <AnalyticsTab data={analytics} />
      )}
    </div>
  );
};
