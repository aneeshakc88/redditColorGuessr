// Shared leaderboard UI — used by ColorGuessr (splash), Flag, and Mastermind.
import { useEffect, useState } from 'react';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';
import { MASTERMIND_CONFIG, mmConfig } from '../shared/mastermind-core';

type MmLbData = inferRouterOutputs<AppRouter>['mastermind']['getScoreboard'];
type MmLbAnalytics = inferRouterOutputs<AppRouter>['mastermind']['getAnalytics'];

export type LbEntry = { member: string; score: number };
export type LbStats = { games: number; totalScore: number; bestScore: number };
export type LbData = {
  top: LbEntry[];
  userRank: number | null;
  userScore: number | null;
  username: string | null;
  stats?: LbStats | null;
  lbMode: 'alltime' | 'daily' | 'custom';
  dailyCount?: number | null;
  snoovatars?: Record<string, string>;
} | null;
export type LbAnalytics = {
  perDay: { date: string; count: number }[];
  todayCount: number;
  weekTotal: number;
  monthTotal: number;
  alltimeCount: number;
} | null;

export const UserAvatar = ({ name, url, size = 36, border }: { name: string; url?: string | undefined; size?: number; border?: string }) => {
  const src = url || '/snoo.png';
  return (
    <img
      src={src}
      alt={name}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size, border }}
      onError={(e) => {
        const img = e.currentTarget as HTMLImageElement;
        if (img.src !== '/snoo.png') img.src = '/snoo.png';
        else img.style.display = 'none';
      }}
    />
  );
};

