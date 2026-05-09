import './index.css';

import { requestExpandedMode } from '@devvit/web/client';

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1200): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw new Error('unreachable');
}
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';

type PostInfo = inferRouterOutputs<AppRouter>['game']['getPostInfo'];
type GlobalLeaderboardData = inferRouterOutputs<AppRouter>['game']['getGlobalLeaderboard'];
type LeaderboardData = inferRouterOutputs<AppRouter>['game']['getLeaderboard'];
type AnalyticsData = inferRouterOutputs<AppRouter>['game']['getAnalytics'];
type CustomAnalyticsData = inferRouterOutputs<AppRouter>['game']['getCustomAnalytics'];
type SplashStats = Exclude<inferRouterOutputs<AppRouter>['game']['getSplashStats'], null>;

const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#a855f7'];

const InitialAvatar = ({ name, size = 36, border }: { name: string; size?: number; border?: string }) => {
  const bg = AVATAR_COLORS[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]!;
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.4, border }}
    >
      {name[0]?.toUpperCase()}
    </div>
  );
};

const UserAvatar = ({ name, url, size = 36, border }: { name: string; url?: string | undefined; size?: number; border?: string }) => {
  if (url) {
    return (
      <img
        src={url}
        alt={name}
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size, border }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }
  return <InitialAvatar name={name} size={size} {...(border !== undefined ? { border } : {})} />;
};

const Scoreboard = ({ onClose, isCustomPost }: { onClose: () => void; isCustomPost: boolean }) => {
  const [tab, setTab] = useState<'scores' | 'stats' | 'analytics'>('scores');
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [customAnalytics, setCustomAnalytics] = useState<CustomAnalyticsData | null>(null);
  const [isMod, setIsMod] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.game.getLeaderboard.query()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
    trpc.game.isMod.query()
      .then(d => setIsMod(d.isMod))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'analytics') {
      if (isCustomPost) {
        if (!customAnalytics) trpc.game.getCustomAnalytics.query().then(setCustomAnalytics).catch(() => {});
      } else {
        if (!analytics) trpc.game.getAnalytics.query().then(setAnalytics).catch(() => {});
      }
    }
  }, [tab, analytics, customAnalytics, isCustomPost]);

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
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: '1px solid #f3f4f6' }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', color: '#111', margin: 0 }}>Leaderboard</h2>
        <button
          onClick={onClose}
          style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid #e5e7eb', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#6b7280' }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
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
      ) : isCustomPost ? (
        <CustomAnalyticsTab data={customAnalytics} />
      ) : (
        <AnalyticsTab data={analytics} />
      )}
    </div>
  );
};