export const ScoresTab = ({ data }: { data: LbData }) => {
  const snoovatars = data?.snoovatars ?? {};
  const top = data?.top ?? [];
  const lbMode = data?.lbMode ?? 'daily';
  const username = data?.username ?? null;
  const podium = [top[1], top[0], top[2]] as (typeof top[number] | undefined)[];

  const badgeConfig = {
    alltime: { label: 'All-time Best Scores', color: '#3b82f6', bg: '#eff6ff' },
    daily:   { label: "Today's Scores",       color: '#ea580c', bg: '#fff7ed' },
    custom:  { label: 'This Puzzle Scores',   color: '#8b5cf6', bg: '#f5f3ff' },
  }[lbMode];

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Mode badge + play count */}
      <div className="mx-4 mt-3 flex shrink-0 items-center justify-between">
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase',
          color: badgeConfig.color, background: badgeConfig.bg,
          borderRadius: 999, padding: '3px 10px',
        }}>
          {badgeConfig.label}
        </span>
        {lbMode !== 'custom' && data?.dailyCount != null && (
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af' }}>
            {data.dailyCount} plays today
          </span>
        )}
      </div>

      {/* Your rank strip */}
      {username && (
        <div style={{
          margin: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 10,
          background: '#fff7ed', borderRadius: 12, padding: '9px 14px',
          border: '1px solid #fed7aa',
        }}>
          <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: '#9ca3af', margin: 0, whiteSpace: 'nowrap' }}>Your Rank</p>
          <UserAvatar name={username} url={snoovatars[username]} size={26} />
          <p style={{ flex: 1, fontSize: 13, fontWeight: 900, color: '#111', margin: 0 }}>
            {data?.userRank ? `#${data.userRank}` : '—'}
          </p>
          <p style={{ fontSize: 13, fontWeight: 800, color: '#ea580c', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
            {data?.userScore != null ? `${data.userScore}/100` : '—'}
          </p>
        </div>
      )}

      {top.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-gray-400">No scores yet. Be the first to play!</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
          {/* Podium top 3 */}
          {top.length >= 1 && (
            <div style={{ margin: '16px 16px 4px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              {podium.map((entry, podiumIdx) => {
                const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
                const isFirst = rank === 1;
                const isMe = entry?.member === username;
                return entry ? (
                  <div
                    key={entry.member}
                    style={{
                      flex: isFirst ? 1.4 : 1,
                      background: isFirst ? '#fff7ed' : '#f9fafb',
                      border: isFirst ? '1.5px solid #fed7aa' : '1.5px solid #e5e7eb',
                      borderRadius: 16, padding: '12px 8px 10px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      outline: isMe ? '2px solid #ea580c' : undefined,
                    }}
                  >
                    <UserAvatar
                      name={entry.member}
                      url={snoovatars[entry.member]}
                      size={isFirst ? 44 : 34}
                      border={isFirst ? '1.5px solid #ea580c' : '1.5px solid #e5e7eb'}
                    />
                    <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? '#ea580c' : '#6b7280', margin: 0 }}>{rank}</p>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#374151', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                    <span style={{
                      background: isFirst ? '#ea580c' : '#e5e7eb',
                      color: isFirst ? '#fff' : '#6b7280',
                      fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px',
                    }}>{entry.score}</span>
                  </div>
                ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1 }} />;
              })}
            </div>
          )}

          {/* Rest of list rank 4+ */}
          <div style={{ paddingBottom: 16 }}>
            {top.slice(3).map((entry, i) => {
              const rank = i + 4;
              const isMe = entry.member === username;
              return (
                <div
                  key={entry.member}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 16px',
                    background: isMe ? '#fff7ed' : 'transparent',
                    borderLeft: isMe ? '3px solid #ea580c' : '3px solid transparent',
                  }}
                >
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#9ca3af', margin: 0 }}>{rank}</p>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                  <p style={{ flex: 1, fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#111' : '#374151', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <p style={{ fontSize: 13, fontWeight: 800, color: isMe ? '#ea580c' : '#6b7280', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{entry.score}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export const StatsTab = ({ data }: { data: LbData }) => {
  const stats = data?.stats;
  const username = data?.username;
  const snoovatars = data?.snoovatars ?? {};
  const avg = stats ? Math.round((stats.totalScore / stats.games) * 10) / 10 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
      {!username ? (
        <p style={{ marginTop: 32, fontSize: 14, color: '#9ca3af' }}>Sign in to see your stats.</p>
      ) : (
        <>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <UserAvatar name={username} url={snoovatars[username]} size={68} border="2px solid #ea580c" />
            <div style={{
              position: 'absolute', bottom: 0, right: 0,
              width: 20, height: 20, borderRadius: '50%',
              background: '#ea580c', border: '2px solid #fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10,
            }}>🎯</div>
          </div>
          <p style={{ marginTop: 10, fontSize: 17, fontWeight: 900, color: '#111' }}>u/{username}</p>
          {stats ? (
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              Best: {stats.bestScore} &nbsp;·&nbsp; Avg: {avg} &nbsp;·&nbsp; Games: {stats.games}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>No games played yet.</p>
          )}

          {stats && (
            <div style={{ marginTop: 24, width: '100%' }}>
              {/* 2-col grid */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: '#f9fafb', borderRadius: 16, padding: '14px 8px', border: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: 0 }}>Average Score</p>
                  <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.03em', color: '#111', margin: '4px 0 0' }}>{avg}</p>
                </div>
                <div style={{ background: '#f9fafb', borderRadius: 16, padding: '14px 8px', border: '1px solid #f3f4f6', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: 0 }}>Best Score</p>
                  <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.03em', color: '#ea580c', margin: '4px 0 0' }}>{stats.bestScore}</p>
                </div>
              </div>
              <div style={{ background: '#f9fafb', borderRadius: 16, padding: '14px 8px', border: '1px solid #f3f4f6', marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: 0 }}>Total Games Played</p>
                <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.03em', color: '#111', margin: '4px 0 0' }}>{stats.games}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const AnalyticsTab = ({ data }: { data: LbAnalytics }) => {
  if (!data) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-gray-400">Loading analytics…</p>
      </div>
    );
  }

  const maxCount = Math.max(...data.perDay.slice(0, 14).map(d => d.count), 1);
  const fmt = (n: number) => n.toLocaleString();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-6" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: 'Today', value: fmt(data.todayCount) },
          { label: 'Last 7 Days', value: fmt(data.weekTotal) },
          { label: 'Last 30 Days', value: fmt(data.monthTotal) },
          { label: 'All-Time Players', value: fmt(data.alltimeCount) },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center rounded-2xl bg-gray-50 p-4 dark:bg-gray-800">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
            <p className="mt-1 text-2xl font-black text-orange-600">{value}</p>
            <p className="text-[10px] text-gray-400">plays</p>
          </div>
        ))}
      </div>

      {/* Bar chart — last 14 days */}
      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Last 14 Days</p>
      <div className="flex items-end gap-1" style={{ height: 80 }}>
        {data.perDay.slice(0, 14).reverse().map(({ date, count }) => {
          const h = Math.max(2, Math.round((count / maxCount) * 72));
          const parts = date.split('-');
          const label = `${parts[1]}/${parts[2]}`;
          return (
            <div key={date} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-sm bg-orange-400 dark:bg-orange-500"
                style={{ height: h }}
                title={`${date}: ${count}`}
              />
              <p className="text-[8px] text-gray-400 leading-none">{label}</p>
            </div>
          );
        })}
      </div>

      {/* Per-day table — last 30 days */}
      <p className="mt-5 mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Daily Breakdown</p>
      <div className="space-y-1">
        {data.perDay.map(({ date, count }) => (
          <div key={date} className="flex items-center justify-between rounded-xl px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-800">
            <p className="font-mono text-xs text-gray-600 dark:text-gray-400">{date}</p>
            <p className="text-xs font-bold text-gray-900 dark:text-white">{count}</p>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Mastermind scoreboard ────────────────────────────────────────────────────

// Matches the Crack the Code splash: cold slate stone, one warm torch accent, mono type.
const MM = {
  bg: '#0e141d',
  panel: '#1a2432',
  panelHi: 'rgba(255,107,53,0.12)',
  border: 'rgba(150,175,200,0.16)',
  borderHi: 'rgba(150,175,200,0.3)',
  accent: '#ff6b35',
  accentInk: '#1a0d06',
  accentDim: '#c2703f',
  text: '#e8dcc4',
  textMid: '#d6c3a5',
  textDim: '#8b9bad',
  glow: '0 0 12px rgba(255,107,53,0.4)',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
};

const mmResultLabel = (score: number, maxGuesses: number) => score > 0 ? `${maxGuesses + 1 - score}/${maxGuesses}` : '✗';

const MMScoresTab = ({ data, isCustom }: { data: MmLbData | null; isCustom: boolean }) => {
  const snoovatars = data?.snoovatars ?? {};
  const top = data?.top ?? [];
  const username = data?.username ?? null;
  const podium = [top[1], top[0], top[2]] as (typeof top[number] | undefined)[];
  const { maxGuesses } = mmConfig(isCustom);

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: MM.accent, background: MM.panelHi, border: `1px solid ${MM.border}`, borderRadius: 999, padding: '3px 10px' }}>
          {isCustom ? 'This Puzzle' : "Today's Solvers"}
        </span>
        {!isCustom && data?.dailyCount != null && (
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MM.textDim }}>
            {data.dailyCount} plays today
          </span>
        )}
      </div>

      {username && (
        <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 10, background: MM.panel, borderRadius: 12, padding: '9px 14px', border: `1px solid ${MM.border}` }}>
          <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: MM.textDim, margin: 0, whiteSpace: 'nowrap' }}>Your Rank</p>
          <UserAvatar name={username} url={snoovatars[username]} size={26} />
          <p style={{ flex: 1, fontSize: 13, fontWeight: 900, color: MM.text, margin: 0 }}>
            {data?.userRank ? `#${data.userRank}` : '—'}
          </p>
          <p style={{ fontSize: 13, fontWeight: 800, color: MM.accent, margin: 0 }}>
            {data?.userScore != null ? mmResultLabel(data.userScore, maxGuesses) : '—'}
          </p>
        </div>
      )}

      {top.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: MM.textDim }}>No scores yet. Be the first to solve!</p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {top.length >= 1 && (
            <div style={{ margin: '16px 16px 4px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
              {podium.map((entry, podiumIdx) => {
                const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
                const isFirst = rank === 1;
                const isMe = entry?.member === username;
                return entry ? (
                  <div
                    key={entry.member}
                    style={{
                      flex: isFirst ? 1.4 : 1,
                      background: isFirst ? MM.panelHi : MM.panel,
                      border: `1.5px solid ${isFirst ? MM.accent : MM.border}`,
                      boxShadow: isFirst ? MM.glow : undefined,
                      borderRadius: 16, padding: '12px 8px 10px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      outline: isMe ? `2px solid ${MM.accent}` : undefined,
                    }}
                  >
                    <UserAvatar
                      name={entry.member}
                      url={snoovatars[entry.member]}
                      size={isFirst ? 44 : 34}
                      border={`1.5px solid ${isFirst ? MM.accent : MM.borderHi}`}
                    />
                    <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? MM.accent : MM.accentDim, margin: 0 }}>{rank}</p>
                    <p style={{ fontSize: 10, fontWeight: 700, color: MM.textMid, margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                    <span style={{
                      background: isFirst ? MM.accent : 'rgba(150,175,200,0.16)',
                      color: isFirst ? MM.accentInk : MM.textMid,
                      fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px',
                    }}>{mmResultLabel(entry.score, maxGuesses)}</span>
                  </div>
                ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1 }} />;
              })}
            </div>
          )}

          <div style={{ paddingBottom: 16 }}>
            {top.slice(3).map((entry, i) => {
              const rank = i + 4;
              const isMe = entry.member === username;
              return (
                <div
                  key={entry.member}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 16px',
                    background: isMe ? MM.panelHi : 'transparent',
                    borderLeft: `3px solid ${isMe ? MM.accent : 'transparent'}`,
                  }}
                >
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: MM.textDim, margin: 0 }}>{rank}</p>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                  <p style={{ flex: 1, fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? MM.text : MM.textMid, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <p style={{ fontSize: 13, fontWeight: 800, color: isMe ? MM.accent : MM.accentDim, margin: 0 }}>{mmResultLabel(entry.score, maxGuesses)}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const MMStatsTab = ({ data }: { data: MmLbData | null }) => {
  const stats = data?.stats;
  const username = data?.username;
  const snoovatars = data?.snoovatars ?? {};
  const winRate = stats && stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;
  const avgGuesses = stats && stats.games > 0 ? Math.round((stats.totalGuesses / stats.games) * 10) / 10 : null;
  const combinedSentinel = Math.max(MASTERMIND_CONFIG.daily.maxGuesses, MASTERMIND_CONFIG.custom.maxGuesses) + 1;
  const bestGuesses = stats && stats.bestGuesses < combinedSentinel ? stats.bestGuesses : null;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', overflowY: 'auto' }}>
      {!username ? (
        <p style={{ marginTop: 32, fontSize: 14, color: MM.textDim }}>Sign in to see your stats.</p>
      ) : (
        <>
          <UserAvatar name={username} url={snoovatars[username]} size={68} border={`2px solid ${MM.accent}`} />
          <p style={{ marginTop: 10, fontSize: 17, fontWeight: 900, color: MM.text }}>u/{username}</p>
          {stats ? (
            <p style={{ fontSize: 11, color: MM.textMid, marginTop: 2 }}>
              Best: {bestGuesses != null ? `${bestGuesses} guesses` : '—'} &nbsp;·&nbsp; Win rate: {winRate}% &nbsp;·&nbsp; Games: {stats.games}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: MM.textMid, marginTop: 2 }}>No games played yet.</p>
          )}

          {stats && (
            <div style={{ marginTop: 24, width: '100%' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: MM.panel, borderRadius: 16, padding: '14px 8px', border: `1px solid ${MM.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MM.textDim, margin: 0 }}>Avg Guesses</p>
                  <p style={{ fontSize: 28, fontWeight: 900, color: MM.text, margin: '4px 0 0' }}>{avgGuesses ?? '—'}</p>
                </div>
                <div style={{ background: MM.panel, borderRadius: 16, padding: '14px 8px', border: `1px solid ${MM.border}`, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MM.textDim, margin: 0 }}>Best Guesses</p>
                  <p style={{ fontSize: 28, fontWeight: 900, color: MM.accent, margin: '4px 0 0', textShadow: MM.glow }}>{bestGuesses ?? '—'}</p>
                </div>
              </div>
              <div style={{ background: MM.panel, borderRadius: 16, padding: '14px 8px', border: `1px solid ${MM.border}`, marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MM.textDim, margin: 0 }}>Total Games Played</p>
                <p style={{ fontSize: 28, fontWeight: 900, color: MM.text, margin: '4px 0 0' }}>{stats.games}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const MastermindScoreboard = ({
  onClose, isCustom, canSeeAnalytics,
}: { onClose: () => void; isCustom: boolean; canSeeAnalytics: boolean }) => {
  const [tab, setTab] = useState<'scores' | 'stats' | 'analytics'>('scores');
  const [data, setData] = useState<MmLbData | null>(null);
  const [analytics, setAnalytics] = useState<MmLbAnalytics | null>(null);
  const [isMod, setIsMod] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.mastermind.getScoreboard.query()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
    trpc.game.isMod.query().then(d => setIsMod(d.isMod)).catch(() => {});
  }, []);

  const showAnalyticsTab = canSeeAnalytics || isMod;

  useEffect(() => {
    if (tab === 'analytics' && !analytics) trpc.mastermind.getAnalytics.query().then(setAnalytics).catch(() => {});
  }, [tab, analytics]);

  const tabBtn = (t: 'scores' | 'stats' | 'analytics', label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        flex: 1, borderRadius: 999, padding: '6px 0',
        fontFamily: MM.mono,
        fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
        background: tab === t ? MM.accent : 'transparent',
        color: tab === t ? MM.accentInk : MM.accentDim,
        boxShadow: tab === t ? MM.glow : 'none',
        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: MM.bg, fontFamily: MM.mono }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: `1px solid ${MM.border}`, flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '0.02em', textTransform: 'uppercase', color: MM.accent, margin: 0, textShadow: MM.glow }}>Leaderboard</h2>
        <button
          onClick={onClose}
          style={{ width: 30, height: 30, borderRadius: '50%', border: `1.5px solid ${MM.border}`, background: MM.panel, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: MM.accentDim }}
        >
          ✕
        </button>
      </div>

      <div style={{ margin: '12px 16px 0', background: MM.panel, border: `1px solid ${MM.border}`, borderRadius: 999, padding: 3, display: 'flex', flexShrink: 0 }}>
        {tabBtn('scores', 'SCORES')}
        {tabBtn('stats', 'STATS')}
        {showAnalyticsTab && tabBtn('analytics', 'ANALYTICS')}
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: MM.textDim }}>Loading…</p>
        </div>
      ) : tab === 'scores' ? (
        <MMScoresTab data={data} isCustom={isCustom} />
      ) : tab === 'stats' ? (
        <MMStatsTab data={data} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', marginTop: 8 }}>
          {isCustom && analytics && (
            <div style={{ margin: '0 16px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', borderRadius: 16, background: MM.panelHi, border: `1px solid ${MM.border}`, padding: '12px' }}>
              <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: MM.accent, margin: 0 }}>This Puzzle — Total Plays</p>
              <p style={{ fontSize: 26, fontWeight: 900, color: MM.text, margin: '4px 0 0' }}>{analytics.thisPostPlays.toLocaleString()}</p>
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: '#fff', borderRadius: '16px 16px 0 0' }}>
            <AnalyticsTab data={analytics} />
          </div>
        </div>
      )}
    </div>
  );
};

export const FlagScoreboard = ({ onClose }: { onClose: () => void }) => {
  const [tab, setTab] = useState<'scores' | 'stats' | 'analytics'>('scores');
  const [data, setData] = useState<LbData>(null);
  const [analytics, setAnalytics] = useState<LbAnalytics>(null);
  const [isMod, setIsMod] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.flag.getLeaderboard.query()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
    trpc.game.isMod.query().then(d => setIsMod(d.isMod)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'analytics' && !analytics) trpc.flag.getAnalytics.query().then(setAnalytics).catch(() => {});
  }, [tab, analytics]);

  const tabBtn = (t: 'scores' | 'stats' | 'analytics', label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        flex: 1, borderRadius: 999, padding: '6px 0',
        fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' as const,
        background: tab === t ? '#fff' : 'transparent',
        color: tab === t ? '#111' : '#9ca3af',
        border: 'none', cursor: 'pointer',
        boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.1)' : 'none',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-screen flex-col bg-white dark:bg-gray-900">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: '1px solid #f3f4f6' }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', color: '#111', margin: 0 }}>Flag Leaderboard</h2>
        <button
          onClick={onClose}
          style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid #e5e7eb', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#6b7280' }}
        >
          ✕
        </button>
      </div>

      <div style={{ margin: '12px 16px 0', background: '#f3f4f6', borderRadius: 999, padding: 3, display: 'flex' }}>
        {tabBtn('scores', 'SCORES')}
        {tabBtn('stats', 'STATS')}
        {isMod && tabBtn('analytics', 'ANALYTICS')}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-gray-400">Loading…</p>
        </div>
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