const ScoresTab = ({ data }: { data: LeaderboardData | null }) => {
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
        <div className="flex-1 overflow-y-auto">
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

const StatsTab = ({ data }: { data: LeaderboardData | null }) => {
  const stats = data?.stats;
  const username = data?.username;
  const snoovatars = data?.snoovatars ?? {};
  const avg = stats ? Math.round((stats.totalScore / stats.games) * 10) / 10 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px', overflowY: 'auto' }}>
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

const AnalyticsTab = ({ data }: { data: AnalyticsData | null }) => {
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
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pt-4 pb-6">
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

const CustomAnalyticsTab = ({ data }: { data: CustomAnalyticsData | null }) => {
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
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pt-4 pb-6">
      <div className="mb-3 flex flex-col items-center rounded-2xl bg-purple-50 p-4 dark:bg-purple-900/20">
        <p className="text-[10px] font-bold uppercase tracking-widest text-purple-400">This Puzzle — Total Plays</p>
        <p className="mt-1 text-3xl font-black text-purple-600">{fmt(data.thisPostPlays)}</p>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[
          { label: 'Today (All Custom)', value: fmt(data.todayCount) },
          { label: 'Last 7 Days', value: fmt(data.weekTotal) },
          { label: 'Last 30 Days', value: fmt(data.monthTotal) },
          { label: 'All-Time Custom', value: fmt(data.alltimeCount) },
        ].map(({ label, value }) => (
          <div key={label} className="flex flex-col items-center rounded-2xl bg-gray-50 p-4 dark:bg-gray-800">
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</p>
            <p className="mt-1 text-2xl font-black text-orange-600">{value}</p>
            <p className="text-[10px] text-gray-400">plays</p>
          </div>
        ))}
      </div>

      <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">Last 14 Days (All Custom)</p>
      <div className="flex items-end gap-1" style={{ height: 80 }}>
        {data.perDay.slice(0, 14).reverse().map(({ date, count }) => {
          const h = Math.max(2, Math.round((count / maxCount) * 72));
          const parts = date.split('-');
          const label = `${parts[1]}/${parts[2]}`;
          return (
            <div key={date} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-sm bg-purple-400 dark:bg-purple-500"
                style={{ height: h }}
                title={`${date}: ${count}`}
              />
              <p className="text-[8px] text-gray-400 leading-none">{label}</p>
            </div>
          );
        })}
      </div>

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

const AVATAR_ACCENT = (name: string) =>
  AVATAR_COLORS[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]!;

const MadeByCard = ({ creator, creatorAvatar, solvedCount, isDark }: { creator: string; creatorAvatar?: string | null; solvedCount: number; isDark: boolean }) => {
  const accent = AVATAR_ACCENT(creator);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: isDark ? 'rgba(14,14,16,0.93)' : 'rgba(255,255,255,0.92)',
      border: `1.5px solid ${accent}`,
      borderRadius: 16, padding: '8px 12px 8px 10px',
      backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
      boxShadow: `0 4px 20px rgba(0,0,0,0.45), 0 0 0 3px ${accent}38`,
      maxWidth: 175,
    }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <UserAvatar name={creator} url={creatorAvatar ?? undefined} size={34} border={`2px solid ${accent}`} />
        <span style={{ position: 'absolute', top: -8, right: -7, fontSize: 11 }}>🎨</span>
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: accent, margin: 0 }}>Made by</p>
        <p style={{ fontSize: 12, fontWeight: 800, color: isDark ? '#fff' : '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>u/{creator}</p>
        <p style={{ fontSize: 10, margin: 0 }}>
          <span style={{ color: accent, fontWeight: 800 }}>{solvedCount}</span>
          <span style={{ color: '#9ca3af' }}> solved</span>
        </p>
      </div>
    </div>
  );
};

const RankCard = ({ username, userAvatar, rank, score, maxScore, isDark }: { username: string; userAvatar?: string | null; rank: number; score: number; maxScore: number; isDark: boolean }) => (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 10,
    background: isDark ? 'rgba(14,14,16,0.93)' : 'rgba(255,255,255,0.92)',
    border: '1.5px solid #F5A623',
    borderRadius: 16, padding: '8px 12px 8px 10px',
    backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
    boxShadow: '0 4px 20px rgba(0,0,0,0.45), 0 0 0 3px rgba(245,166,35,0.22)',
    maxWidth: 175,
  }}>
    <div style={{ position: 'relative', flexShrink: 0 }}>
      <UserAvatar name={username} url={userAvatar ?? undefined} size={34} border="2px solid #F5A623" />
      <span style={{ position: 'absolute', top: -8, right: -7, fontSize: 11 }}>🏆</span>
    </div>
    <div style={{ minWidth: 0 }}>
      <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#F5A623', margin: 0 }}>Rank {rank}</p>
      <p style={{ fontSize: 12, fontWeight: 800, color: isDark ? '#fff' : '#111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>u/{username}</p>
      <p style={{ fontSize: 10, margin: 0 }}>
        <span style={{ color: '#F5A623', fontWeight: 800 }}>{score}</span>
        <span style={{ color: '#9ca3af' }}>/{maxScore}</span>
      </p>
    </div>
  </div>
);

const GlobalLeaderboard = () => {
  const [data, setData] = useState<GlobalLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.game.getGlobalLeaderboard.query()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const entries = data?.entries ?? [];
  const username = data?.username ?? null;
  const snoovatars = data?.snoovatars ?? {};
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const podium = [entries[1], entries[0], entries[2]] as (typeof entries[number] | undefined)[];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#fff' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #f3f4f6' }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', color: '#111', margin: 0 }}>Global Leaderboard</h2>
        <p style={{ fontSize: 10, fontWeight: 700, color: '#9ca3af', margin: '2px 0 0', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Avg Score · 3+ games · As of {today}
        </p>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</p>
        </div>
      ) : entries.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>No players qualify yet.</p>
          <p style={{ fontSize: 11, color: '#d1d5db', textAlign: 'center' }}>Play 3+ games to appear here!</p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {/* Podium top 3 */}
          <div style={{ margin: '14px 16px 6px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            {podium.map((entry, podiumIdx) => {
              const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
              const isFirst = rank === 1;
              const isMe = entry?.member === username;
              return entry ? (
                <div key={entry.member} style={{
                  flex: isFirst ? 1.4 : 1,
                  background: isFirst ? '#fff7ed' : '#f9fafb',
                  border: isFirst ? '1.5px solid #fed7aa' : '1.5px solid #e5e7eb',
                  borderRadius: 16, padding: '12px 8px 10px',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                  outline: isMe ? '2px solid #ea580c' : undefined,
                }}>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={isFirst ? 44 : 34}
                    border={isFirst ? '1.5px solid #ea580c' : '1.5px solid #e5e7eb'} />
                  <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? '#ea580c' : '#6b7280', margin: 0 }}>{rank}</p>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#374151', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <span style={{ background: isFirst ? '#ea580c' : '#e5e7eb', color: isFirst ? '#fff' : '#6b7280', fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px' }}>
                    avg {entry.avgScore}
                  </span>
                  <span style={{ fontSize: 9, color: '#9ca3af', fontWeight: 600 }}>{entry.games} games</span>
                </div>
              ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1 }} />;
            })}
          </div>

          {/* Column headers */}
          {entries.length > 3 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 4px', borderBottom: '1px solid #f3f4f6' }}>
              <p style={{ width: 24, textAlign: 'center', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', margin: 0 }}>#</p>
              <div style={{ width: 28 }} />
              <p style={{ flex: 1, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', margin: 0 }}>Player</p>
              <p style={{ width: 32, textAlign: 'right', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', margin: 0 }}>Avg</p>
              <p style={{ width: 36, textAlign: 'right', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', margin: 0 }}>Best</p>
              <p style={{ width: 40, textAlign: 'right', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9ca3af', margin: 0 }}>Total</p>
            </div>
          )}

          {/* Rank 4+ list */}
          <div style={{ paddingBottom: 12 }}>
            {entries.slice(3).map((entry, i) => {
              const rank = i + 4;
              const isMe = entry.member === username;
              return (
                <div key={entry.member} style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '9px 16px',
                  background: isMe ? '#fff7ed' : 'transparent',
                  borderLeft: isMe ? '3px solid #ea580c' : '3px solid transparent',
                }}>
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#9ca3af', margin: 0 }}>{rank}</p>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={28} />
                  <p style={{ flex: 1, fontSize: 12, fontWeight: isMe ? 800 : 600, color: isMe ? '#111' : '#374151', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <p style={{ width: 32, textAlign: 'right', fontSize: 12, fontWeight: 800, color: isMe ? '#ea580c' : '#6b7280', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{entry.avgScore}</p>
                  <p style={{ width: 36, textAlign: 'right', fontSize: 11, fontWeight: 600, color: '#9ca3af', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{entry.bestScore}</p>
                  <p style={{ width: 40, textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#374151', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{entry.totalScore}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ borderTop: '1px solid #f3f4f6', padding: '10px 16px', textAlign: 'center' }}>
        <p style={{ fontSize: 10, color: '#9ca3af', margin: 0 }}>
          Play at{' '}
          <a href="https://www.reddit.com/r/ColorGuessr/" target="_blank" rel="noreferrer" style={{ color: '#ea580c', fontWeight: 700, textDecoration: 'none' }}>
            r/ColorGuessr
          </a>
        </p>
      </div>
    </div>
  );
};

export const Splash = () => {
  const [postInfo, setPostInfo] = useState<PostInfo | null>(null);
  const [splashStats, setSplashStats] = useState<SplashStats | null>(null);
  const [showScoreboard, setShowScoreboard] = useState(false);

  useEffect(() => {
    withRetry(() => trpc.game.getPostInfo.query())
      .then(setPostInfo)
      .catch(() => setPostInfo({ postType: 'daily', isCreator: false, configured: false, creator: null }));
    trpc.game.getSplashStats.query()
      .then(d => { if (d) setSplashStats(d); })
      .catch(() => {});
  }, []);

  if (showScoreboard) return <Scoreboard onClose={() => setShowScoreboard(false)} isCustomPost={postInfo?.postType === 'custom'} />;
  if (postInfo?.postType === 'leaderboard') return <GlobalLeaderboard />;

  const isCustom = postInfo?.postType === 'custom';
  const isSetupNeeded = !!(isCustom && postInfo?.isCreator && !postInfo?.configured);
  const isReadyCustom = !!(isCustom && postInfo?.configured);
  const isDark = false;

  return (
    <div
      className="relative flex min-h-screen flex-col items-center justify-center px-7"
      style={{ background: isDark ? '#0f0f11' : '#ffffff', gap: 15, paddingBottom: 90, opacity: postInfo ? 1 : 0, transition: 'opacity 0.15s ease' }}
    >
      {/* Scoreboard button */}
      {!isSetupNeeded && (
        <button
          style={{
            position: 'absolute', top: 14, right: 14,
            width: 38, height: 38, borderRadius: '50%',
            border: isDark ? '1.5px solid rgba(255,255,255,0.1)' : '1.5px solid #e5e7eb',
            background: isDark ? 'rgba(255,255,255,0.05)' : '#fff',
            fontSize: 17, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
          onClick={() => setShowScoreboard(true)}
          aria-label="Scoreboard"
        >
          🏆
        </button>
      )}

      {/* Logo + Title */}
      <div style={{ textAlign: 'center' }}>
        <img
          src="/icon.png"
          alt="Color Guessr"
          style={{
            width: 68, height: 68, borderRadius: 18, display: 'block', margin: '0 auto 14px',
            boxShadow: isDark ? '0 4px 28px rgba(0,0,0,0.55)' : '0 4px 18px rgba(0,0,0,0.18)',
          }}
        />
        {isReadyCustom ? (
          <>
            <h1 style={{ fontSize: 28, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', margin: 0 }}>
              {postInfo?.title ?? 'ColorGuessr'}
            </h1>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#f97316', marginTop: 4 }}>
              ColorGuessr by u/{postInfo?.creator}
            </p>
          </>
        ) : isSetupNeeded ? (
          <>
            <h1 style={{ fontSize: 34, fontWeight: 900, color: isDark ? '#fff' : '#111', letterSpacing: '-0.03em', margin: 0 }}>Color Guessr</h1>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Custom Puzzle — Setup Required</p>
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 34, fontWeight: 900, color: '#111', letterSpacing: '-0.03em', margin: 0 }}>Color Guessr</h1>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#6b7280', marginTop: 4 }}>Daily Color Puzzle</p>
            <p style={{ fontSize: 11.5, fontWeight: 500, color: '#9ca3af', marginTop: 2 }}>5 rounds per day • Max score: 100 points</p>
          </>
        )}
      </div>

      {/* Info card — daily only */}
      {!isCustom && (
        <div style={{
          width: '100%', maxWidth: 315, borderRadius: 14,
          background: '#f0f1f4', padding: '9px 6px',
          display: 'flex',
        }}>
          {[
            { icon: <span style={{ color: '#d4a800', fontWeight: 900, fontSize: 13 }}>GOLD</span>, label: 'See a color name' },
            { icon: <span style={{ fontSize: 19 }}>🎨</span>, label: 'Pick the right shade' },
            { icon: <span style={{ fontSize: 19 }}>⭐</span>, label: '20 pts per round' },
          ].map((col, i) => (
            <div key={i} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '0 4px',
              borderRight: i < 2 ? '1px solid rgba(0,0,0,0.07)' : undefined,
            }}>
              <div style={{ height: 24, display: 'flex', alignItems: 'center' }}>{col.icon}</div>
              <p style={{ fontSize: 10, fontWeight: 600, color: '#555', textAlign: 'center', lineHeight: 1.3, margin: 0 }}>{col.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div style={{ width: '100%', maxWidth: 315, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {isSetupNeeded ? (
          <button
            style={{
              height: 50, width: '100%', borderRadius: 999,
              background: '#ea580c', color: '#fff', fontWeight: 800, fontSize: 15,
              border: 'none', cursor: 'pointer',
              boxShadow: '0 4px 16px rgba(234,88,12,0.38)',
            }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'creator')}
          >
            Set Up Puzzle
          </button>
        ) : (
          <button
            style={{
              height: 50, width: '100%', borderRadius: 999,
              background: '#ea580c', color: '#fff', fontWeight: 800, fontSize: 15,
              border: 'none', cursor: 'pointer',
              boxShadow: isDark ? '0 4px 18px rgba(234,88,12,0.4)' : '0 4px 16px rgba(234,88,12,0.38)',
            }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
          >
            {isReadyCustom ? 'Play' : 'Start Game'}
          </button>
        )}
        {!isSetupNeeded && (
          <button
            style={{
              height: 40, width: '100%', borderRadius: 999,
              background: 'transparent',
              color: isDark ? 'rgba(255,255,255,0.45)' : '#6b7280',
              fontWeight: 600, fontSize: 12,
              border: isDark ? '1.5px solid rgba(255,255,255,0.12)' : '1.5px solid #e5e7eb',
              cursor: 'pointer',
            }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'creator')}
          >
            Create Custom ColorGuessr
          </button>
        )}
      </div>

      {/* Bottom stat cards */}
      {splashStats && (
        <div style={{
          position: 'absolute', bottom: 14, left: 14, right: 14,
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
          gap: 8, pointerEvents: 'none',
        }}>
          {/* Left card */}
          {splashStats.postType === 'custom' && splashStats.creator ? (
            <MadeByCard
              creator={splashStats.creator}
              creatorAvatar={splashStats.creatorAvatar}
              solvedCount={splashStats.solvedCount}
              isDark={isDark}
            />
          ) : <div />}

          {/* Right card */}
          {splashStats.userRank != null && splashStats.userScore != null && splashStats.username && (
            <RankCard
              username={splashStats.username}
              userAvatar={splashStats.userAvatar}
              rank={splashStats.userRank}
              score={splashStats.userScore}
              maxScore={100}
              isDark={isDark}
            />
          )}
        </div>
      )}
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
