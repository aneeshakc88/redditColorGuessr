import './index.css';

import { context, navigateTo, requestExpandedMode } from '@devvit/web/client';
import type { inferRouterOutputs } from '@trpc/server';
import { Mark, MARK_EXACT } from './components/FeedbackMark';

// A feedback chip exactly as it appears on the board: a count, then the mark.
// Marks never show up bare in play, so the splash shouldn't teach them bare.
const MmChip = ({ n, kind, size, font }: { n: number; kind: 'exact' | 'color'; size: number; font: number }) => (
  <span style={{
    display: 'flex', alignItems: 'center', gap: 4,
    fontSize: font, fontWeight: 800,
    // Both counts stay cream here: on the splash the numeral sits against prose,
    // and a slate one would sink into the body text. On the board it matches its mark.
    color: MARK_EXACT,
    fontVariantNumeric: 'tabular-nums',
  }}>
    {n}<Mark size={size} kind={kind} color={MARK_EXACT} />
  </span>
);

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1200): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw new Error('unreachable');
}
import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { trpc } from './trpc';
import { EquinoxScoreboard } from './equinox-scoreboard';
import { EquinoxGame } from './equinox-game';
import type { AppRouter } from '../server/trpc';
import { getDailyPalette } from '../shared/memory-core';
import { mmConfig } from '../shared/mastermind-core';
import { inkOn } from '../shared/ink';
import { PP_TOTAL_SCORE } from '../shared/palette-poet-core';
import { submitName } from './namecolor-submit';
import { NAMECOLOR_CONFIG, isHex } from '../shared/namecolor-core';
import { UserAvatar, AnalyticsTab, FlagScoreboard, MastermindScoreboard } from './leaderboard';
import { WireScoreboard } from './wire-scoreboard';
import { RewireScoreboard } from './rewire-scoreboard';
import {
  RING_TILT, RING_ROLL, CARD_STRIPS, RING_COPIES, RING_CARD_W,
  ringRadius, bendRadius, ringPlacement, cardBox, flagDataUri, type CardBox,
} from '../shared/flag-card';

type PostInfo = inferRouterOutputs<AppRouter>['game']['getPostInfo'];
type EquinoxBoard = inferRouterOutputs<AppRouter>['equinox']['getBoard'];
type GlobalLeaderboardData = inferRouterOutputs<AppRouter>['game']['getGlobalLeaderboard'];
type CreatorData = inferRouterOutputs<AppRouter>['game']['getCreatorLeaderboard'];
type MmGlobalData = inferRouterOutputs<AppRouter>['mastermind']['getGlobalScoreboard'];
type LeaderboardData = inferRouterOutputs<AppRouter>['game']['getLeaderboard'];
type AnalyticsData = inferRouterOutputs<AppRouter>['game']['getAnalytics'];
type CustomAnalyticsData = inferRouterOutputs<AppRouter>['game']['getCustomAnalytics'];
type SplashStats = Exclude<inferRouterOutputs<AppRouter>['game']['getSplashStats'], null>;
type FlagSplashData = inferRouterOutputs<AppRouter>['flag']['getSplashPlayers'] | null;

const AVATAR_COLORS = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4','#84cc16','#a855f7'];


const CG_BADGE = {
  alltime: { label: 'All-time Best Scores', color: '#60a5fa', bg: 'rgba(59,130,246,0.16)' },
  daily:   { label: "Today's Scores",       color: '#fb923c', bg: 'rgba(234,88,12,0.16)' },
  custom:  { label: 'This Puzzle Scores',   color: '#a78bfa', bg: 'rgba(139,92,246,0.16)' },
} as const;

const CGScoresTab = ({ data }: { data: LeaderboardData | null }) => {
  const snoovatars = data?.snoovatars ?? {};
  const top = data?.top ?? [];
  const lbMode = data?.lbMode ?? 'daily';
  const username = data?.username ?? null;
  const podium = [top[1], top[0], top[2]] as (typeof top[number] | undefined)[];
  const badgeConfig = CG_BADGE[lbMode];

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: badgeConfig.color, background: badgeConfig.bg, borderRadius: 999, padding: '3px 10px' }}>
          {badgeConfig.label}
        </span>
        {lbMode !== 'custom' && data?.dailyCount != null && (
          <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af' }}>
            {data.dailyCount} plays today
          </span>
        )}
      </div>

      {username && (
        <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 10, background: '#3a3a3a', borderRadius: 12, padding: '9px 14px', border: '1px solid #454545' }}>
          <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: '#9ca3af', margin: 0, whiteSpace: 'nowrap' }}>Your Rank</p>
          <UserAvatar name={username} url={snoovatars[username]} size={26} />
          <p style={{ flex: 1, fontSize: 13, fontWeight: 900, color: '#fff', margin: 0 }}>
            {data?.userRank ? `#${data.userRank}` : '—'}
          </p>
          <p style={{ fontSize: 13, fontWeight: 800, color: '#ea580c', margin: 0, fontVariantNumeric: 'tabular-nums' }}>
            {data?.userScore != null ? `${data.userScore}/100` : '—'}
          </p>
        </div>
      )}

      {top.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: '#9ca3af' }}>No scores yet. Be the first to play!</p>
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
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
                      background: isFirst ? '#3a2a1a' : '#333333',
                      border: isFirst ? '1.5px solid #ea580c' : '1.5px solid #454545',
                      borderRadius: 16, padding: '12px 8px 10px',
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                      outline: isMe ? '2px solid #ea580c' : undefined,
                    }}
                  >
                    <UserAvatar
                      name={entry.member}
                      url={snoovatars[entry.member]}
                      size={isFirst ? 44 : 34}
                      border={isFirst ? '1.5px solid #ea580c' : '1.5px solid #575757'}
                    />
                    <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? '#ea580c' : '#9ca3af', margin: 0 }}>{rank}</p>
                    <p style={{ fontSize: 10, fontWeight: 700, color: '#d1d5db', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                    <span style={{
                      background: isFirst ? '#ea580c' : '#575757',
                      color: '#fff',
                      fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px',
                    }}>{entry.score}</span>
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
                    background: isMe ? 'rgba(234,88,12,0.08)' : 'transparent',
                    borderLeft: isMe ? '3px solid #ea580c' : '3px solid transparent',
                  }}
                >
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#9ca3af', margin: 0 }}>{rank}</p>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                  <p style={{ flex: 1, fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#fff' : '#d1d5db', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <p style={{ fontSize: 13, fontWeight: 800, color: isMe ? '#ea580c' : '#9ca3af', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{entry.score}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const CGStatsTab = ({ data }: { data: LeaderboardData | null }) => {
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
              background: '#ea580c', border: '2px solid #2e2e2e',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 10,
            }}>🎯</div>
          </div>
          <p style={{ marginTop: 10, fontSize: 17, fontWeight: 900, color: '#fff' }}>u/{username}</p>
          {stats ? (
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
              Best: {stats.bestScore} &nbsp;·&nbsp; Avg: {avg} &nbsp;·&nbsp; Games: {stats.games}
            </p>
          ) : (
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>No games played yet.</p>
          )}

          {stats && (
            <div style={{ marginTop: 24, width: '100%' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div style={{ background: '#3a3a3a', borderRadius: 16, padding: '14px 8px', border: '1px solid #454545', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: 0 }}>Average Score</p>
                  <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.03em', color: '#fff', margin: '4px 0 0' }}>{avg}</p>
                </div>
                <div style={{ background: '#3a3a3a', borderRadius: 16, padding: '14px 8px', border: '1px solid #454545', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: 0 }}>Best Score</p>
                  <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.03em', color: '#ea580c', margin: '4px 0 0' }}>{stats.bestScore}</p>
                </div>
              </div>
              <div style={{ background: '#3a3a3a', borderRadius: 16, padding: '14px 8px', border: '1px solid #454545', marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: 0 }}>Total Games Played</p>
                <p style={{ fontSize: 28, fontWeight: 900, letterSpacing: '-0.03em', color: '#fff', margin: '4px 0 0' }}>{stats.games}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
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
    <div className="flex h-full flex-col overflow-hidden" style={{ background: '#2e2e2e' }}>
      {/* Header */}
      <div className="shrink-0" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: '1px solid #3a3a3a' }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff', margin: 0 }}>Leaderboard</h2>
        <button
          onClick={onClose}
          style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid #454545', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#9ca3af' }}
        >
          ✕
        </button>
      </div>

      {/* Tabs */}
      <div className="shrink-0" style={{ margin: '12px 16px 0', background: '#3a3a3a', borderRadius: 999, padding: 3, display: 'flex' }}>
        {tabBtn('scores', 'SCORES')}
        {tabBtn('stats', 'STATS')}
        {isMod && tabBtn('analytics', 'ANALYTICS')}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-gray-400">Loading…</p>
        </div>
      ) : tab === 'scores' ? (
        <CGScoresTab data={data} />
      ) : tab === 'stats' ? (
        <CGStatsTab data={data} />
      ) : (
        <div className="flex flex-1 flex-col overflow-hidden" style={{ minHeight: 0, marginTop: 12, background: '#fff', borderRadius: '16px 16px 0 0' }}>
          {isCustomPost ? <CustomAnalyticsTab data={customAnalytics} /> : <AnalyticsTab data={analytics} />}
        </div>
      )}
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 pb-6" style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
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

// ── Global Leaderboard (multi-tab: CG all-time, CG dated, Mastermind, Creators) ──

type LbRow = {
  member: string;
  avgScore?: number; games?: number; bestScore?: number; totalScore?: number;
  wins?: number; avgMoves?: number | null; bestGuesses?: number | null;
  count?: number;
};
type BoardCol = { label: string; width: number; get: (e: LbRow) => ReactNode; strong?: boolean };
type LbTab = 'cg' | 'cg-dated' | 'mm' | 'creators';
type RangeMode = 'alltime' | 'week' | 'month' | 'custom';

const num = (v: number | null | undefined, fallback = 0) => (v == null ? fallback : v);

const cmpCg = (p: 'avg' | 'games' | 'best') => (a: LbRow, b: LbRow) => {
  const prim = p === 'avg' ? num(b.avgScore) - num(a.avgScore)
    : p === 'games' ? num(b.games) - num(a.games)
    : num(b.bestScore) - num(a.bestScore);
  return prim || (num(b.games) - num(a.games)) || (num(b.avgScore) - num(a.avgScore)) || (num(b.bestScore) - num(a.bestScore));
};
const cmpMm = (p: 'games' | 'avg' | 'best') => (a: LbRow, b: LbRow) => {
  const am = (x: LbRow) => (x.avgMoves == null ? Infinity : x.avgMoves);
  const bg = (x: LbRow) => (x.bestGuesses == null ? Infinity : x.bestGuesses);
  const prim = p === 'games' ? num(b.games) - num(a.games)
    : p === 'avg' ? am(a) - am(b)
    : bg(a) - bg(b);
  return prim || (num(b.games) - num(a.games)) || (am(a) - am(b)) || (bg(a) - bg(b));
};

const isoDay = (d: Date) => d.toISOString().split('T')[0]!;
const presetRange = (mode: RangeMode): { start: string; end: string } => {
  const end = new Date();
  const start = new Date();
  if (mode === 'week') start.setDate(end.getDate() - 6);
  else if (mode === 'month') start.setDate(end.getDate() - 29);
  return { start: isoDay(start), end: isoDay(end) };
};

const Chip = ({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) => (
  <button onClick={onClick} style={{
    fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em',
    padding: '5px 11px', borderRadius: 999, cursor: 'pointer', border: 'none',
    background: active ? '#ea580c' : '#1c1c1c', color: active ? '#fff' : '#8a8a8a',
  }}>{label}</button>
);

const RangeControls = ({ mode, start, end, allowAllTime, onMode, onStart, onEnd }: {
  mode: RangeMode; start: string; end: string; allowAllTime: boolean;
  onMode: (m: RangeMode) => void; onStart: (s: string) => void; onEnd: (s: string) => void;
}) => {
  const modes: { k: RangeMode; l: string }[] = [
    ...(allowAllTime ? [{ k: 'alltime' as const, l: 'All Time' }] : []),
    { k: 'week', l: 'Week' }, { k: 'month', l: 'Month' }, { k: 'custom', l: 'Custom' },
  ];
  const inputStyle = { background: '#1c1c1c', color: '#fff', border: '1px solid #2a2a2a', borderRadius: 8, padding: '5px 8px', fontSize: 12, colorScheme: 'dark' as const };
  return (
    <div style={{ padding: '8px 16px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {modes.map(m => <Chip key={m.k} active={mode === m.k} label={m.l} onClick={() => onMode(m.k)} />)}
      </div>
      {mode === 'custom' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input type="date" value={start} max={end} onChange={e => onStart(e.target.value)} style={inputStyle} />
          <span style={{ color: '#8a8a8a', fontSize: 12 }}>→</span>
          <input type="date" value={end} min={start} max={isoDay(new Date())} onChange={e => onEnd(e.target.value)} style={inputStyle} />
        </div>
      )}
    </div>
  );
};

const PODIUM_STEP_HEIGHT: Record<1 | 2 | 3, number> = { 1: 168, 2: 138, 3: 116 };

const Board = ({ entries, username, snoovatars, cols, badge, sub, emptyMsg }: {
  entries: LbRow[]; username: string | null; snoovatars: Record<string, string>;
  cols: BoardCol[]; badge: (e: LbRow) => string; sub: (e: LbRow) => string; emptyMsg: string;
}) => {
  if (entries.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <p style={{ fontSize: 13, color: '#8a8a8a', textAlign: 'center' }}>{emptyMsg}</p>
      </div>
    );
  }
  const podium = [entries[1], entries[0], entries[2]];
  return (
    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
      <div style={{ margin: '12px 16px 6px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        {podium.map((entry, podiumIdx) => {
          const rank = (podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3) as 1 | 2 | 3;
          const isFirst = rank === 1;
          const isMe = entry?.member === username;
          return entry ? (
            <div key={entry.member} style={{
              flex: isFirst ? 1.4 : 1, minHeight: PODIUM_STEP_HEIGHT[rank],
              background: isFirst ? '#241a10' : '#161616',
              border: isFirst ? '1.5px solid #ea580c' : '1px solid #2a2a2a',
              borderRadius: 16, padding: '12px 8px 10px',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 5,
              outline: isMe ? '2px solid #ea580c' : undefined,
            }}>
              <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={isFirst ? 44 : 34}
                border={isFirst ? '1.5px solid #ea580c' : '1.5px solid #3a3a3a'} />
              <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? '#ea580c' : '#9ca3af', margin: 0 }}>{rank}</p>
              <p style={{ fontSize: 10, fontWeight: 700, color: '#d1d5db', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
              <span style={{ background: isFirst ? '#ea580c' : '#333333', color: '#fff', fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px' }}>{badge(entry)}</span>
              <span style={{ fontSize: 9, color: '#8a8a8a', fontWeight: 600 }}>{sub(entry)}</span>
            </div>
          ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1, minHeight: PODIUM_STEP_HEIGHT[rank] }} />;
        })}
      </div>

      {entries.length > 3 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px 4px', borderBottom: '1px solid #232323' }}>
          <p style={{ width: 24, textAlign: 'center', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8a8a8a', margin: 0 }}>#</p>
          <div style={{ width: 28 }} />
          <p style={{ flex: 1, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8a8a8a', margin: 0 }}>Player</p>
          {cols.map(c => (
            <p key={c.label} style={{ width: c.width, textAlign: 'right', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8a8a8a', margin: 0 }}>{c.label}</p>
          ))}
        </div>
      )}

      <div style={{ paddingBottom: 12 }}>
        {entries.slice(3).map((entry, i) => {
          const rank = i + 4;
          const isMe = entry.member === username;
          return (
            <div key={entry.member} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '9px 16px',
              background: isMe ? 'rgba(234,88,12,0.12)' : 'transparent',
              borderLeft: isMe ? '3px solid #ea580c' : '3px solid transparent',
            }}>
              <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#8a8a8a', margin: 0 }}>{rank}</p>
              <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={28} />
              <p style={{ flex: 1, fontSize: 12, fontWeight: isMe ? 800 : 600, color: isMe ? '#fff' : '#d1d5db', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
              {cols.map(c => (
                <p key={c.label} style={{ width: c.width, textAlign: 'right', fontSize: c.strong ? 12 : 11, fontWeight: c.strong ? 800 : 600, color: c.strong ? (isMe ? '#ea580c' : '#9ca3af') : '#8a8a8a', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{c.get(entry)}</p>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

const CgAllTimeTab = () => {
  const [data, setData] = useState<GlobalLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'avg' | 'games' | 'best'>('avg');
  useEffect(() => {
    trpc.game.getGlobalLeaderboard.query().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  const entries = useMemo(() => [...(data?.entries ?? [])].sort(cmpCg(sort)), [data, sort]);
  const cols: BoardCol[] = [
    { label: 'Avg', width: 34, get: e => e.avgScore, strong: sort === 'avg' },
    { label: 'Best', width: 36, get: e => e.bestScore, strong: sort === 'best' },
    { label: 'Games', width: 46, get: e => e.games, strong: sort === 'games' },
  ];
  if (loading) return <Loading />;
  return (
    <>
      <div style={{ display: 'flex', gap: 6, padding: '8px 16px', flexWrap: 'wrap' }}>
        <Chip active={sort === 'avg'} label="Avg Score" onClick={() => setSort('avg')} />
        <Chip active={sort === 'games'} label="Games" onClick={() => setSort('games')} />
        <Chip active={sort === 'best'} label="Best" onClick={() => setSort('best')} />
      </div>
      <Board entries={entries} username={data?.username ?? null} snoovatars={data?.snoovatars ?? {}}
        cols={cols} badge={e => `avg ${e.avgScore}`} sub={e => `${e.games} games`}
        emptyMsg="No players qualify yet. Play 3+ games to appear!" />
    </>
  );
};

const CgDatedTab = () => {
  const [mode, setMode] = useState<RangeMode>('week');
  const [start, setStart] = useState(presetRange('week').start);
  const [end, setEnd] = useState(presetRange('week').end);
  const [data, setData] = useState<GlobalLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'avg' | 'games' | 'best'>('avg');

  const setPreset = (m: RangeMode) => {
    setMode(m);
    if (m !== 'custom') { const r = presetRange(m); setStart(r.start); setEnd(r.end); }
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try { const d = await trpc.game.getGlobalLeaderboardRange.query({ start, end }); if (active) setData(d); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [start, end]);
  const entries = useMemo(() => [...(data?.entries ?? [])].sort(cmpCg(sort)), [data, sort]);
  const cols: BoardCol[] = [
    { label: 'Avg', width: 34, get: e => e.avgScore, strong: sort === 'avg' },
    { label: 'Best', width: 36, get: e => e.bestScore, strong: sort === 'best' },
    { label: 'Games', width: 46, get: e => e.games, strong: sort === 'games' },
  ];
  return (
    <>
      <RangeControls mode={mode} start={start} end={end} allowAllTime={false} onMode={setPreset} onStart={setStart} onEnd={setEnd} />
      <div style={{ display: 'flex', gap: 6, padding: '4px 16px 8px', flexWrap: 'wrap' }}>
        <Chip active={sort === 'avg'} label="Avg Score" onClick={() => setSort('avg')} />
        <Chip active={sort === 'games'} label="Games" onClick={() => setSort('games')} />
        <Chip active={sort === 'best'} label="Best" onClick={() => setSort('best')} />
      </div>
      {loading ? <Loading /> : (
        <Board entries={entries} username={data?.username ?? null} snoovatars={data?.snoovatars ?? {}}
          cols={cols} badge={e => `avg ${e.avgScore}`} sub={e => `${e.games} games`}
          emptyMsg="No games played in this range." />
      )}
    </>
  );
};

const MmTab = () => {
  const [mode, setMode] = useState<RangeMode>('alltime');
  const [start, setStart] = useState(presetRange('week').start);
  const [end, setEnd] = useState(presetRange('week').end);
  const [data, setData] = useState<MmGlobalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<'games' | 'avg' | 'best'>('games');

  const setPreset = (m: RangeMode) => {
    setMode(m);
    if (m === 'week' || m === 'month') { const r = presetRange(m); setStart(r.start); setEnd(r.end); }
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const d = mode === 'alltime'
          ? await trpc.mastermind.getGlobalScoreboard.query()
          : await trpc.mastermind.getGlobalScoreboardRange.query({ start, end });
        if (active) setData(d);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [mode, start, end]);
  const entries = useMemo(() => [...(data?.entries ?? [])].sort(cmpMm(sort)), [data, sort]);
  const cols: BoardCol[] = [
    { label: 'Games', width: 46, get: e => e.games, strong: sort === 'games' },
    { label: 'Avg', width: 40, get: e => e.avgMoves ?? '—', strong: sort === 'avg' },
    { label: 'Best', width: 36, get: e => e.bestGuesses ?? '—', strong: sort === 'best' },
  ];
  return (
    <>
      <RangeControls mode={mode} start={start} end={end} allowAllTime onMode={setPreset} onStart={setStart} onEnd={setEnd} />
      <div style={{ display: 'flex', gap: 6, padding: '4px 16px 8px', flexWrap: 'wrap' }}>
        <Chip active={sort === 'games'} label="Games" onClick={() => setSort('games')} />
        <Chip active={sort === 'avg'} label="Avg Moves" onClick={() => setSort('avg')} />
        {mode === 'alltime' && <Chip active={sort === 'best'} label="Best" onClick={() => setSort('best')} />}
      </div>
      {loading ? <Loading /> : (
        <Board entries={entries} username={data?.username ?? null} snoovatars={data?.snoovatars ?? {}}
          cols={cols} badge={e => `${e.games} games`} sub={e => (e.avgMoves != null ? `${e.avgMoves} avg moves` : `${e.wins ?? 0} wins`)}
          emptyMsg="No Crack the Code games in this range." />
      )}
    </>
  );
};

const CreatorsTab = () => {
  const [game, setGame] = useState<'cg' | 'mm'>('cg');
  const [mode, setMode] = useState<RangeMode>('alltime');
  const [start, setStart] = useState(presetRange('week').start);
  const [end, setEnd] = useState(presetRange('week').end);
  const [data, setData] = useState<CreatorData | null>(null);
  const [loading, setLoading] = useState(true);

  const setPreset = (m: RangeMode) => {
    setMode(m);
    if (m === 'week' || m === 'month') { const r = presetRange(m); setStart(r.start); setEnd(r.end); }
  };
  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      try {
        const d = mode === 'alltime'
          ? await trpc.game.getCreatorLeaderboard.query({ game })
          : await trpc.game.getCreatorLeaderboardRange.query({ game, start, end });
        if (active) setData(d);
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [game, mode, start, end]);
  const entries = data?.entries ?? [];
  const cols: BoardCol[] = [{ label: 'Made', width: 50, get: e => e.count, strong: true }];
  return (
    <>
      <div style={{ display: 'flex', gap: 6, padding: '8px 16px 0', flexWrap: 'wrap' }}>
        <Chip active={game === 'cg'} label="ColorGuessr" onClick={() => setGame('cg')} />
        <Chip active={game === 'mm'} label="Crack the Code" onClick={() => setGame('mm')} />
      </div>
      <RangeControls mode={mode} start={start} end={end} allowAllTime onMode={setPreset} onStart={setStart} onEnd={setEnd} />
      {loading ? <Loading /> : (
        <Board entries={entries} username={data?.username ?? null} snoovatars={data?.snoovatars ?? {}}
          cols={cols} badge={e => `${e.count} made`} sub={() => 'puzzles'}
          emptyMsg={mode === 'alltime' ? 'No custom puzzles created yet.' : 'No custom puzzles created in this range.'} />
      )}
    </>
  );
};

const Loading = () => (
  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <p style={{ fontSize: 13, color: '#8a8a8a' }}>Loading…</p>
  </div>
);

const GlobalLeaderboard = () => {
  const [tab, setTab] = useState<LbTab>('cg');
  const tabs: { k: LbTab; l: string }[] = [
    { k: 'cg', l: 'CG' }, { k: 'cg-dated', l: 'CG Dated' }, { k: 'mm', l: 'Code' }, { k: 'creators', l: 'Creators' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0a', overflowX: 'hidden' }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #232323' }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff', margin: 0 }}>Global Leaderboard</h2>
      </div>

      <div style={{ display: 'flex', gap: 4, padding: '10px 12px 4px', overflowX: 'auto' }}>
        {tabs.map(t => (
          <button key={t.k} onClick={() => setTab(t.k)} style={{
            flexShrink: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.04em',
            padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: 'none',
            background: tab === t.k ? '#ea580c' : '#161616', color: tab === t.k ? '#fff' : '#9ca3af',
          }}>{t.l}</button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {tab === 'cg' && <CgAllTimeTab />}
        {tab === 'cg-dated' && <CgDatedTab />}
        {tab === 'mm' && <MmTab />}
        {tab === 'creators' && <CreatorsTab />}
      </div>

      <div style={{ borderTop: '1px solid #232323', padding: '10px 16px', textAlign: 'center' }}>
        <p style={{ fontSize: 10, color: '#8a8a8a', margin: 0 }}>
          Play at{' '}
          <a href="https://www.reddit.com/r/ColorGuessr/" target="_blank" rel="noreferrer" style={{ color: '#ea580c', fontWeight: 700, textDecoration: 'none' }}>
            r/ColorGuessr
          </a>
        </p>
      </div>
    </div>
  );
};

// ── Palette Poet ──────────────────────────────────────────────────────────────

type PPSplashData = inferRouterOutputs<AppRouter>['palettePoet']['getSplashData'];
type PPLbData = inferRouterOutputs<AppRouter>['palettePoet']['getLeaderboard'];

const PPScoreboard = ({ onClose }: { onClose: () => void }) => {
  const [data, setData] = useState<PPLbData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'scores' | 'analytics'>('scores');
  const [analytics, setAnalytics] = useState<inferRouterOutputs<AppRouter>['palettePoet']['getAnalytics'] | null>(null);
  const [isMod, setIsMod] = useState(false);

  useEffect(() => {
    trpc.palettePoet.getLeaderboard.query().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
    trpc.game.isMod.query().then(d => setIsMod(d.isMod)).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === 'analytics' && !analytics) {
      trpc.palettePoet.getAnalytics.query().then(setAnalytics).catch(() => {});
    }
  }, [tab, analytics]);

  const entries = data?.entries ?? [];
  const username = data?.username ?? null;
  const snoovatars = data?.snoovatars ?? {};
  const podium = [entries[1], entries[0], entries[2]] as (typeof entries[number] | undefined)[];

  const tabBtn = (t: 'scores' | 'analytics', label: string) => (
    <button onClick={() => setTab(t)} style={{ flex: 1, borderRadius: 999, padding: '6px 0', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' as const, background: tab === t ? '#fff' : 'transparent', color: tab === t ? '#111' : '#9ca3af', border: 'none', cursor: 'pointer', boxShadow: tab === t ? '0 1px 4px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>{label}</button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#2e2e2e' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 12px', borderBottom: '1px solid #3a3a3a' }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', color: '#fff', margin: 0 }}>Leaderboard</h2>
        <button onClick={onClose} style={{ width: 30, height: 30, borderRadius: '50%', border: '1.5px solid #454545', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: '#9ca3af' }}>✕</button>
      </div>
      {isMod && (
        <div style={{ margin: '12px 16px 0', background: '#3a3a3a', borderRadius: 999, padding: 3, display: 'flex' }}>
          {tabBtn('scores', 'SCORES')}
          {tabBtn('analytics', 'ANALYTICS')}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden', marginTop: 12 }}>
      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</p></div>
      ) : tab === 'analytics' && analytics ? (
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain', background: '#fff', borderRadius: '16px 16px 0 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'This Puzzle', value: analytics.thisPostPlays },
              { label: 'Today (All)', value: analytics.todayCount },
              { label: 'Last 7 Days', value: analytics.weekTotal },
              { label: 'All-Time', value: analytics.alltimeCount },
            ].map(({ label, value }) => (
              <div key={label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', borderRadius: 16, background: '#f9fafb', padding: '14px 8px', border: '1px solid #f3f4f6' }}>
                <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', margin: 0 }}>{label}</p>
                <p style={{ fontSize: 26, fontWeight: 900, color: '#ea580c', margin: '4px 0 0' }}>{value}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#9ca3af', marginBottom: 8 }}>Last 14 Days</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
            {analytics.perDay.slice(0, 14).reverse().map(({ date, count }) => {
              const maxC = Math.max(...analytics.perDay.slice(0, 14).map(d => d.count), 1);
              const h = Math.max(2, Math.round((count / maxC) * 72));
              const parts = date.split('-');
              return (
                <div key={date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', height: h, borderRadius: '2px 2px 0 0', background: '#ea580c' }} />
                  <p style={{ fontSize: 8, color: '#9ca3af' }}>{parts[1]}/{parts[2]}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : entries.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: '#9ca3af' }}>No scores yet. Be the first to play!</p>
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}>
          <div style={{ margin: '14px 16px 6px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            {podium.map((entry, podiumIdx) => {
              const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
              const isFirst = rank === 1;
              const isMe = entry?.member === username;
              return entry ? (
                <div key={entry.member} style={{ flex: isFirst ? 1.4 : 1, background: isFirst ? '#3a2a1a' : '#333333', border: isFirst ? '1.5px solid #ea580c' : '1.5px solid #454545', borderRadius: 16, padding: '12px 8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, outline: isMe ? '2px solid #ea580c' : undefined }}>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={isFirst ? 44 : 34} border={isFirst ? '1.5px solid #ea580c' : '1.5px solid #575757'} />
                  <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? '#ea580c' : '#9ca3af', margin: 0 }}>{rank}</p>
                  {entry.isFounder && <span style={{ fontSize: 10 }}>⭐</span>}
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#d1d5db', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <span style={{ background: isFirst ? '#ea580c' : '#575757', color: '#fff', fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px' }}>{entry.score}</span>
                </div>
              ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1 }} />;
            })}
          </div>
          {username && data?.userRank != null && (
            <div style={{ margin: '8px 16px', display: 'flex', alignItems: 'center', gap: 10, background: '#3a3a3a', borderRadius: 12, padding: '9px 14px', border: '1px solid #454545' }}>
              <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: '#9ca3af', margin: 0, whiteSpace: 'nowrap' }}>Your Rank</p>
              <UserAvatar name={username} url={snoovatars[username]} size={26} />
              <p style={{ flex: 1, fontSize: 13, fontWeight: 900, color: '#fff', margin: 0 }}>#{data.userRank}</p>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#ea580c', margin: 0 }}>{data.userScore}/100</p>
            </div>
          )}
          <div style={{ paddingBottom: 16 }}>
            {entries.slice(3).map((entry, i) => {
              const rank = i + 4;
              const isMe = entry.member === username;
              return (
                <div key={entry.member} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: isMe ? 'rgba(234,88,12,0.08)' : 'transparent', borderLeft: isMe ? '3px solid #ea580c' : '3px solid transparent' }}>
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#9ca3af', margin: 0 }}>{rank}</p>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                  {entry.isFounder && <span style={{ fontSize: 10 }}>⭐</span>}
                  <p style={{ flex: 1, fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#fff' : '#d1d5db', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <p style={{ fontSize: 13, fontWeight: 800, color: isMe ? '#ea580c' : '#9ca3af', margin: 0 }}>{entry.score}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
      </div>
    </div>
  );
};

const hexLum = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
};

const PP_FALLBACK_COLORS = ['#E4572E', '#17BEBB', '#FFC914', '#5D4E8C', '#76B041'];
const PP_NAME_MS = 2900;

const PP_CSS = `
  @keyframes pp-col-in   { from { clip-path: inset(0 0 100% 0); } to { clip-path: inset(0 0 0 0); } }
  @keyframes pp-breathe  { 0%, 100% { flex-grow: 1; } 50% { flex-grow: 1.7; } }
  @keyframes pp-sheen    { 0% { transform: translateX(-90%) skewX(-14deg); } 55%, 100% { transform: translateX(190%) skewX(-14deg); } }
  @keyframes pp-bob      { 0%, 100% { transform: translateY(0); opacity: 0.45; } 50% { transform: translateY(-9px); opacity: 0.85; } }
  @keyframes pp-mark-in  { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  @keyframes pp-name-in  { 0% { opacity: 0; transform: translateY(9px); } 12%, 88% { opacity: 1; transform: none; } 100% { opacity: 0.25; transform: translateY(-5px); } }
  @keyframes pp-ui-in    { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes pp-play-glow{ 0%, 100% { box-shadow: 0 6px 22px rgba(234,88,12,0.45), 0 0 0 2px rgba(255,255,255,0.22); } 50% { box-shadow: 0 6px 34px rgba(234,88,12,0.8), 0 0 0 5px rgba(234,88,12,0.28); } }

  .pp-col   { flex: 1 1 0; position: relative; overflow: hidden; animation: pp-col-in 0.75s cubic-bezier(0.22,1,0.36,1) both, pp-breathe 11s ease-in-out infinite; }
  .pp-q     { position: absolute; left: 0; right: 0; top: 38%; text-align: center; font-size: 26px; font-weight: 900; animation: pp-bob 3.4s ease-in-out infinite; }
  .pp-sheen { position: absolute; top: -10%; bottom: -10%; width: 42%; background: linear-gradient(100deg, transparent, rgba(255,255,255,0.5), transparent); mix-blend-mode: overlay; animation: pp-sheen 7s ease-in-out infinite; pointer-events: none; }
  .pp-mark  { animation: pp-mark-in 0.8s 0.3s cubic-bezier(0.22,1,0.36,1) both; }
  .pp-name  { animation: pp-name-in ${PP_NAME_MS}ms ease-out both; }
  .pp-ui    { animation: pp-ui-in 0.6s 0.45s cubic-bezier(0.22,1,0.36,1) both; }
  .pp-play  { animation: pp-play-glow 1.9s ease-in-out infinite; }
`;

const PP_GLASS = {
  background: 'rgba(10,10,12,0.6)',
  backdropFilter: 'blur(16px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(16px) saturate(1.5)',
  border: '1px solid rgba(255,255,255,0.18)',
} as const;

const PalettePoetSplash = () => {
  const [data, setData] = useState<PPSplashData>(null);
  const [loading, setLoading] = useState(true);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [nameIdx, setNameIdx] = useState(0);

  const fetchData = () => {
    trpc.palettePoet.getSplashData.query()
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    fetchData();
    // Devvit iframe overlays don't fire visibilitychange — poll instead
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNameIdx(i => i + 1), PP_NAME_MS);
    return () => clearInterval(t);
  }, []);

  if (showLeaderboard) return <PPScoreboard onClose={() => setShowLeaderboard(false)} />;

  if (loading || !data) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#0d0d0f' }}>
        <p style={{ fontSize: 13, color: '#9ca3af' }}>Loading…</p>
      </div>
    );
  }

  const { title, creator, creatorAvatar, avgScore, creatorLabel, playerCount, top16, userScore, userRank, username, userAvatar, snoovatars, unlockThreshold = 4, paletteColors = [], paletteNames = [] } = data;
  const topScore = top16[0]?.score ?? null;
  const colors = paletteColors.length ? paletteColors : PP_FALLBACK_COLORS;
  const teaseName = paletteNames.length ? paletteNames[nameIdx % paletteNames.length] : null;

  const AVATAR_COLORS_INNER = ['#ef4444','#f97316','#eab308','#22c55e','#3b82f6','#8b5cf6','#ec4899','#06b6d4'];
  const initAvatar = (name: string, size: number) => {
    const bg = AVATAR_COLORS_INNER[name.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % AVATAR_COLORS_INNER.length]!;
    return <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.38, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{name[0]?.toUpperCase()}</div>;
  };
  const avatar = (name: string, url: string | null | undefined, size: number) =>
    url ? <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} onError={e=>{(e.currentTarget as HTMLImageElement).style.display='none';}} />
        : initAvatar(name, size);

  const play = (e: ReactMouseEvent) => requestExpandedMode(e.nativeEvent, 'palette-poet');

  return (
    <div style={{ position: 'relative', height: '100vh', overflow: 'hidden', background: '#0d0d0f' }}>
      <style>{PP_CSS}</style>

      {/* ── The palette IS the canvas: 5 breathing full-height columns ── */}
      <div onClick={play} style={{ position: 'absolute', inset: 0, display: 'flex', cursor: 'pointer' }}>
        {colors.map((hex, i) => (
          <div key={`${hex}-${i}`} className="pp-col" style={{ background: hex, animationDelay: `${i * 0.07}s, ${-2.2 * i}s` }}>
            <span className="pp-q" style={{ color: hexLum(hex) > 0.6 ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.75)', animationDelay: `${i * 0.45}s` }}>?</span>
          </div>
        ))}
        <div className="pp-sheen" />
        {/* grain + edge scrim so glass UI stays legible on any hue */}
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)', backgroundSize: '3px 3px', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.06) 26%, rgba(0,0,0,0.12) 52%, rgba(0,0,0,0.78) 100%)', pointerEvents: 'none' }} />
      </div>

      {/* ── Floating UI ── */}
      <div className="pp-ui" style={{ position: 'relative', zIndex: 2, height: '100%', display: 'flex', flexDirection: 'column', padding: '12px 12px 14px', boxSizing: 'border-box', pointerEvents: 'none' }}>

        {/* Creator + trophy */}
        <div style={{ display: 'flex', alignItems: 'stretch', gap: 8, pointerEvents: 'auto' }}>
          <div style={{ ...PP_GLASS, flex: 1, minWidth: 0, borderRadius: 14, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
            {avatar(creator, creatorAvatar, 30)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12.5, fontWeight: 900, color: '#fff', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>u/{creator}</p>
              <p style={{ fontSize: 9.5, color: 'rgba(255,255,255,0.62)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                created this palette{title ? ` · ${title}` : ''}
              </p>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              {avgScore != null ? (
                <>
                  <p style={{ fontSize: 16, fontWeight: 900, color: '#fb923c', margin: 0, lineHeight: 1.1 }}>{avgScore}<span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)' }}>/100</span></p>
                  <p style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.62)', margin: 0 }}>{creatorLabel}</p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 10.5, fontWeight: 800, color: 'rgba(255,255,255,0.8)', margin: 0 }}>🔒 locked</p>
                  <p style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', margin: 0 }}>needs {unlockThreshold - playerCount} more</p>
                </>
              )}
            </div>
          </div>
          <button
            onClick={() => setShowLeaderboard(true)}
            style={{ ...PP_GLASS, width: 52, borderRadius: 14, fontSize: 21, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            🏆
          </button>
        </div>

        {/* Wordmark + rotating name tease */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
          <div className="pp-mark" style={{ textAlign: 'center', mixBlendMode: 'difference' }}>
            <p style={{ fontSize: 11, fontWeight: 900, letterSpacing: '0.34em', textTransform: 'uppercase', color: '#fff', margin: 0, paddingLeft: '0.34em' }}>Palette</p>
            <p style={{ fontSize: 38, fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 0.92, color: '#fff', margin: 0 }}>POET</p>
          </div>
          <div style={{ ...PP_GLASS, borderRadius: 999, padding: '6px 14px', maxWidth: '92%', pointerEvents: 'auto' }} onClick={play}>
            {teaseName ? (
              <p key={nameIdx} className="pp-name" style={{ fontSize: 14, fontWeight: 700, fontStyle: 'italic', color: '#fff', margin: 0, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                “{teaseName}”
              </p>
            ) : (
              <p style={{ fontSize: 12, fontWeight: 700, color: '#fff', margin: 0 }}>Guess the shade behind the name</p>
            )}
          </div>
          <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.72)', margin: 0, textShadow: '0 1px 6px rgba(0,0,0,0.6)' }}>
            {colors.length} shade{colors.length === 1 ? '' : 's'} · {Math.floor(PP_TOTAL_SCORE / colors.length)} pts each · {PP_TOTAL_SCORE} max
          </p>
        </div>

        {/* Standing */}
        <div style={{ ...PP_GLASS, borderRadius: 999, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, pointerEvents: 'auto' }}>
          {userScore != null ? (
            <>
              <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.55)', margin: 0 }}>You</p>
              <p style={{ flex: 1, fontSize: 12, fontWeight: 900, color: '#fff', margin: 0 }}>
                {userRank != null ? `#${userRank} of ${playerCount}` : `${playerCount} played`}
              </p>
              <p style={{ fontSize: 12, fontWeight: 900, color: '#fb923c', margin: 0 }}>{userScore}/100</p>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                {top16.slice(0, 4).map((e, i) => (
                  <div key={e.username} style={{ marginLeft: i ? -7 : 0, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.85)', display: 'flex' }}>
                    {avatar(e.username, snoovatars[e.username], 18)}
                  </div>
                ))}
              </div>
              <p style={{ flex: 1, fontSize: 11, fontWeight: 800, color: '#fff', margin: 0 }}>
                {playerCount > 0 ? `${playerCount} ${playerCount === 1 ? 'player has' : 'players have'} played` : 'Be the first to play'}
              </p>
              {topScore != null && <p style={{ fontSize: 11, fontWeight: 900, color: '#fb923c', margin: 0 }}>top {topScore}</p>}
            </>
          )}
        </div>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 8, pointerEvents: 'auto' }}>
          <button
            onClick={e => requestExpandedMode(e.nativeEvent, 'palette-poet-creator')}
            style={{ ...PP_GLASS, flexShrink: 0, height: 48, padding: '0 16px', borderRadius: 999, color: '#fff', fontWeight: 800, fontSize: 11.5, whiteSpace: 'nowrap', cursor: 'pointer' }}
          >
            Create your own
          </button>
          <button
            className="pp-play"
            onClick={play}
            style={{ flex: 1, height: 48, borderRadius: 999, background: 'linear-gradient(180deg, #fb923c, #ea580c)', color: '#fff', fontWeight: 900, fontSize: 16, letterSpacing: '0.01em', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9 }}
          >
            {username && <UserAvatar name={username} url={userAvatar ?? undefined} size={24} border="1.5px solid rgba(255,255,255,0.55)" />}
            {userScore != null ? 'Play Again' : 'Play'}
          </button>
        </div>
      </div>
    </div>
  );
};

type RoundColor = { hex: string; name: string };

const ROUND_FALLBACK: RoundColor[] = [
  { hex: '#FF6B6B', name: 'Coral Red' },
  { hex: '#4ECDC4', name: 'Turquoise' },
  { hex: '#FFD93D', name: 'Sunglow' },
  { hex: '#A29BFE', name: 'Lavender' },
  { hex: '#55EFC4', name: 'Mint' },
];

// ── Barber Pole (Daily) ───────────────────────────────────────────────────────

const BarberPoleBackground = ({ rounds }: { rounds: RoundColor[] }) => {
  const STRIPE = 80;
  const period = STRIPE * rounds.length; // 400px for 5 colors
  // One diagonal period: (dx+dy)/√2 = period → dx=dy = period*√2/2 ≈ 283px
  const shift = Math.round(period * Math.SQRT2 / 2);
  const pad = shift + 20; // extend div so translate never shows empty edge

  const stops = rounds.map((r, i) =>
    `${r.hex} ${i * STRIPE}px ${(i + 1) * STRIPE}px`
  ).join(', ');

  return (
    <>
      <style>{`
        @keyframes barber-slide {
          from { transform: translate(0, 0); }
          to   { transform: translate(${shift}px, ${shift}px); }
        }
      `}</style>
      {/* Oversized div so translate never exposes an edge; overflow:hidden on parent clips it */}
      <div style={{
        position: 'absolute',
        top: -pad, left: -pad, right: -pad, bottom: -pad,
        background: `repeating-linear-gradient(-45deg, ${stops})`,
        animation: 'barber-slide 4s linear infinite',
        zIndex: 0, pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.38)',
        zIndex: 1, pointerEvents: 'none',
      }} />
    </>
  );
};

// ── Confetti Shower (Custom) ──────────────────────────────────────────────────

const CONFETTI_COLORS = [
  '#FF4757','#FF6B35','#FFD93D','#6BCB77','#4D96FF',
  '#C77DFF','#FF6EB4','#00D4FF','#A8FF3E','#FFB347',
  '#FF85A1','#5CE1E6',
];

// [colorIdx, left%, width, height, dur, delay, endRotDeg, endDriftvw]
type ConfettiDef = [number, number, number, number, number, number, number, number];
const CONFETTI: ConfettiDef[] = [
  [ 0,  4, 10, 16, 4.2,  0,    280,  2  ],
  [ 1, 10,  8, 12, 5.8, -1.8, -200, -2  ],
  [ 2, 16, 14,  8, 3.5, -0.7,  350,  1.5],
  [ 3, 22,  9, 14, 6.5, -2.5, -300, -1  ],
  [ 4, 28, 11, 10, 4.8, -1.2,  180,  2.5],
  [ 5, 34,  8, 15, 5.2, -0.3, -250, -1.5],
  [ 6, 40, 13,  9, 3.9, -3.1,  320,  1  ],
  [ 7, 46, 10, 13, 6.2, -1.6, -180, -2.5],
  [ 8, 52,  8, 11, 4.5, -0.9,  270,  2  ],
  [ 9, 58, 12,  8, 5.5, -2.2, -350, -1  ],
  [10, 64,  9, 14, 3.7, -1.4,  230,  1.5],
  [11, 70, 11, 11, 6.8, -0.6, -280, -2  ],
  [ 0, 76,  8, 16, 4.1, -3.5,  400,  2  ],
  [ 1, 82, 12,  9, 5.9, -1.1, -150, -1.5],
  [ 2, 88, 10, 12, 4.3, -2.8,  310,  1  ],
  [ 3, 94, 14,  8, 6.0, -0.4, -380, -2  ],
  [ 4,  7,  8, 15, 3.6, -1.9,  200,  2.5],
  [ 5, 13, 11, 10, 5.1, -2.7, -240, -1  ],
  [ 6, 19,  9, 13, 4.6, -0.8,  290,  1.5],
  [ 7, 25, 13,  8, 6.4, -3.2, -170, -2  ],
  [ 8, 31, 10, 14, 3.8, -1.5,  360,  2  ],
  [ 9, 37,  8, 11, 5.3, -2.0, -320, -1.5],
  [10, 43, 12,  9, 4.9, -0.5,  250,  1  ],
  [11, 49,  9, 15, 6.1, -1.3, -420, -2.5],
  [ 0, 55, 11, 12, 3.4, -2.9,  180,  2  ],
  [ 1, 61,  8, 10, 5.7, -1.7, -260, -1  ],
  [ 2, 67, 13,  8, 4.0, -0.2,  330,  1.5],
  [ 3, 73, 10, 13, 6.6, -2.4, -190, -2  ],
  [ 4, 79,  9, 11, 4.4, -3.0,  280,  2  ],
  [ 5, 85, 11, 16, 5.6, -1.0, -310, -1.5],
  [ 6,  2, 10, 10, 4.0, -0.6,  240,  1  ],
  [ 7, 11,  8, 14, 5.3, -2.3, -200,  2  ],
  [ 8, 20, 12,  9, 3.6, -1.4,  380, -1.5],
  [ 9, 30,  9, 12, 6.7, -3.3, -160,  2.5],
  [10, 39, 11,  8, 4.5, -0.9,  300, -2  ],
  [11, 48,  8, 15, 5.0, -2.1, -340,  1.5],
  [ 0, 57, 14, 10, 3.9, -1.2,  220, -1  ],
  [ 1, 66,  9, 13, 6.3, -2.8, -280,  2  ],
  [ 2, 75, 11, 11, 4.7, -0.4,  360, -2.5],
  [ 3, 83,  8,  9, 5.4, -1.8, -190,  1  ],
  [ 4, 91, 12, 14, 3.7, -3.1,  270,  1.5],
  [ 5,  6, 10,  8, 6.0, -0.7, -310, -1  ],
  [ 6, 44,  9, 12, 4.2, -2.5,  200,  2.5],
  [ 7, 62, 13, 10, 5.5, -1.6, -250, -2  ],
  [ 8, 96,  8, 15, 4.1, -0.3,  330,  1  ],
];

const ConfettiBackground = ({ rounds }: { rounds: RoundColor[] }) => {
  const gradient = rounds.map((r, i) => {
    const pct = i * 20;
    return `${r.hex} ${pct}% ${pct + 20}%`;
  }).join(', ');

  return (
    <>
      <style>{CONFETTI.map((_, i) => `
        @keyframes cf${i}{
          0%  { transform: translateY(-5vh) translateX(0) rotate(0deg); opacity:1; }
          100%{ transform: translateY(110vh) translateX(${CONFETTI[i]![7]}vw) rotate(${CONFETTI[i]![6]}deg); opacity:0.55; }
        }`).join('')}</style>

      {/* Blurred colour zones — extend beyond viewport so blur edge is off-screen */}
      <div style={{
        position: 'absolute', top: -50, left: -50, right: -50, bottom: -50,
        background: `linear-gradient(to right, ${gradient})`,
        filter: 'blur(10px)',
        opacity: 0.85,
        zIndex: 0, pointerEvents: 'none',
      }} />

      {/* Subtle dark veil for content readability */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'rgba(0,0,0,0.28)',
        zIndex: 1, pointerEvents: 'none',
      }} />

      {/* Confetti on top of zones */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', overflow: 'hidden' }}>
        {CONFETTI.map((p, i) => (
          <div key={i} style={{
            position: 'absolute',
            left: `${p[1]}%`, top: 0,
            width: p[2], height: p[3],
            borderRadius: 2,
            background: CONFETTI_COLORS[p[0] % CONFETTI_COLORS.length]!,
            animation: `cf${i} ${p[4]}s linear ${p[5]}s infinite`,
          }} />
        ))}
      </div>
    </>
  );
};

// ── Falling Swatches (Custom · slider mode variation) ──────────────────────────
// 5 rectangular swatches stream down continuously from the top-left and top-right.
// Toggle SLIDER_BG_VARIATION back to false to restore the confetti background.
const SLIDER_BG_VARIATION = true;

const FallingSwatchesBackground = ({ rounds }: { rounds: RoundColor[] }) => {
  const cols = rounds.length ? rounds : ROUND_FALLBACK;
  const DUR = 6.5; // seconds for one swatch to fall
  // Both streams share phase 0 so left and right drop together, straight down (no drift/rotation).
  const streams = [
    { x: 11 },  // left
    { x: 89 },  // right
  ];
  const wash = cols.map((r, i) => `${r.hex} ${i * 20}% ${i * 20 + 20}%`).join(', ');
  return (
    <>
      <style>{`
        @keyframes fsw-fall {
          0%   { transform: translateY(-18vh); opacity: 0; }
          8%   { opacity: 1; }
          90%  { opacity: 1; }
          100% { transform: translateY(114vh); opacity: 0; }
        }
      `}</style>
      {/* faint colour wash + dark veil so foreground stays readable */}
      <div style={{ position: 'absolute', inset: -40, background: `linear-gradient(160deg, ${wash})`, filter: 'blur(34px)', opacity: 0.3, zIndex: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.34)', zIndex: 1, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, overflow: 'hidden', pointerEvents: 'none' }}>
        {streams.flatMap((st, si) => cols.map((r, i) => {
          const delay = -((i / cols.length) * DUR);
          return (
            <div key={`${si}-${i}`} style={{
              position: 'absolute', left: `${st.x}%`, top: 0,
              width: 122, height: 80, borderRadius: 11, marginLeft: -61,
              background: r.hex,
              boxShadow: '0 8px 20px rgba(0,0,0,0.42), inset 0 0 0 1.5px rgba(255,255,255,0.85)',
              animation: `fsw-fall ${DUR}s linear ${delay}s infinite`,
            }} />
          );
        }))}
      </div>
    </>
  );
};

// ── Sliding Bars (Custom · slider mode, experiment) ─────────────────────────────
// Horizontal rectangles enter from the left AND right edges at the same time,
// stacked at different heights. Set SLIDE_BARS_VARIATION to false to revert to
// FallingSwatchesBackground below.
const SLIDE_BARS_VARIATION = false;

const SlideBarsBackground = ({ rounds }: { rounds: RoundColor[] }) => {
  const cols = rounds.length ? rounds : ROUND_FALLBACK;
  const BAR_H = 58;
  const DUR = 7;
  const wash = cols.map((r, i) => `${r.hex} ${i * 20}% ${i * 20 + 20}%`).join(', ');
  const rows = cols.map((r, i) => ({
    hex: r.hex,
    topPct: (i + 0.5) / cols.length * 100,
    ltr: i % 2 === 0,
    delay: -((i / cols.length) * DUR),
  }));

  return (
    <>
      <style>{`
        @keyframes bar-ltr { from { transform: translateX(-115%); } to { transform: translateX(115%); } }
        @keyframes bar-rtl { from { transform: translateX(115%); } to { transform: translateX(-115%); } }
      `}</style>
      <div style={{ position: 'absolute', inset: -40, background: `linear-gradient(160deg, ${wash})`, filter: 'blur(34px)', opacity: 0.3, zIndex: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.34)', zIndex: 1, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, zIndex: 2, overflow: 'hidden', pointerEvents: 'none' }}>
        {rows.map((row, i) => (
          <div key={i} style={{
            position: 'absolute', left: 0, top: `${row.topPct}%`,
            width: '70%', height: BAR_H, marginTop: -BAR_H / 2,
            borderRadius: 11,
            background: row.hex,
            boxShadow: '0 8px 20px rgba(0,0,0,0.42), inset 0 0 0 1.5px rgba(255,255,255,0.85)',
            animation: `${row.ltr ? 'bar-ltr' : 'bar-rtl'} ${DUR}s linear ${row.delay}s infinite`,
          }} />
        ))}
      </div>
    </>
  );
};

// ── Confetti (Custom · slider mode) ──────────────────────────────────────────
// Small color chips falling continuously top to bottom at randomized (but
// seeded-once) positions/speeds. The logo itself now lives on the rotating
// color ring, so these stay plain — just the round colors in motion.
const LOGO_CONFETTI_VARIATION = true;

const LogoConfettiBackground = ({ rounds }: { rounds: RoundColor[] }) => {
  const cols = rounds.length ? rounds : ROUND_FALLBACK;
  const pieces = useMemo(() => {
    const COUNT = 22;
    return Array.from({ length: COUNT }, (_, i) => {
      const dur = 5 + Math.random() * 4.5;
      return {
        left: Math.random() * 100,
        size: 10 + Math.random() * 8,
        dur,
        delay: -(Math.random() * dur * 3),
        rot: (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 180),
        drift: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 10),
        hex: cols[i % cols.length]!.hex,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cols.map(c => c.hex).join('|')]);

  return (
    <>
      <style>{`
        @keyframes lc-fall {
          0%   { top: -14%; opacity: 0; transform: translateX(0) rotate(0deg); }
          8%   { opacity: 1; }
          92%  { opacity: 1; }
          100% { top: 112%; opacity: 0; transform: translateX(var(--drift)) rotate(var(--rot)); }
        }
      `}</style>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {pieces.map((p, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${p.left}%`, top: '-14%',
            width: p.size, height: p.size, marginLeft: -p.size / 2,
            borderRadius: 3, background: p.hex,
            boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
            animation: `lc-fall ${p.dur}s linear ${p.delay}s infinite`,
            ['--rot' as string]: `${p.rot}deg`,
            ['--drift' as string]: `${p.drift}vw`,
          }} />
        ))}
      </div>
    </>
  );
};

// ── Fight Card (Custom · slider mode, ready-to-play) ────────────────────────────
// Poster treatment for the versus matchup: spotlight beams sweep down from the
// rafters in the puzzle's own colours, over halftone grain and a lit arena floor.
// Stage-gel a round colour: keep its hue, force it bright and saturated enough to
// actually read as light on black. Near-greys stay a warm white rather than
// inventing a hue. Also avoids handing the player the exact answer shade.
const _gelHex = (hex: string): string => {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const l = (max + min) / 2;
  if (d < 0.04) return '#FFF3E0';
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (((h * 60) % 360) + 360) % 360;

  const ns = Math.max(s, 0.8), nl = 0.56;
  const c = (1 - Math.abs(2 * nl - 1)) * ns;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = nl - c / 2;
  const [rr, gg, bb] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `#${to(rr!)}${to(gg!)}${to(bb!)}`;
};

const FIGHT_BEAMS = [
  { x: 10, w: 34, tilt: -15, sway: 5, dur: 11 },
  { x: 31, w: 26, tilt: -6, sway: 4, dur: 14.5 },
  { x: 50, w: 22, tilt: 0, sway: 3, dur: 9.5 },
  { x: 69, w: 26, tilt: 6, sway: 4, dur: 12.5 },
  { x: 90, w: 34, tilt: 15, sway: 5, dur: 16 },
];

const FightCardBackground = ({ rounds }: { rounds: RoundColor[] }) => {
  const cols = rounds.length ? rounds : ROUND_FALLBACK;
  const [dust] = useState(() => Array.from({ length: 14 }, () => {
    const dur = 16 + Math.random() * 14;
    return {
      left: Math.random() * 100,
      size: 1.5 + Math.random() * 2.5,
      dur,
      delay: -(Math.random() * dur),
      sway: (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 5),
    };
  }));

  return (
    <>
      <style>{`
        @keyframes fc-sway {
          0%, 100% { transform: rotate(calc(var(--tilt) - var(--sway))); }
          50%      { transform: rotate(calc(var(--tilt) + var(--sway))); }
        }
        @keyframes fc-dust {
          0%   { transform: translateY(0) translateX(0); opacity: 0; }
          15%  { opacity: 0.55; }
          80%  { opacity: 0.4; }
          100% { transform: translateY(96vh) translateX(var(--sway)); opacity: 0; }
        }
      `}</style>
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none' }}>
        {/* rafters spotlights — one per round colour, screen-blended so overlaps bloom */}
        <div style={{ position: 'absolute', inset: 0, mixBlendMode: 'screen' }}>
          {FIGHT_BEAMS.map((b, i) => {
            const hex = _gelHex(cols[i % cols.length]!.hex);
            return (
              <div key={i} style={{
                position: 'absolute',
                left: `${b.x}%`, top: '-6%',
                width: `${b.w}vw`, height: '132vh',
                marginLeft: `${-b.w / 2}vw`,
                transformOrigin: '50% 0%',
                animation: `fc-sway ${b.dur}s ease-in-out ${-i * 2.5}s infinite`,
                ['--tilt' as string]: `${b.tilt}deg`,
                ['--sway' as string]: `${b.sway}deg`,
              }}>
                {/* beam cone */}
                <div style={{
                  position: 'absolute', inset: 0,
                  clipPath: 'polygon(47% 0%, 53% 0%, 100% 100%, 0% 100%)',
                  background: `linear-gradient(to bottom, ${hex} 0%, ${hex}dd 22%, ${hex}88 48%, ${hex}3a 72%, transparent 94%)`,
                  filter: 'blur(14px)',
                  opacity: 0.62,
                }} />
                {/* lamp bloom at the rafters */}
                <div style={{
                  position: 'absolute', left: '50%', top: 0,
                  width: `${b.w * 0.55}vw`, height: `${b.w * 0.55}vw`,
                  transform: 'translate(-50%, -45%)',
                  borderRadius: '50%',
                  background: `radial-gradient(circle, #fff 0%, ${hex} 34%, transparent 70%)`,
                  filter: 'blur(12px)',
                  opacity: 0.65,
                }} />
              </div>
            );
          })}
        </div>

        {/* halftone print grain */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'radial-gradient(rgba(255,255,255,0.65) 0.9px, transparent 1.2px)',
          backgroundSize: '6px 6px',
          opacity: 0.07,
        }} />

        {/* lit arena floor + poster vignette */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(58% 20% at 50% 101%, rgba(255,255,255,0.22) 0%, transparent 72%),'
            + ' radial-gradient(125% 80% at 50% 34%, transparent 0%, rgba(0,0,0,0.26) 58%, rgba(0,0,0,0.8) 100%)',
        }} />

        {/* dust caught in the beams */}
        {dust.map((d, i) => (
          <div key={i} style={{
            position: 'absolute', left: `${d.left}%`, top: -8,
            width: d.size, height: d.size, borderRadius: '50%',
            background: '#fff', opacity: 0,
            animation: `fc-dust ${d.dur}s linear ${d.delay}s infinite`,
            ['--sway' as string]: `${d.sway}vw`,
          }} />
        ))}
      </div>
    </>
  );
};

// Ringside crowd huddled at the bottom-left of the fight-card splash, outside
// the poster panel. Front/bigger snoos sit lower with higher z → a peeking crowd.
const RINGSIDE_SLOTS = [
  { x: 52, y: 74, w: 88, r: 0,  z: 6, dur: 1.5 },  // front center, biggest
  { x: 2,  y: 92, w: 74, r: -8, z: 5, dur: 1.15 }, // lower left
  { x: 106,y: 88, w: 70, r: 9,  z: 5, dur: 1.75 }, // lower right
  { x: 16, y: 30, w: 72, r: -6, z: 3, dur: 1.3 },  // back left
  { x: 84, y: 22, w: 68, r: 7,  z: 3, dur: 1.6 },  // back right
  { x: 54, y: 0,  w: 64, r: 0,  z: 2, dur: 1.05 }, // top peek
];

const RingsideCrowd = ({ snoos }: { snoos: { username: string; avatar: string; you: boolean }[] }) => {
  // Pad with the generic snoo so the crowd is never sparse on a fresh post.
  const filled = RINGSIDE_SLOTS.map((slot, i) => ({
    slot,
    avatar: snoos[i]?.avatar ?? '/snoo.png',
    you: snoos[i]?.you ?? false,
    key: snoos[i]?.username ?? `ghost-${i}`,
  }));

  return (
    <>
      <style>{`
        @keyframes rs-cheer {
          0%, 100% { transform: translateY(0) rotate(var(--r)); }
          50%      { transform: translateY(-7px) rotate(var(--r)); }
        }
      `}</style>
      <div style={{ position: 'absolute', left: -10, bottom: 96, width: 200, height: 176, zIndex: 2, pointerEvents: 'none' }}>
        {filled.map(({ slot, avatar, you, key }, i) => (
          <div key={key} style={{
            position: 'absolute', left: slot.x, top: slot.y, width: slot.w,
            zIndex: you ? 20 : slot.z,
            animation: `rs-cheer ${slot.dur}s ease-in-out ${-i * 0.27}s infinite`,
            ['--r' as string]: `${slot.r}deg`,
          }}>
            <img
              src={avatar}
              alt=""
              onError={(e) => {
                const img = e.currentTarget;
                if (!img.src.endsWith('/snoo.png')) img.src = '/snoo.png';
              }}
              style={{
                width: slot.w, height: slot.w * 1.57, objectFit: 'contain', objectPosition: 'bottom',
                display: 'block',
                filter: you
                  ? 'drop-shadow(0 0 6px rgba(245,166,35,0.85)) drop-shadow(0 8px 12px rgba(0,0,0,0.45))'
                  : 'drop-shadow(0 8px 12px rgba(0,0,0,0.45))',
              }}
            />
            {you && <span style={{ position: 'absolute', top: -8, left: '50%', transform: 'translateX(-50%)', fontSize: 13 }}>⭐</span>}
          </div>
        ))}
      </div>
    </>
  );
};

const _hexRgb = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
};

const CardFanShuffle = ({ colors }: { colors: string[] }) => {
  const n = colors.length;
  const [order, setOrder] = useState<number[]>(() => colors.map((_, i) => i));
  const [ejecting, setEjecting] = useState(false);
  const [noTransIdx, setNoTransIdx] = useState(-1);
  const orderRef = useRef<number[]>(colors.map((_, i) => i));

  useEffect(() => {
    let alive = true;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    const run = async () => {
      await sleep(900);
      while (alive) {
        setEjecting(true);
        await sleep(460);
        if (!alive) return;

        const prev = orderRef.current;
        const ejectedColorIdx = prev[n - 1]!;
        const newOrder = [ejectedColorIdx, ...prev.slice(0, n - 1)];
        orderRef.current = newOrder;

        setNoTransIdx(ejectedColorIdx);
        setOrder(newOrder);
        setEjecting(false);

        requestAnimationFrame(() => requestAnimationFrame(() => {
          if (alive) setNoTransIdx(-1);
        }));

        await sleep(1350);
      }
    };

    void run();
    return () => { alive = false; };
  }, [n]);

  const ANGLES = [-52, -26, 0, 26, 52];

  return (
    <div className="cg-fan-sway" style={{ position: 'relative', width: 280, height: 200, flexShrink: 0 }}>
      <style>{`
        @keyframes cg-fan-sway {
          0%, 100% { transform: rotate(-1.5deg) translateY(0); }
          50%      { transform: rotate(1.5deg) translateY(-5px); }
        }
        @keyframes cg-play-pulse {
          0%, 100% { box-shadow: 0 4px 20px rgba(0,0,0,0.45), 0 0 0 3px rgba(245,166,35,0.4); }
          50%      { box-shadow: 0 4px 28px rgba(234,88,12,0.6), 0 0 0 5px rgba(245,166,35,0.7); }
        }
        .cg-fan-sway { animation: cg-fan-sway 6s ease-in-out infinite; transform-origin: 50% 80%; }
        .cg-play-pulse { animation: cg-play-pulse 1.8s ease-in-out infinite; }
      `}</style>
      {colors.map((hex, colorIdx) => {
        const pos = order.indexOf(colorIdx);
        const isFront = pos === n - 1;
        const isEjected = isFront && ejecting;
        const skipTrans = colorIdx === noTransIdx;
        const rgb = _hexRgb(hex);

        return (
          <div
            key={colorIdx}
            style={{
              position: 'absolute',
              width: 82,
              height: 145,
              left: '50%',
              top: '50%',
              marginLeft: -41,
              marginTop: -72,
              borderRadius: 14,
              background: `rgba(${rgb},0.28)`,
              border: `1.5px solid rgba(${rgb},0.82)`,
              boxShadow: `0 0 26px rgba(${rgb},0.55), 0 0 8px rgba(${rgb},0.38), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 22px rgba(255,255,255,0.05)`,
              backdropFilter: 'blur(3px)',
              WebkitBackdropFilter: 'blur(3px)',
              transformOrigin: '50% 210%',
              transform: isEjected ? 'rotate(92deg)' : `rotate(${ANGLES[pos]}deg)`,
              transition: skipTrans ? 'none' : `transform ${isEjected ? '0.46s cubic-bezier(0.4,0,1,1)' : '0.44s cubic-bezier(0.2,0,0.35,1)'}`,
              zIndex: isEjected ? 20 : pos,
            }}
          />
        );
      })}
    </div>
  );
};

type SnooData = { username: string; avatar: string; you: boolean };

// Slots for the huddle (x/y px within the cluster box, width, rotation, z).
// Front/bigger snoos sit lower with higher z → a peeking, overlapping crowd.
const CROWD_SLOTS = [
  { x: 60, y: 78, w: 92, r: 0,  z: 6 },  // front center, biggest
  { x: 8,  y: 96, w: 78, r: -8, z: 5 },  // lower left
  { x: 116,y: 92, w: 74, r: 9,  z: 5 },  // lower right
  { x: 22, y: 34, w: 76, r: -6, z: 3 },  // back left
  { x: 92, y: 26, w: 72, r: 7,  z: 3 },  // back right
  { x: 62, y: 4,  w: 68, r: 0,  z: 2 },  // top peek
];

const SideSnoos = ({ snoos, scale = 1 }: { snoos: SnooData[]; scale?: number }) => {
  // Jitter once so the huddle arrangement feels random each load.
  const [jitter] = useState(() => snoos.map(() => (Math.random() - 0.5) * 10));
  if (snoos.length === 0) return null;
  const list = snoos.slice(0, CROWD_SLOTS.length);

  return (
    <div style={{ position: 'absolute', left: 0, top: '46%', width: 210 * scale, height: 190 * scale, zIndex: 3, pointerEvents: 'none' }}>
      {list.map((s, i) => {
        const slot = CROWD_SLOTS[i]!;
        const w = slot.w * scale;
        return (
          <div key={s.username} className="fs-cheer" style={{
            position: 'absolute', left: (slot.x + (jitter[i] ?? 0)) * scale, top: slot.y * scale, width: w,
            zIndex: s.you ? 20 : slot.z,
            ['--y' as string]: '0px', ['--r' as string]: `${slot.r}deg`,
            animationDelay: `${i * 0.35}s`,
          }}>
            <img src={s.avatar} alt="" style={{
              width: w, height: w * 1.57, objectFit: 'contain', objectPosition: 'bottom',
              display: 'block', filter: 'drop-shadow(0 8px 12px rgba(0,0,0,0.4))',
            }} />
            {s.you && (
              <span style={{ position: 'absolute', top: -6, left: '50%', transform: 'translateX(-50%)', fontSize: 13 * scale }}>⭐</span>
            )}
          </div>
        );
      })}
    </div>
  );
};

// 3D rotating flag ring — the day's 5 flags as convex cards on a tilted, rolled cylinder.
type RingFlag = { name: string; svg: string };

const svgBg = (svg: string) => `url("${flagDataUri(svg)}")`;

// The flag image comes from --f on the card, set once per distinct flag in
// FlagRing3D's stylesheet — inlining the data URI here would repeat it 36 times.
const BentCard = ({ box }: { box: CardBox }) => {
  const stripW = box.w / CARD_STRIPS;
  const bendRad = box.bendR;
  const step = box.bend / CARD_STRIPS;
  return (
    <>
      {Array.from({ length: CARD_STRIPS }, (_, j) => {
        const a = -box.bend / 2 + (j + 0.5) * step;
        const first = j === 0, last = j === CARD_STRIPS - 1;
        return (
          <div key={j} className="fr-strip" style={{
            width: stripW + 0.7, height: box.h, marginLeft: -stripW / 2,
            transform: `rotateY(${a}deg) translateZ(${bendRad}px)`,
            backgroundColor: box.mat,
            backgroundSize: `${box.bg.w}px ${box.bg.h}px`,
            backgroundPosition: `${box.bg.x - j * stripW}px ${box.bg.y}px`,
            borderTopLeftRadius: first ? 9 : 0, borderBottomLeftRadius: first ? 9 : 0,
            borderTopRightRadius: last ? 9 : 0, borderBottomRightRadius: last ? 9 : 0,
          }} />
        );
      })}
    </>
  );
};

// `flags` is null until the round's flags arrive — the ring then spins as blank
// cards rather than showing flags that aren't today's.
const BLANK_RING: RingFlag[] = Array.from({ length: 5 }, () => ({ name: '', svg: '' }));

const FlagRing3D = ({ flags, scale = 1 }: { flags: RingFlag[] | null; scale?: number }) => {
  const cards = flags ?? BLANK_RING;
  const ring = Array.from({ length: RING_COPIES }, () => cards).flat();
  const n = ring.length;
  const radius = ringRadius(RING_CARD_W * scale, n, scale);
  // Slots sized per card, so a 4:1 flag takes a wide slot instead of losing height.
  const boxes = ring.map(f => cardBox(f.svg, scale));
  const { angles } = ringPlacement(boxes.map(b => b.w), radius + bendRadius(scale));

  return (
    <div style={{ width: 340 * scale, height: 300 * scale, perspective: 1500 * scale, perspectiveOrigin: '50% 50%' }}>
      <style>{`
        @keyframes fr-spin {
          from { transform: rotateX(${RING_TILT}deg) rotateZ(${RING_ROLL}deg) rotateY(0deg); }
          to   { transform: rotateX(${RING_TILT}deg) rotateZ(${RING_ROLL}deg) rotateY(360deg); }
        }
        .fr-ring { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; animation: fr-spin 40s linear infinite; }
        .fr-card { position: absolute; top: 50%; left: 50%; transform-style: preserve-3d; }
        .fr-strip { position: absolute; top: 0; left: 50%; transform-origin: 50% 50%;
          background-image: var(--f); background-repeat: no-repeat; box-shadow: inset 0 -2px 4px rgba(0,0,0,0.14); }
        .fr-blank .fr-strip { background-color: rgba(255,255,255,0.055); }
        ${(flags ?? []).map((f, i) => `.fr-f${i} { --f: ${svgBg(f.svg)}; }`).join('\n        ')}
      `}</style>
      <div className="fr-ring">
        {ring.map((_flag, i) => {
          const box = boxes[i]!;
          return (
            <div key={i} className={`fr-card ${flags ? `fr-f${i % cards.length}` : 'fr-blank'}`} style={{
              width: box.w, height: box.h, marginLeft: -box.w / 2, marginTop: -box.h / 2,
              transform: `rotateY(${angles[i]}deg) translateZ(${radius + box.zOffset}px)`,
            }}>
              <BentCard box={box} />
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FlagSplash = ({ initialFlags }: { initialFlags: RingFlag[] | null }) => {
  const [data, setData] = useState<FlagSplashData>(null);
  const [showBoard, setShowBoard] = useState(false);
  const [vw, setVw] = useState(() => window.innerWidth);
  const [vh, setVh] = useState(() => window.innerHeight);

  useEffect(() => {
    trpc.flag.getSplashPlayers.query().then(setData).catch(() => {});
    const onResize = () => { setVw(window.innerWidth); setVh(window.innerHeight); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const crowdScale = vw >= 768 ? 1 : vw >= 400 ? 0.8 : 0.62;
  // Ring scales down when the viewport is short so the title/matchup/CTA always fit.
  // CTA sits on top (higher z), so the ring can grow to slightly overlap it.
  const ringScale = Math.max(0.7, Math.min(1.18, (vh - 250) / 300));

  const players = data?.players ?? [];
  const username = data?.username ?? null;
  let snoos: SnooData[] = players.map(p => ({ username: p.username, avatar: p.avatar, you: p.username === username }));
  if (data?.viewerAvatar && username && !snoos.some(s => s.you)) {
    snoos.unshift({ username, avatar: data.viewerAvatar, you: true });
  }
  snoos = snoos.slice(0, 6);
  // The round's flags arrive with getPostInfo, so they render on the first paint.
  const ringFlags: RingFlag[] | null = initialFlags?.length ? initialFlags : data?.flags?.length ? data.flags : null;

  if (showBoard) return <FlagScoreboard onClose={() => setShowBoard(false)} />;

  return (
    <div style={{
      position: 'relative', height: '100vh', width: '100%', overflow: 'hidden',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start',
      padding: '18px 24px 0',
      background: 'radial-gradient(120% 90% at 50% 0%, #14203a 0%, #0a0e18 60%, #05070d 100%)',
    }}>
      {/* Trophy — leaderboard */}
      <button
        onClick={() => setShowBoard(true)}
        style={{ position: 'absolute', top: 12, right: 12, zIndex: 20, width: 44, height: 44, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        aria-label="Leaderboard"
      >
        🏆
      </button>
      <style>{`
        @keyframes fs-float { 0%,100%{ transform: translateY(0) rotate(-3deg); } 50%{ transform: translateY(-10px) rotate(3deg); } }
        @keyframes fs-cheer { 0%,100%{ transform: translateY(var(--y)) rotate(var(--r)); } 50%{ transform: translateY(calc(var(--y) - 7px)) rotate(var(--r)); } }
        @keyframes fs-play { 0%,100%{ transform: scale(1); box-shadow: 0 12px 30px rgba(37,99,235,0.55), 0 0 0 6px rgba(91,155,255,0.16), inset 0 1px 0 rgba(255,255,255,0.5); }
          50%{ transform: scale(1.045); box-shadow: 0 16px 40px rgba(37,99,235,0.7), 0 0 0 10px rgba(91,155,255,0.26), inset 0 1px 0 rgba(255,255,255,0.5); } }
        @keyframes fs-rise { from{ opacity:0; transform: translateY(14px); } to{ opacity:1; transform: translateY(0); } }
        @keyframes fs-flagwave { 0%{ transform: rotateY(-7deg) skewY(-1.6deg); } 50%{ transform: rotateY(7deg) skewY(1.6deg); } 100%{ transform: rotateY(-7deg) skewY(-1.6deg); } }
        @keyframes fs-swapin { from{ opacity:0; transform: translateY(10px) scale(0.94) rotateY(-40deg); } to{ opacity:1; transform: none; } }
        @keyframes fs-ringswap { from{ opacity:0; transform: scale(0.96); } to{ opacity:1; transform: none; } }
        @keyframes fs-sheen { 0%{ transform: translateX(-140%) skewX(-18deg); } 55%,100%{ transform: translateX(360%) skewX(-18deg); } }
        @keyframes fs-patch { 0%,100%{ box-shadow: inset 0 0 0 0 rgba(255,255,255,0); } 50%{ box-shadow: inset 0 0 0 3px rgba(255,255,255,0.92); } }
        @keyframes fs-tag { 0%,100%{ transform: translateY(-52%) scale(1); } 50%{ transform: translateY(-66%) scale(1.14); } }
        @keyframes fs-shine { to { background-position: 220% center; } }
        @keyframes fs-aurora { 0%,100%{ transform: translate(0,0) scale(1); } 33%{ transform: translate(6%,-5%) scale(1.28); } 66%{ transform: translate(-5%,4%) scale(1.12); } }
        .fs-badge { animation: fs-float var(--dur) ease-in-out infinite; animation-delay: var(--dl); }
        .fs-play { animation: fs-play 2.2s ease-in-out infinite; }
        .fs-cheer { animation: fs-cheer 2.4s ease-in-out infinite; }
        .fs-rise { animation: fs-rise 0.5s ease-out both; }
        .fs-flagwave { animation: fs-flagwave 2.6s ease-in-out infinite; }
        .fs-swapin { animation: fs-swapin 0.55s cubic-bezier(0.22,1,0.36,1) both; }
        .fs-ringswap { animation: fs-ringswap 0.45s ease-out both; }
        .fs-sheen { animation: fs-sheen 3.4s ease-in-out infinite; }
        .fs-patch { animation: fs-patch 1.5s ease-in-out infinite; }
        .fs-tag { animation: fs-tag 1.7s ease-in-out infinite; }
        .fs-title { background: linear-gradient(90deg,#5b9bff,#a78bfa,#f472b6,#fbbf24,#5b9bff); background-size: 220% auto; -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; animation: fs-shine 6s linear infinite; }
        .fs-aurora { position: absolute; border-radius: 50%; filter: blur(60px); pointer-events: none; animation: fs-aurora var(--adur) ease-in-out infinite; animation-delay: var(--adl); }
      `}</style>

      {/* animated aurora background */}
      <div className="fs-aurora" style={{ top: '-14%', left: '-16%', width: 360, height: 360, background: 'radial-gradient(circle, rgba(37,99,235,0.5), transparent 68%)', ['--adur' as string]: '14s', ['--adl' as string]: '0s' }} />
      <div className="fs-aurora" style={{ bottom: '-12%', right: '-18%', width: 380, height: 380, background: 'radial-gradient(circle, rgba(239,65,53,0.42), transparent 68%)', ['--adur' as string]: '17s', ['--adl' as string]: '2s' }} />
      <div className="fs-aurora" style={{ top: '30%', right: '8%', width: 260, height: 260, background: 'radial-gradient(circle, rgba(167,139,250,0.4), transparent 68%)', ['--adur' as string]: '20s', ['--adl' as string]: '1s' }} />
      <div className="fs-aurora" style={{ bottom: '18%', left: '6%', width: 240, height: 240, background: 'radial-gradient(circle, rgba(34,197,94,0.32), transparent 68%)', ['--adur' as string]: '16s', ['--adl' as string]: '3s' }} />

      {/* left huddle — cheering crowd against the left border */}
      <SideSnoos snoos={snoos} scale={crowdScale} />

      {/* center: title + versus matchup + CTA + hero flag ring */}
      <div style={{ position: 'relative', zIndex: 5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <h1 className="fs-title" style={{ margin: 0, fontSize: 'clamp(28px, 7.9vw, 34px)', fontWeight: 900, letterSpacing: '-0.035em', lineHeight: 1 }}>
            Flag ColorGuessr
          </h1>
          <p style={{ margin: '9px 0 0', fontSize: 13.5, fontWeight: 600, color: '#9fb0c4' }}>
            One color is wrong — spot it &amp; fix it
          </p>
        </div>

        {/* Versus matchup: you vs the top scorer (challenger) */}
        <VsMatchup
          you={{ name: username ?? 'You', avatar: data?.viewerAvatar ?? undefined }}
          rival={
            data?.topPlayer
              ? { name: data.topPlayer.username, avatar: data.topPlayer.avatar ?? undefined, score: data.topPlayer.score }
              : null
          }
        />

        {/* CTA — sits above the ring, may slightly overlap it */}
        <button
          className="fs-play"
          style={{
            position: 'relative', zIndex: 10,
            height: 58, padding: '0 44px', borderRadius: 999, cursor: 'pointer',
            background: 'linear-gradient(180deg,#5b9bff 0%,#2f6df0 55%,#2258d8 100%)',
            color: '#ffffff', fontWeight: 900, fontSize: 20, letterSpacing: '-0.01em',
            border: '2px solid rgba(255,255,255,0.55)',
            boxShadow: '0 12px 30px rgba(37,99,235,0.55), 0 0 0 6px rgba(91,155,255,0.16), inset 0 1px 0 rgba(255,255,255,0.5)',
            textShadow: '0 1px 6px rgba(0,0,0,0.28)',
          }}
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'flag')}
        >
          Accept Challenge
        </button>

        <div className="fs-rise" style={{ marginTop: -14, zIndex: 1 }}>
          {/* Keying on the swap remounts the ring so the real flags fade in. */}
          <div key={ringFlags ? 'live' : 'blank'} className={ringFlags ? 'fs-ringswap' : undefined}>
            <FlagRing3D flags={ringFlags} scale={ringScale} />
          </div>
        </div>
      </div>
    </div>
  );
};

type Fighter = { name: string; avatar?: string | undefined };

const VsFighter = ({ fighter, color }: { fighter: Fighter; color: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: 100, minWidth: 0 }}>
    <div style={{ position: 'relative', width: 76, height: 76 }}>
      <UserAvatar name={fighter.name} url={fighter.avatar} size={76} border={`3px solid ${color}`} />
      {/* rotating track — bulb rides within the ring's thickness */}
      <div className="vs-orbit" style={{ position: 'absolute', inset: 1.5, pointerEvents: 'none' }}>
        <span style={{
          position: 'absolute', top: 0, left: '50%', marginLeft: -1.5, marginTop: -1.5,
          width: 3, height: 3, borderRadius: '50%',
          background: '#fff',
          boxShadow: `0 0 3px 1.5px ${color}, 0 0 6px 2.5px ${color}bb, 0 0 1px 1px #fff`,
        }} />
      </div>
    </div>
    <span style={{ fontSize: 12, fontWeight: 800, color, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {fighter.name}
    </span>
  </div>
);

const VsMatchup = ({ you, rival }: { you: Fighter; rival: (Fighter & { score?: number | undefined }) | null }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
    <style>{`
      @keyframes vs-jab-left { 0%,100%{ transform: scaleX(-1) translateX(0) rotate(0deg); } 50%{ transform: scaleX(-1) translateX(-6px) rotate(-12deg); } }
      @keyframes vs-jab-right { 0%,100%{ transform: translateX(0) rotate(0deg); } 50%{ transform: translateX(6px) rotate(12deg); } }
      .vs-glove-l { display: inline-block; animation: vs-jab-left 0.9s ease-in-out infinite; }
      .vs-glove-r { display: inline-block; animation: vs-jab-right 0.9s ease-in-out infinite; animation-delay: 0.45s; }
      @keyframes vs-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      .vs-orbit { animation: vs-orbit 4s linear infinite; }
    `}</style>
    <VsFighter fighter={you} color="#5b9bff" />
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, margin: '0 -4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 22 }}>
        <span className="vs-glove-l">🥊</span>
        <span style={{ fontSize: 20, fontWeight: 900, color: '#fff', textShadow: '0 2px 6px rgba(0,0,0,0.5)' }}>VS</span>
        <span className="vs-glove-r">🥊</span>
      </div>
      {rival?.score != null && (
        <span style={{ fontSize: 10, fontWeight: 700, color: '#c8d6ea' }}>{rival.score}/100</span>
      )}
    </div>
    <VsFighter
      fighter={rival ?? { name: 'Be first!' }}
      color="#fbbf24"
    />
  </div>
);

// ── The Run (Color Memory) splash ──────────────────────────────────────────────
type MemorySplashData = inferRouterOutputs<AppRouter>['memory']['getSplash'];
type MemoryLbData = inferRouterOutputs<AppRouter>['memory']['getLeaderboard'];

const MEM_ACCENT = '#818cf8';

// Ambient mini-stacks (like the center motif) that tumble down the far left
// and far right edges in a continuous, seamless loop. Each column streams N
// stacks sharing one duration with evenly-spaced delays so one enters as
// another exits — no gaps.
const FALL_STACKS = (() => {
  const PER_COL = 5;
  const build = (baseX: number, dur: number, jitter: number[], rots: number[], barsArr: number[]) =>
    Array.from({ length: PER_COL }, (_, k) => ({
      x: baseX + (jitter[k] ?? 0),
      scale: 0.62 + (k % 3) * 0.05,
      dur,
      delay: -(dur / PER_COL) * k, // negative → animation mid-flight on load, seamless loop
      rot: rots[k] ?? 0,
      bars: barsArr[k] ?? 5,
      cOff: (k * 2) % 8,
    }));
  return [
    ...build(3, 10, [0, 4, 1, 3, 2], [-12, -6, -14, -8, -10], [5, 6, 4, 5, 6]),
    ...build(92, 11, [0, 3, 1, 4, 2], [12, 6, 14, 8, 10], [6, 5, 6, 4, 5]),
  ];
})();

// Full day leaderboard overlay — 2·1·3 podium, rest listed below.
const MemoryDayLeaderboard = ({ onClose }: { onClose: () => void }) => {
  const [data, setData] = useState<MemoryLbData | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => { trpc.memory.getLeaderboard.query().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); }, []);

  const top = data?.top ?? [];
  const username = data?.username ?? null;
  const snoovatars = data?.snoovatars ?? {};
  const podium = [top[1], top[0], top[2]] as (typeof top[number] | undefined)[];
  const podiumColor = ['#c0c0c0', '#f5c518', '#cd7f32']; // silver, gold, bronze (2·1·3 order)

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', flexDirection: 'column', background: 'radial-gradient(120% 90% at 50% -10%, #241f4d 0%, #14122a 45%, #0b0a16 100%)', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 10px', flexShrink: 0 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>Today's Deepest Runs</h2>
          {data && <p style={{ fontSize: 11, color: '#71717a', margin: '2px 0 0' }}>{data.dailyCount ?? top.length} {(data.dailyCount ?? top.length) === 1 ? 'player' : 'players'} today</p>}
        </div>
        <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.14)', background: 'transparent', cursor: 'pointer', color: '#a1a1aa', fontSize: 15 }}>✕</button>
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#71717a' }}>Loading…</p></div>
      ) : top.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#71717a' }}>No runs yet. Be the first!</p></div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '0 12px 20px' }}>
          {/* Podium 2·1·3 */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, padding: '14px 6px 10px' }}>
            {podium.map((entry, i) => {
              const rank = i === 0 ? 2 : i === 1 ? 1 : 3;
              const isFirst = rank === 1;
              const isMe = entry?.member === username;
              const col = podiumColor[i]!;
              return entry ? (
                <div key={entry.member} style={{ flex: isFirst ? 1.3 : 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, background: isMe ? 'rgba(129,140,248,0.16)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isMe ? MEM_ACCENT : 'rgba(255,255,255,0.08)'}`, borderRadius: 16, padding: isFirst ? '14px 8px 12px' : '10px 8px', marginTop: isFirst ? 0 : 14 }}>
                  <div style={{ fontSize: isFirst ? 22 : 18 }}>{rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉'}</div>
                  <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={isFirst ? 46 : 36} border={`2px solid ${col}`} />
                  <p style={{ fontSize: 11, fontWeight: 700, color: '#d4d4d8', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  {entry.reached != null && <p style={{ fontSize: 10, fontWeight: 600, color: entry.cleared ? '#34d399' : '#71717a', margin: 0 }}>Stack {entry.reached} {entry.cleared ? '✓' : '✗'}</p>}
                  <span style={{ background: col, color: '#0b0a16', fontSize: 13, fontWeight: 900, borderRadius: 8, padding: '2px 10px', fontVariantNumeric: 'tabular-nums' }}>{entry.score}</span>
                </div>
              ) : <div key={i} style={{ flex: isFirst ? 1.3 : 1 }} />;
            })}
          </div>

          {/* Rank 4+ */}
          {top.slice(3).map((entry, i) => {
            const rank = i + 4;
            const isMe = entry.member === username;
            return (
              <div key={entry.member} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 12px', margin: '4px 0', borderRadius: 12, background: isMe ? 'rgba(129,140,248,0.16)' : 'rgba(255,255,255,0.04)', border: `1px solid ${isMe ? MEM_ACCENT : 'rgba(255,255,255,0.08)'}` }}>
                <div style={{ width: 24, textAlign: 'center', fontSize: 13, fontWeight: 800, color: '#a1a1aa' }}>{rank}</div>
                <UserAvatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#fff' : '#d4d4d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  {entry.reached != null && <p style={{ fontSize: 10, fontWeight: 600, color: entry.cleared ? '#34d399' : '#71717a', margin: '1px 0 0' }}>Stack {entry.reached} {entry.cleared ? '✓' : '✗'}</p>}
                </div>
                <p style={{ fontSize: 14, fontWeight: 800, color: isMe ? MEM_ACCENT : '#e4e4e7', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{entry.score}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const MemorySplash = () => {
  const [data, setData] = useState<MemorySplashData | null>(null);
  const [showLb, setShowLb] = useState(false);
  useEffect(() => { trpc.memory.getSplash.query().then(setData).catch(() => {}); }, []);

  // Today's palette is deterministic (seeded by date only), so compute it
  // locally instead of waiting on getSplash — avoids a color flash once the
  // network response lands with the (identical) server-computed palette.
  const todayPalette = useMemo(() => getDailyPalette(new Date().toISOString().split('T')[0]!).map(c => c.hex), []);
  const palette = data?.palette ?? todayPalette;
  const grad = 'linear-gradient(135deg,#6366f1,#a855f7)';
  const bars = palette.slice(0, 6);

  return (
    <div style={{ position: 'relative', display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, padding: '0 24px', overflow: 'hidden', background: 'radial-gradient(120% 90% at 50% -10%, #241f4d 0%, #14122a 45%, #0b0a16 100%)' }}>
      <style>{`
        @keyframes tr-float { 0%,100%{ transform: translateY(0) rotate(-6deg);} 50%{ transform: translateY(-10px) rotate(-6deg);} }
        @keyframes tr-bar { 0%,100%{ transform: scaleY(1);} 50%{ transform: scaleY(1.14);} }
        @keyframes tr-glow { 0%,100%{ box-shadow:0 8px 40px rgba(99,102,241,0.35);} 50%{ box-shadow:0 8px 60px rgba(168,85,247,0.55);} }
        @keyframes tr-trophy { 0%,100%{ transform: scale(1) rotate(0);} 50%{ transform: scale(1.1) rotate(-6deg);} }
        @keyframes tr-shine { 0%{ background-position: 200% 0;} 100%{ background-position: -200% 0;} }
        @keyframes tr-fall { 0%{ transform: translateY(-180px);} 100%{ transform: translateY(112vh);} }
      `}</style>

      {/* Ambient mini-stacks tumbling from top-left / top-right (behind content) */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
        {FALL_STACKS.map((s, i) => (
          <div key={i} style={{ position: 'absolute', top: 0, left: `${s.x}%`, animation: `tr-fall ${s.dur}s linear ${s.delay}s infinite` }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 * s.scale, width: 60 * s.scale, opacity: 0.62, transform: `rotate(${s.rot}deg)` }}>
              {Array.from({ length: s.bars }).map((_, j) => (
                <div key={j} style={{ height: 11 * s.scale, borderRadius: 5 * s.scale, background: palette[(s.cOff + j) % palette.length], boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {data && data.playerCount > 0 && (
        <button
          onClick={() => setShowLb(true)}
          aria-label="Leaderboard"
          style={{ position: 'absolute', top: 14, right: 52, zIndex: 2, width: 42, height: 42, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', cursor: 'pointer', fontSize: 21, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'tr-trophy 2.6s ease-in-out infinite' }}
        >🏆</button>
      )}

      {showLb && <MemoryDayLeaderboard onClose={() => setShowLb(false)} />}

      {/* Animated stack motif */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 5, width: 92, animation: 'tr-float 4s ease-in-out infinite' }}>
        {bars.map((c, i) => (
          <div key={i} style={{ height: 15, borderRadius: 6, background: c, transformOrigin: 'center', animation: `tr-bar 2.2s ease-in-out ${i * 0.16}s infinite`, boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }} />
        ))}
      </div>

      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
        <p style={{ fontSize: 40, fontWeight: 900, margin: 0, letterSpacing: '-0.04em', lineHeight: 1, background: 'linear-gradient(110deg,#6366f1 20%,#c4b5fd 40%,#a855f7 60%,#6366f1 80%)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', animation: 'tr-shine 4.5s linear infinite' }}>THE RUN</p>
        <p style={{ fontSize: 13, color: '#a1a1aa', marginTop: 8, fontWeight: 500, letterSpacing: '0.02em' }}>Memorize · rebuild · go deeper</p>
      </div>

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
        <button
          style={{ height: 54, width: '100%', borderRadius: 999, background: grad, color: '#fff', fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer', animation: 'tr-glow 3s ease-in-out infinite' }}
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'memory')}
        >
          {data?.alreadyPlayed && data.best ? `Play Again · best Stack ${data.best.reachedStack}` : 'Start the Run'}
        </button>
        {data && data.playerCount > 0 && (
          <p style={{ fontSize: 12, color: '#71717a', textAlign: 'center', margin: 0 }}>{data.playerCount} {data.playerCount === 1 ? 'player' : 'players'} ran today · one wrong tile ends it</p>
        )}
      </div>
    </div>
  );
};

// ── Colorwire ────────────────────────────────────────────────────────────────
type WireSplashData = inferRouterOutputs<AppRouter>['wire']['getSplash'];

const WIRE_BG = 'radial-gradient(120% 90% at 50% -10%, #12314d 0%, #0c1b2c 45%, #070d16 100%)';
const wireTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const WireSplash = () => {
  const [data, setData] = useState<WireSplashData | null>(null);
  const [showLb, setShowLb] = useState(false);
  useEffect(() => { trpc.wire.getSplash.query().then(setData).catch(() => {}); }, []);

  const w = data?.demoW ?? 9;
  const h = data?.demoH ?? 9;
  const dots = data?.demoDots ?? [];
  const colors = data?.colors ?? [];
  const solution = data?.demoSolution ?? [];
  const grad = 'linear-gradient(135deg,#0ea5e9,#22d3ee)';
  // One loop wires the whole (decorative, not the real) board up, holds it, then clears and starts over.
  const cycle = Math.max(7, solution.length * 0.5 + 4);

  return (
    <div style={{ position: 'relative', display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 24px', overflow: 'hidden', background: WIRE_BG }}>
      <style>{`
        @keyframes cw-float { 0%,100%{ transform: translateY(0) rotate(-3deg);} 50%{ transform: translateY(-9px) rotate(-3deg);} }
        @keyframes cw-dot { 0%,100%{ opacity:0.75; } 50%{ opacity:1; } }
        @keyframes cw-wire { 0%{ stroke-dashoffset: 1; } 14%{ stroke-dashoffset: 0; } 86%{ stroke-dashoffset: 0; opacity: 0.9; } 96%{ stroke-dashoffset: 0; opacity: 0; } 100%{ stroke-dashoffset: 1; opacity: 0; } }
        @keyframes cw-shine { 0%{ background-position: 200% 0;} 100%{ background-position: -200% 0;} }
        @keyframes cw-glow { 0%,100%{ box-shadow:0 8px 40px rgba(14,165,233,0.32);} 50%{ box-shadow:0 8px 60px rgba(34,211,238,0.5);} }
        @keyframes cw-trophy { 0%,100%{ transform: scale(1) rotate(0);} 50%{ transform: scale(1.1) rotate(-6deg);} }
      `}</style>

      {/* Always available — a board with no solvers yet still has a board to show. */}
      <button onClick={() => setShowLb(true)} aria-label="Leaderboard"
        style={{ position: 'absolute', top: 14, right: 52, zIndex: 2, width: 42, height: 42, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', cursor: 'pointer', fontSize: 21, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'cw-trophy 2.6s ease-in-out infinite' }}
      >🏆</button>
      {showLb && <WireScoreboard onClose={() => setShowLb(false)} overlay />}

      {/* Board preview — the real dots of today's board, with two demo wires drawing themselves */}
      <div style={{ width: 'min(58vw, 200px)', aspectRatio: '1', animation: 'cw-float 4.5s ease-in-out infinite' }}>
        <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: '100%', borderRadius: 12, background: '#0d1626', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 10px 34px rgba(0,0,0,0.5)' }}>
          {Array.from({ length: w * h }, (_, i) => (
            <rect key={i} x={i % w} y={Math.floor(i / w)} width={1} height={1} fill="#131f33" stroke="#1b2a42" strokeWidth={0.03} />
          ))}
          {solution.map((path, i) => path.length > 1 && (
            <polyline
              key={i}
              points={path.map(c => `${(c % w) + 0.5},${Math.floor(c / w) + 0.5}`).join(' ')}
              fill="none" stroke={colors[i] ?? '#888'} strokeWidth={0.42} strokeLinecap="round" strokeLinejoin="round"
              pathLength={1} strokeDasharray={1} strokeDashoffset={1} opacity={0.9}
              style={{ animation: `cw-wire ${cycle}s linear ${i * 0.34}s infinite` }}
            />
          ))}
          {dots.map((d, i) => (
            <circle key={i} cx={(d.cell % w) + 0.5} cy={Math.floor(d.cell / w) + 0.5} r={0.3} fill={colors[d.color] ?? '#888'}
              style={{ animation: `cw-dot 2.6s ease-in-out ${(i % 7) * 0.18}s infinite` }} />
          ))}
        </svg>
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 38, fontWeight: 900, margin: 0, letterSpacing: '-0.04em', lineHeight: 1, background: 'linear-gradient(110deg,#0ea5e9 20%,#a5f3fc 40%,#22d3ee 60%,#0ea5e9 80%)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', animation: 'cw-shine 4.5s linear infinite' }}>COLORWIRE</p>
        <p style={{ fontSize: 13, color: '#a1a1aa', marginTop: 8, fontWeight: 500 }}>
          {data?.isCustom ? (data.creator ? `${data.title ? `${data.title} · ` : ''}by u/${data.creator}` : 'Custom board') : 'Connect every pair · fill every cell'}
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <button
          style={{ height: 54, width: '100%', borderRadius: 999, background: grad, color: '#04212f', fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer', animation: 'cw-glow 3s ease-in-out infinite' }}
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'wire')}
        >
          {data?.alreadyPlayed && data.best ? `Play Again · best ${wireTime(data.best.timeSec)}` : 'Start wiring'}
        </button>
        <button
          style={{ height: 42, width: '100%', borderRadius: 999, background: 'rgba(255,255,255,0.07)', color: '#e4e4e7', fontWeight: 700, fontSize: 13, border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'wire-creator')}
        >
          Build your own board
        </button>
        {data && data.playerCount > 0 && (
          <p style={{ fontSize: 12, color: '#71717a', textAlign: 'center', margin: 0 }}>
            {data.playerCount} {data.playerCount === 1 ? 'solver' : 'solvers'} · {data.pairCount} pairs on a {data.w}×{data.h} grid
          </p>
        )}
      </div>
    </div>
  );
};

// ── Rewire ───────────────────────────────────────────────────────────────────
type RewireSplashData = inferRouterOutputs<AppRouter>['rewire']['getSplash'];

const REWIRE_BG = 'radial-gradient(120% 90% at 50% -10%, #12314d 0%, #0c1b2c 45%, #070d16 100%)';
const rewireTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const RewireSplash = () => {
  const [data, setData] = useState<RewireSplashData | null>(null);
  const [showLb, setShowLb] = useState(false);
  useEffect(() => { trpc.rewire.getSplash.query().then(setData).catch(() => {}); }, []);

  const grad = 'linear-gradient(135deg,#0ea5e9,#22d3ee)';

  return (
    <div style={{ position: 'relative', display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: '0 24px', overflow: 'hidden', background: REWIRE_BG }}>
      <style>{`
        @keyframes rw-float { 0%,100%{ transform: translateY(0) rotate(-3deg);} 50%{ transform: translateY(-9px) rotate(-3deg);} }
        @keyframes rw-shine { 0%{ background-position: 200% 0;} 100%{ background-position: -200% 0;} }
        @keyframes rw-glow { 0%,100%{ box-shadow:0 8px 40px rgba(14,165,233,0.32);} 50%{ box-shadow:0 8px 60px rgba(34,211,238,0.5);} }
        @keyframes rw-trophy { 0%,100%{ transform: scale(1) rotate(0);} 50%{ transform: scale(1.1) rotate(-6deg);} }
      `}</style>

      <button onClick={() => setShowLb(true)} aria-label="Leaderboard"
        style={{ position: 'absolute', top: 14, right: 52, zIndex: 2, width: 42, height: 42, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', cursor: 'pointer', fontSize: 21, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'rw-trophy 2.6s ease-in-out infinite' }}
      >🏆</button>
      {showLb && <RewireScoreboard onClose={() => setShowLb(false)} overlay />}

      <div style={{ width: 'min(58vw, 200px)', aspectRatio: '1', animation: 'rw-float 4.5s ease-in-out infinite', borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.09)', boxShadow: '0 10px 34px rgba(0,0,0,0.5)', background: '#0d1626' }}>
        {data?.imageUrl && <img src={data.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
      </div>

      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 38, fontWeight: 900, margin: 0, letterSpacing: '-0.04em', lineHeight: 1, background: 'linear-gradient(110deg,#0ea5e9 20%,#a5f3fc 40%,#22d3ee 60%,#0ea5e9 80%)', backgroundSize: '200% 100%', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', animation: 'rw-shine 4.5s linear infinite' }}>REWIRE</p>
        <p style={{ fontSize: 13, color: '#a1a1aa', marginTop: 8, fontWeight: 500 }}>
          {data?.creator ? `${data.title ? `${data.title} · ` : ''}by u/${data.creator}` : 'Rebuild the photo · connect every pair'}
        </p>
      </div>

      <div style={{ width: '100%', maxWidth: 300, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'center' }}>
        <button
          style={{ height: 54, width: '100%', borderRadius: 999, background: grad, color: '#04212f', fontWeight: 800, fontSize: 16, border: 'none', cursor: 'pointer', animation: 'rw-glow 3s ease-in-out infinite' }}
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'rewire')}
        >
          {data?.alreadyPlayed && data.best ? `Play Again · best ${rewireTime(data.best.l1TimeSec + data.best.l2TimeSec)}` : 'Start rewiring'}
        </button>
        {data && data.playerCount > 0 && (
          <p style={{ fontSize: 12, color: '#71717a', textAlign: 'center', margin: 0 }}>
            {data.playerCount} {data.playerCount === 1 ? 'solver' : 'solvers'} · {data.pairCount} pairs on a {data.w}×{data.h} grid
          </p>
        )}
      </div>
    </div>
  );
};

// ── Equinox ─────────────────────────────────────────────────────────────────────
// The daily board is played in the feed card itself. Expanding only ever led to
// the same screen, so the trip is gone: the card is the game.
const EQ_BG = '#08080a';

const EquinoxSplash = ({ initial }: { initial: EquinoxBoard | null }) => {
  const [showLb, setShowLb] = useState(false);
  return (
    <div style={{ position: 'relative', height: '100dvh', overflow: 'hidden', background: EQ_BG }}>
      <EquinoxGame compact initial={initial} onLeaderboard={() => setShowLb(true)} />
      {showLb && <EquinoxScoreboard onClose={() => setShowLb(false)} overlay />}
    </div>
  );
};

// ── Name This Color ──────────────────────────────────────────────────────────
type NcSplashData = inferRouterOutputs<AppRouter>['namecolor']['getSplash'];

// A pinboard: the color is a paint chip in the middle, everyone else's names are
// notes pinned around it, and naming happens right here in the feed card — tap
// the pill, the caret lands in the card, publish. Expanding is for browsing the
// full board, never a step on the way to answering.
//
// The board is kept neutral grey on purpose. This is a game about judging one
// color, and a warm or tinted surround (like the corkboard this borrows its
// shape from) would shift how that color reads.
const NC_HEX_KEY = (postId: string) => `namecolor:hex:${postId}`;

// How often the pinned board re-reads itself. Fast enough that coming back from
// upvoting a comment feels immediate, slow enough to stay a cheap Redis read.
const NC_SPLASH_POLL_MS = 5000;

// The board is a warm cork pinboard in a wooden frame — the metaphor the notes
// already lived in. The color itself never touches that warmth: it sits inside
// a wide white mat, the way a gallery isolates a swatch from its surround, so
// judging the color stays fair on a tinted board.
const NC_WOOD = '#8b5e3c';
const NC_CORK = '#cdad83';
const NC_PAPER = '#fdf8ec';
const NC_MAT = '#fffdf7';
const NC_PAPER_INK = '#241f18';
const NC_BOARD_INK = '#4a3624';
const NC_HAND = "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', ui-rounded, cursive";

// The color can't be known before getSplash answers, and painting a guess means
// the card visibly changes color under the reader. So it's remembered per post
// and repainted instantly on every later view; only a first-ever view waits, on
// the neutral mat rather than on a wrong color.
const rememberedHex = (): string | null => {
  try { return localStorage.getItem(NC_HEX_KEY(context.postId)); } catch { return null; }
};

// Posts carry their color in postData, so the first paint is already the real
// one — no request, no repaint, and right on a first-ever view too. Posts made
// before this shipped have no postData, and fall back to the remembered hex.
const postDataHex = (): string | null => {
  const hex = (context.postData as { hex?: unknown } | undefined)?.hex;
  return typeof hex === 'string' && isHex(hex) ? hex : null;
};
const rememberHex = (hex: string): void => {
  try { localStorage.setItem(NC_HEX_KEY(context.postId), hex); } catch { /* private mode */ }
};

type NcNoteData = { id: string; name: string; author: string; votes: number; url: string; mine: boolean };

// Tapping a name hands off to Reddit's comment UI, the only place a vote can be
// cast. Recounting at the moment of the tap would be pointless — the vote has
// not happened yet — and worse, it would spend the server's one-a-minute recount
// budget on the pre-vote number and delay the real one. So the tap only records
// that a vote is likely; the poll below is what asks for the recount, and it
// keeps asking, because Devvit gives no event for the user coming back.
// Bounded, because there is no event for the user coming back: the recount is
// requested for a while after the tap and then stops. Five minutes because that
// is how long going to vote actually takes — open the comment, read the thread,
// upvote, come back — and a two-minute window expired while people were still
// reading, so they returned to a board that had not moved. The server still only
// performs one recount a minute, so the window costs a handful of them at most,
// and a card left open all day stops asking.
const NC_VOTE_WINDOW_MS = 5 * 60_000;
let ncVotedAwayAt = 0;
const ncOpenComment = (url: string): void => {
  ncVotedAwayAt = Date.now();
  navigateTo(url);
};

// Placement is scattered but never random: everything a note's position depends
// on is derived from the note's own id, so the same note is pinned in the same
// spot, at the same tilt, on every reload and on every viewer's screen.
const ncHash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

const ncRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// Slots ring the chip: four heights down each gutter, plus a note above and
// below it when the chip leaves room. Lower rows are anchored to the bottom of
// the board rather than a top percentage, so a note can never hang past it into
// the controls.
type NcSlotSpec = { edge: 'top' | 'bottom'; pct: number; side: 'left' | 'right' | 'center' };
type NcSlot = { style: CSSProperties; rot: number };

// A short card can't hold four rows of notes down each gutter, and a narrow one
// can't hold a wide note beside the chip — either way the notes end up stacked
// on each other or over the color. Both are answered by measuring the board and
// dropping rows / narrowing the paper instead of overlapping.
const NC_ROW_PITCH = 88;
const NC_BOARD_PAD = 36;

const ncGutterSlots = (rows: number): NcSlotSpec[] => {
  const heights: { edge: 'top' | 'bottom'; pct: number }[] =
    rows >= 4 ? [{ edge: 'top', pct: 1 }, { edge: 'top', pct: 27 }, { edge: 'bottom', pct: 27 }, { edge: 'bottom', pct: 1 }]
      : rows === 3 ? [{ edge: 'top', pct: 1 }, { edge: 'top', pct: 34 }, { edge: 'bottom', pct: 1 }]
        : rows === 2 ? [{ edge: 'top', pct: 1 }, { edge: 'bottom', pct: 1 }]
          : [{ edge: 'top', pct: 1 }];
  return heights.flatMap(h => ([{ ...h, side: 'left' as const }, { ...h, side: 'right' as const }]));
};

// Per-note sway timing is derived from the note's id rather than random(), so
// a re-render (new data, same notes) doesn't restart or resync the animation.
const ncSwaySeed = (id: string) => id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);

// A centre-column note is only safe when the chip leaves at least a note's
// height clear above and below it.
const NC_CHIP_MAX_H = 268;
const NC_CENTER_MIN_SLACK = 84;

// Board height isn't measurable before the first paint, and re-laying the notes
// out after one would visibly move them. The card's own height is known though,
// and the board is everything left after the padding and the controls.
const NC_CONTROLS_H = 112;

const ncCenterFits = (): boolean => {
  const board = (typeof window === 'undefined' ? 0 : window.innerHeight) - NC_CONTROLS_H;
  return (board - Math.min(board, NC_CHIP_MAX_H)) / 2 >= NC_CENTER_MIN_SLACK;
};

// The chip is min(56%, 232px) of the board, so the gutter beside it is what's
// left over — the note gets that, never more.
const ncBoardMetrics = (): { rows: number; noteW: number } => {
  const W = typeof window === 'undefined' ? 360 : window.innerWidth;
  const H = typeof window === 'undefined' ? 640 : window.innerHeight;
  const boardW = Math.max(0, W - NC_BOARD_PAD);
  const boardH = Math.max(0, H - NC_CONTROLS_H);
  const gutter = (boardW - Math.min(boardW * 0.56, 232)) / 2;
  return {
    rows: Math.max(1, Math.min(4, Math.floor(boardH / NC_ROW_PITCH))),
    noteW: Math.round(Math.max(52, Math.min(104, gutter - 6))),
  };
};

export const ncSlotSpecs = (centerOk: boolean, rows: number): NcSlotSpec[] => {
  const specs = ncGutterSlots(rows);
  if (centerOk) {
    specs.push({ edge: 'top', pct: 0, side: 'center' }, { edge: 'bottom', pct: 0, side: 'center' });
  }
  return specs;
};

const ncSlotStyle = (spec: NcSlotSpec, rnd: () => number): NcSlot => {
  const j = (n: number) => rnd() * n * 2 - n;
  if (spec.side === 'center') {
    return { style: { [spec.edge]: `${Math.max(0, spec.pct + j(2))}%`, left: `${38 + j(4)}%` }, rot: Math.round(j(7)) };
  }
  return { style: { [spec.edge]: `${Math.max(0, spec.pct + j(3))}%`, [spec.side]: `${rnd() * 2}%` }, rot: Math.round(j(8)) };
};

// Two different orders, on purpose. WHICH notes get pinned is decided by votes,
// because a short card has fewer slots than notes and the one thing it must
// never drop is the name in the lead — it used to drop by hash, so on a
// landscape phone the top name could be the one missing. WHERE each survivor
// lands is then decided by its id hash, so a note that gains or loses votes
// doesn't drag every other note to a new pin hole. A collision probes to the
// next free slot.
export const ncPlace = (notes: NcNoteData[], specs: NcSlotSpec[]): Map<string, NcSlot> => {
  const out = new Map<string, NcSlot>();
  if (specs.length === 0) return out;
  const order = notes.slice(0, specs.length)
    .sort((a, b) => (ncHash(a.id) - ncHash(b.id)) || (a.id < b.id ? -1 : 1));
  const taken = new Set<number>();
  for (const n of order) {
    if (taken.size >= specs.length) break;
    const h = ncHash(n.id);
    let idx = h % specs.length;
    while (taken.has(idx)) idx = (idx + 1) % specs.length;
    taken.add(idx);
    out.set(n.id, ncSlotStyle(specs[idx]!, ncRng(h ^ 0x9e3779b9)));
  }
  return out;
};

const NcNote =({ note, slot, accent, avatar, width }: {
  note: NcNoteData; slot: NcSlot; accent: string; avatar?: string | undefined; width: number;
}) => {
  const seed = ncSwaySeed(note.id);
  const pinColor = note.mine ? accent : '#c2352f';
  return (
  <button
    onClick={() => ncOpenComment(note.url)}
    title={`${note.name} — u/${note.author} · tap to open and upvote`}
    className="nc-note"
    style={{
      position: 'absolute', ...slot.style,
      width, padding: '12px 8px 16px',
      background: `linear-gradient(160deg, ${NC_PAPER} 0%, #f4ecda 100%)`,
      color: NC_PAPER_INK,
      border: 'none', borderRadius: 2, cursor: 'pointer', textAlign: 'center',
      '--nc-rot': `${slot.rot}deg`,
      animationDuration: `${4 + (seed % 4)}s`,
      animationDelay: `${-(seed % 5)}s`,
      boxShadow: '0 5px 12px rgba(72,42,14,0.34), 0 1px 2px rgba(72,42,14,0.28)',
    } as CSSProperties}
  >
    {/* Pinned through the paper: a small glossy head, its own color for the
        author's own notes so ownership reads without a border. */}
    <span aria-hidden style={{
      position: 'absolute', top: -5, left: '50%', transform: 'translateX(-50%)',
      width: 10, height: 10, borderRadius: '50%',
      background: `radial-gradient(circle at 34% 30%, rgba(255,255,255,0.95), ${pinColor} 55%, rgba(0,0,0,0.4) 100%)`,
      boxShadow: '0 2px 3px rgba(72,42,14,0.5)',
    }} />
    {/* Name only. The splash reads whatever the last sweep banked, so a count
        here would be an hour stale next to the comment's own live score — and a
        visibly wrong number is worse than no number. Exact votes live one tap
        away, in the expanded board and the Hall of Fame, where a sweep runs. */}
    <span style={{
      display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
      fontFamily: NC_HAND, fontSize: 13, fontWeight: 700, lineHeight: 1.2, wordBreak: 'break-word',
    }}>
      {note.name}
    </span>
    {/* The paper is taped to the board and the author is tagged under it, the
        way a pinned card carries a signature. */}
    <span style={{
      position: 'absolute', bottom: -9, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 3, maxWidth: '112%',
      background: '#fff', borderRadius: 999, padding: '1px 5px 1px 1px',
      boxShadow: '0 2px 6px rgba(72,42,14,0.35)',
    }}>
      <UserAvatar name={note.author} url={avatar} size={13} />
      <span style={{ fontSize: 7, fontWeight: 800, color: '#3f3f46', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {note.mine ? 'you' : `u/${note.author}`}
      </span>
    </span>
  </button>
  );
};

// Cream, bevelled, wood-edged — the secondary controls are cut from the same
// paper as the notes so nothing on the board reads as a web form.
const ncSoftBtn: CSSProperties = {
  background: 'linear-gradient(180deg, #fffaf0 0%, #f6e8cd 100%)',
  border: '2px solid #b98953',
  color: NC_BOARD_INK,
  boxShadow: '0 3px 0 rgba(120,80,42,0.32), 0 6px 14px rgba(72,42,14,0.22), inset 0 1px 0 rgba(255,255,255,0.9)',
};

const NameColorSplash = () => {
  const [data, setData] = useState<NcSplashData | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [cachedHex] = useState(() => postDataHex() ?? rememberedHex());
  const inputRef = useRef<HTMLInputElement>(null);
  const [metrics] = useState(ncBoardMetrics);
  const [specs] = useState(() => ncSlotSpecs(ncCenterFits(), metrics.rows));

  const load = () => {
    trpc.namecolor.getSplash.query()
      .then(d => { setData(d); rememberHex(d.hex); })
      .catch(() => {});
  };
  useEffect(load, []);

  // Opening a comment or the full board puts a Devvit overlay on top of this
  // webview, and those do not fire visibilitychange — the same thing
  // PalettePoetSplash ran into. So the board polls instead: getSplash is a Redis
  // read, and the Reddit-side recount it displays is separately floored at one a
  // minute per post, however many people are watching.
  useEffect(() => {
    const tick = async () => {
      // Only a viewer who has actually gone off to vote pays for a recount, and
      // the server floors that at one Reddit read a minute per post no matter
      // how many of them there are. Everyone else just re-reads Redis.
      if (Date.now() - ncVotedAwayAt < NC_VOTE_WINDOW_MS) await trpc.namecolor.refresh.mutate().catch(() => {});
      load();
    };
    const t = setInterval(() => void tick(), NC_SPLASH_POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const sync = () => document.body.classList.toggle('nc-paused', document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => { document.body.classList.remove('nc-paused'); document.removeEventListener('visibilitychange', sync); };
  }, []);

  // The shared splash shell paints itself near-black for the other games; the
  // pinboard would otherwise show that as a dark rim on overscroll.
  useEffect(() => {
    const prev = document.documentElement.style.background;
    document.documentElement.style.background = NC_WOOD;
    document.body.style.background = NC_WOOD;
    return () => { document.documentElement.style.background = prev; document.body.style.background = prev; };
  }, []);

  const hex = data?.hex ?? cachedHex ?? '#e4d7c0';
  const ink = inkOn(hex);
  const mine = data?.mine ?? [];
  const top = useMemo(() => data?.top ?? [], [data]);
  const placed = useMemo(() => ncPlace(top, specs), [top, specs]);
  const mineOnly = mine.filter(m => !top.some(t => t.id === m.id));

  const publish = async () => {
    const raw = draft.trim();
    if (busy || !raw) return;
    setBusy(true);
    const out = await submitName(raw);
    setBusy(false);
    if (out.kind === 'ok') {
      setDraft('');
      setEditing(false);
      setNote(`“${out.name}” is in — upvotes decide the rest.`);
      load();
      return;
    }
    setNote(out.message);
    inputRef.current?.focus();
  };

  const chipLabel = data?.isCustom && data.creator ? `by u/${data.creator}` : 'Name this color';

  return (
    <div style={{
      display: 'flex', height: '100vh', padding: 5, boxSizing: 'border-box',
      background: `linear-gradient(150deg, #a9744a 0%, ${NC_WOOD} 45%, #6f472b 100%)`,
    }}>
      <div style={{
        position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
        padding: '12px 14px 10px', gap: 8, borderRadius: 12, overflow: 'hidden',
        color: NC_BOARD_INK,
        // Cork, lit from the top-left: light sweep, peg holes, fleck grain, then
        // the board itself, with a vignette pulling the edges down.
        background: [
          'radial-gradient(120% 85% at 8% -12%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 58%)',
          'radial-gradient(135% 115% at 50% 45%, rgba(90,56,24,0) 42%, rgba(90,56,24,0.30) 100%)',
          'radial-gradient(circle at center, rgba(107,73,38,0.16) 1.4px, transparent 1.6px) 0 0/19px 19px',
          'radial-gradient(circle at center, rgba(255,246,228,0.35) 0.7px, transparent 0.9px) 6px 9px/13px 13px',
          'radial-gradient(circle at center, rgba(120,80,40,0.10) 0.9px, transparent 1.1px) 3px 4px/7px 7px',
          `linear-gradient(160deg, #e0c49b 0%, ${NC_CORK} 55%, #b8946a 100%)`,
        ].join(', '),
        boxShadow: 'inset 0 0 0 1px rgba(93,60,30,0.35), inset 0 2px 6px rgba(255,255,255,0.28), inset 0 -10px 22px rgba(90,56,24,0.22)',
      }}>
      <style>{`
        @keyframes nc-pulse { 0%,100%{ transform: scale(1); } 50%{ transform: scale(1.03); } }
        .nc-input::placeholder { color: ${NC_PAPER_INK}; opacity: 0.32; }
        @keyframes nc-sway {
          0%, 100% { transform: rotate(calc(var(--nc-rot) - 0.6deg)); }
          50% { transform: rotate(calc(var(--nc-rot) + 0.6deg)); }
        }
        .nc-note { animation: nc-sway ease-in-out infinite; transform: rotate(var(--nc-rot)); }
        body.nc-paused .nc-note { animation-play-state: paused; }
        @media (prefers-reduced-motion: reduce) {
          .nc-note { animation: none; }
        }
      `}</style>

      {/* The board: matted paint chip in the middle, everyone's notes pinned around it */}
      <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {!editing && top.map(t => {
          const slot = placed.get(t.id);
          return slot ? <NcNote key={t.id} note={t} slot={slot} accent={hex} avatar={data?.snoovatars[t.author]} width={metrics.noteW} /> : null;
        })}

        <div style={{
          position: 'relative',
          width: 'min(56%, 232px)', height: '100%', maxHeight: NC_CHIP_MAX_H, display: 'flex', flexDirection: 'column',
          transform: 'rotate(-1.1deg)', borderRadius: 3, padding: '9px 9px 0',
          background: NC_MAT,
          boxShadow: '0 16px 30px rgba(72,42,14,0.42), 0 2px 6px rgba(72,42,14,0.32)',
        }}>
          {/* Pushpins through the mat, one per top corner */}
          {[18, 82].map(x => (
            <span key={x} aria-hidden style={{
              position: 'absolute', top: -6, left: `${x}%`, transform: 'translateX(-50%)',
              width: 13, height: 13, borderRadius: '50%',
              background: 'radial-gradient(circle at 33% 28%, rgba(255,255,255,0.95), #c2352f 52%, rgba(0,0,0,0.45) 100%)',
              boxShadow: '0 3px 5px rgba(72,42,14,0.5)',
            }} />
          ))}
          <div style={{
            position: 'relative', flex: 1, background: hex, transition: 'background 240ms ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.12)',
          }}>
            {/* The color has no name yet, and the chip says so. Kept to a faint
                wash of the chip's own ink so it reads as a watermark and doesn't
                shift how the color itself looks. */}
            <span aria-hidden style={{
              fontFamily: NC_HAND, fontSize: 'clamp(52px, 17vw, 112px)', fontWeight: 900,
              lineHeight: 1, color: ink, opacity: 0.2, userSelect: 'none',
            }}>
              ?
            </span>
          </div>
          {/* Placard: the hex sits on the mat, never on the color itself */}
          <div style={{ color: NC_PAPER_INK, padding: '7px 4px 9px', textAlign: 'center' }}>
            <p style={{ margin: 0, fontSize: 7.5, fontWeight: 900, letterSpacing: '0.15em', textTransform: 'uppercase', opacity: 0.55 }}>{chipLabel}</p>
            <p style={{ margin: '1px 0 0', fontSize: 17, fontWeight: 900, letterSpacing: '-0.02em' }}>{data?.hex ?? cachedHex ?? '·····'}</p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ flexShrink: 0, width: '100%', maxWidth: 320, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {note && <p style={{ margin: 0, fontSize: 11, fontWeight: 800, textAlign: 'center', color: '#8f3f12' }}>{note}</p>}

        {!editing && mineOnly.slice(0, 2).map(m => (
          <button key={m.id} onClick={() => ncOpenComment(m.url)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, width: '100%', padding: '5px 12px', borderRadius: 999, cursor: 'pointer', background: 'rgba(255,251,240,0.72)', border: '1px solid rgba(120,80,42,0.35)', color: NC_BOARD_INK }}>
            {/* No count here either — and least of all here. A player knows
                their own score, so a stale one is the one they'd catch. */}
            <span style={{ fontSize: 11, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>You said “{m.name}”</span>
            <span style={{ fontSize: 10, fontWeight: 800, flexShrink: 0, opacity: 0.65 }}>See votes ›</span>
          </button>
        ))}

        {editing ? (
          <form onSubmit={e => { e.preventDefault(); void publish(); }} style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {/* A blank note, in the same paper as the ones on the board */}
            <input
              ref={inputRef}
              className="nc-input"
              value={draft}
              onChange={e => { setDraft(e.target.value); setNote(null); }}
              placeholder="Type a name…"
              maxLength={NAMECOLOR_CONFIG.maxNameLen * 2}
              autoFocus
              autoCapitalize="words"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="send"
              style={{
                width: '100%', height: 50, borderRadius: 3, outline: 'none', textAlign: 'center',
                background: NC_MAT, border: 'none', color: NC_PAPER_INK,
                fontFamily: NC_HAND, fontSize: 20, fontWeight: 700, caretColor: NC_PAPER_INK,
                boxShadow: '0 8px 18px rgba(72,42,14,0.4), inset 0 0 0 1px rgba(120,80,42,0.25)',
              }}
            />
            <div style={{ display: 'flex', gap: 7 }}>
              <button type="button" onClick={() => { setEditing(false); setDraft(''); setNote(null); }}
                style={{ ...ncSoftBtn, flexShrink: 0, height: 44, padding: '0 15px', borderRadius: 999, fontSize: 13, fontWeight: 800, cursor: 'pointer' }}>
                Cancel
              </button>
              <button type="submit" disabled={busy || !draft.trim()}
                style={{
                  flex: 1, height: 44, borderRadius: 999, border: '2px solid rgba(72,42,14,0.28)', fontSize: 15, fontWeight: 900,
                  background: hex, color: ink, opacity: busy || !draft.trim() ? 0.45 : 1,
                  cursor: busy || !draft.trim() ? 'default' : 'pointer',
                  boxShadow: '0 3px 0 rgba(72,42,14,0.3), 0 7px 16px rgba(72,42,14,0.3), inset 0 1px 0 rgba(255,255,255,0.35)',
                }}>
                {busy ? 'Pinning…' : 'Pin it up'}
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textAlign: 'center', color: 'rgba(74,54,36,0.75)' }}>
              Publishes as a comment from your account
            </p>
          </form>
        ) : (
          <div style={{ display: 'flex', gap: 7 }}>
            <button
              onClick={() => { setEditing(true); setNote(null); }}
              style={{
                flex: 1.35, height: 46, borderRadius: 12, border: '2px solid rgba(72,42,14,0.28)', fontSize: 15, fontWeight: 900,
                background: hex, color: ink, cursor: 'pointer',
                boxShadow: '0 4px 0 rgba(72,42,14,0.32), 0 8px 18px rgba(72,42,14,0.3), inset 0 1px 0 rgba(255,255,255,0.35)',
                animation: mine.length === 0 ? 'nc-pulse 2.8s ease-in-out infinite' : undefined,
              }}
            >
              {mine.length ? 'Name another' : 'Name It'}
            </button>
            <button
              onClick={e => requestExpandedMode(e.nativeEvent, 'namecolor')}
              style={{ ...ncSoftBtn, flex: 1, height: 46, borderRadius: 12, fontWeight: 900, fontSize: 13, cursor: 'pointer' }}
            >
              {data && data.nameCount > 0 ? `View all ${data.nameCount}` : 'View all'}
            </button>
          </div>
        )}

        {!editing && (
          <p style={{ margin: 0, fontSize: 10, fontWeight: 800, textAlign: 'center', color: 'rgba(74,54,36,0.8)' }}>
            {!data ? ' ' : data.nameCount === 0
              ? 'No names pinned yet — yours could stick'
              : 'Tap a note to upvote it'}
          </p>
        )}
      </div>
      </div>
    </div>
  );
};

export const Splash = () => {
  const [postInfo, setPostInfo] = useState<PostInfo | null>(null);
  const [splashStats, setSplashStats] = useState<SplashStats | null>(null);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [roundColors, setRoundColors] = useState<RoundColor[]>(ROUND_FALLBACK);
  const [showMmScores, setShowMmScores] = useState(false);
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [isMmMobile, setIsMmMobile] = useState(() => window.innerWidth < 520);
  const [isMmShort, setIsMmShort] = useState(() => window.innerHeight < 700);
  const [mmVw, setMmVw] = useState(() => window.innerWidth);

  useEffect(() => {
    const compute = () => { setIsMmMobile(window.innerWidth < 520); setIsMmShort(window.innerHeight < 700); setMmVw(window.innerWidth); };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  useEffect(() => {
    withRetry(() => trpc.game.getPostInfo.query())
      .then(info => {
        // Kick the art off the moment the type is known — waiting for the render
        // pass below costs a visible beat on the hero.
        if (info.postType === 'mastermind') {
          for (const src of ['/vault-hero.webp', '/heart-in-cage.png']) new Image().src = src;
        }
        setPostInfo(info);
      })
      .catch(() => setPostInfo({ postType: 'daily', isCreator: false, configured: false, creator: null, title: null }));
    trpc.game.getSplashStats.query()
      .then(d => { if (d) setSplashStats(d); })
      .catch(() => {});
    trpc.game.getDailyRoundColors.query()
      .then(colors => { if (colors.length === 5) setRoundColors(colors); })
      .catch(() => {});
  }, []);

  if (showScoreboard) return <Scoreboard onClose={() => setShowScoreboard(false)} isCustomPost={postInfo?.postType === 'custom'} />;
  if (postInfo?.postType === 'palette-poet') return <PalettePoetSplash />;
  if (postInfo?.postType === 'leaderboard') return <GlobalLeaderboard />;
  if (postInfo?.postType === 'flag') return <FlagSplash initialFlags={postInfo.flags ?? null} />;
  if (postInfo?.postType === 'memory') return <MemorySplash />;
  if (postInfo?.postType === 'wire') return <WireSplash />;
  if (postInfo?.postType === 'rewire') return <RewireSplash />;
  if (postInfo?.postType === 'equinox') return <EquinoxSplash initial={postInfo.board ?? null} />;
  if (postInfo?.postType === 'namecolor') return <NameColorSplash />;
  if (postInfo?.postType === 'mastermind') {
    if (showMmScores) {
      return (
        <MastermindScoreboard
          onClose={() => setShowMmScores(false)}
          isCustom={!!postInfo.creator}
          canSeeAnalytics={postInfo.isCreator}
        />
      );
    }

    const mmCompact = isMmMobile && isMmShort;
    const mmW = Math.round(Math.min(mmVw * 0.9, mmCompact ? 340 : 380));
    const mmCfg = mmConfig(!!postInfo.creator);
    const mmLead = mmW < 300
      ? `${mmCfg.poolSize} colors · secret ${mmCfg.secretLen}-color code`
      : `Pick from ${mmCfg.poolSize} colors · secret ${mmCfg.secretLen}-color code`;
    const mmTail = mmW < 300
      ? `${mmCfg.maxGuesses} attempts — crack it`
      : `${mmCfg.maxGuesses} attempts — crack the combination`;
    const MM_ROWS = [
      { n: 2, kind: 'exact' as const, text: 'two are right color & right spot' },
      { n: 1, kind: 'color' as const, text: 'one is right color & wrong spot' },
    ];
    // Type is solved from the longest line rather than guessed per breakpoint.
    // Monospace advance is ~0.62em; a legend row also carries a chip gutter of
    // 2F+6 plus an 8px gap. Take the largest font every line survives, so the
    // block holds one row per line from a 280px webview to a desktop panel.
    const MM_ADV = 0.62;
    const mmFits = Math.min(
      ...MM_ROWS.map(r => (mmW - 14) / (r.text.length * MM_ADV + 2)),
      ...[mmLead, mmTail].map(s => mmW / (s.length * MM_ADV)),
    );
    // Floor, never round — rounding up puts the longest row back over the edge.
    const mmFont = Math.floor(Math.max(10, Math.min(15, mmFits)) * 10) / 10;
    const mmMark = Math.round(mmFont);
    const mmGutter = Math.floor(mmFont * 2 + 6);
    const mmWidth = `${mmW}px`;
    return (
      <div style={{ position: 'relative', display: 'flex', height: '100vh', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#0e141d', gap: mmCompact ? 8 : 14, padding: mmCompact ? '10px 24px' : '14px 24px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', overflow: 'hidden' }}>

        {/* Trophy button — top right */}
        <button
          onClick={() => setShowMmScores(true)}
          style={{ position: 'absolute', top: 14, right: 14, width: 38, height: 38, borderRadius: '50%', border: '1.5px solid rgba(150,175,200,0.18)', background: '#243040', fontSize: 17, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          aria-label="Scores"
        >
          🏆
        </button>

        {/* Title */}
        <div style={{ textAlign: 'center', flexShrink: 0, width: mmWidth }}>
          <p style={{ fontSize: mmCompact ? 19 : 24, fontWeight: 900, color: '#ff6b35', margin: 0, letterSpacing: '0.02em', textTransform: 'uppercase', textShadow: '0 0 14px rgba(255,107,53,0.45)' }}>The Rescue</p>
          <p style={{ fontSize: 13, color: '#d6c3a5', marginTop: 6 }}>
            Find the right combination — spring them free
          </p>
        </div>

        {/* Hero scene — widescreen crop of the square source, capped by vh so it always fits without scrolling */}
        <div style={{
          width: mmWidth,
          aspectRatio: '1.8 / 1', flexShrink: 0,
          maxHeight: mmCompact ? '20vh' : '28vh',
          border: '2px dashed #ff6b35', borderRadius: 6, overflow: 'hidden',
          backgroundColor: '#1a2432',
        }}>
          <img src="/vault-hero.webp" alt="A hero reaches for the vault dial while a captive watches through the barred window" decoding="async" fetchPriority="high" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 42%', display: 'block' }} />
        </div>

        {/* How to play — trimmed to essentials on short screens so the image never has to give */}
        <div style={{ width: mmWidth, display: 'flex', flexDirection: 'column', gap: mmCompact ? 5 : 7, flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: mmFont, fontWeight: 700, color: '#9fb3c8', lineHeight: 1.4, textAlign: 'center', whiteSpace: 'nowrap' }}>
            {mmLead}
          </p>

          {/* The two legend rows live in one fit-content column so both chips
              share a left edge — centring each row separately staggers them. */}
          <div style={{ alignSelf: 'center', width: 'fit-content', display: 'flex', flexDirection: 'column', gap: mmCompact ? 4 : 6 }}>
            {/* Numbers are spelled out in the sentence so the chip reads as an
                example, not a rule — and teaches that marks always carry a count. */}
            {MM_ROWS.map(row => (
              <div key={row.kind} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: mmGutter, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  <MmChip n={row.n} kind={row.kind} size={mmMark} font={mmFont + 1} />
                </span>
                {/* One ink for all prose, so the chips stay the only bright thing. */}
                <span style={{ fontSize: mmFont, color: '#9fb3c8', fontWeight: 500, lineHeight: 1.4, whiteSpace: 'nowrap' }}>
                  {row.text}
                </span>
              </div>
            ))}
          </div>

          <p style={{ margin: 0, fontSize: mmFont, fontWeight: 500, color: '#9fb3c8', lineHeight: 1.4, textAlign: 'center', whiteSpace: 'nowrap' }}>
            {mmTail}
          </p>
        </div>

        {/* Buttons */}
        <div style={{ width: mmWidth, display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0 }}>
          <button
            style={{ height: 50, width: '100%', borderRadius: 999, background: '#ff6b35', color: '#1a0d06', fontWeight: 800, fontSize: 15, border: 'none', cursor: 'pointer', boxShadow: '0 4px 26px rgba(255,107,53,0.4)' }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'mastermind')}
          >
            Rescue
          </button>
          <button
            style={{ height: 40, width: '100%', borderRadius: 999, background: '#243040', color: '#9fb3c8', fontWeight: 600, fontSize: 12, border: '1.5px solid rgba(150,175,200,0.18)', cursor: 'pointer' }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'mastermind-creator')}
          >
            Create Your Own Code
          </button>
        </div>

      </div>
    );
  }

  const isCustom = postInfo?.postType === 'custom';
  const isSetupNeeded = !!(isCustom && postInfo?.isCreator && !postInfo?.configured);
  const isReadyCustom = !!(isCustom && postInfo?.configured);
  const isWheelCustom = isReadyCustom && (postInfo as { inputMode?: string } | null)?.inputMode === 'wheel';
  const isSliderCustom = isReadyCustom && !isWheelCustom;
  const isDark = true;


  return (
    <div
      className="relative flex h-screen flex-col items-center px-7"
      style={{
        background: isWheelCustom || isSliderCustom ? '#000000' : '#0a0a12',
        gap: 15,
        paddingTop: isSliderCustom ? 28 : isCustom && !isSetupNeeded ? 72 : 0,
        paddingBottom: isWheelCustom ? 12 : 90,
        overflow: 'hidden',
        opacity: postInfo ? 1 : 0,
        transition: 'opacity 0.15s ease',
      }}
    >
      {isSliderCustom && (
        <style>{`
          @keyframes cg-slider-play {
            0%, 100% { transform: scale(1); box-shadow: 0 12px 30px rgba(234,88,12,0.55), 0 0 0 6px rgba(245,166,35,0.22), inset 0 1px 0 rgba(255,255,255,0.5); }
            50%      { transform: scale(1.045); box-shadow: 0 16px 40px rgba(234,88,12,0.72), 0 0 0 10px rgba(245,166,35,0.34), inset 0 1px 0 rgba(255,255,255,0.5); }
          }
          .cg-slider-play { animation: cg-slider-play 2.2s ease-in-out infinite; }
        `}</style>
      )}
      {!isCustom && <BarberPoleBackground rounds={roundColors} />}
      {isSliderCustom && <FightCardBackground rounds={roundColors} />}
      {isSliderCustom && <RingsideCrowd snoos={splashStats?.crowd ?? []} />}
      {isCustom && !isWheelCustom && !isSliderCustom && (LOGO_CONFETTI_VARIATION
        ? <LogoConfettiBackground rounds={roundColors} />
        : SLIDE_BARS_VARIATION
          ? <SlideBarsBackground rounds={roundColors} />
          : SLIDER_BG_VARIATION
            ? <FallingSwatchesBackground rounds={roundColors} />
            : <ConfettiBackground rounds={roundColors} />)}

      {/* Custom top bar: logo + trophy — wheel mode only (slider drops this bar) */}
      {isCustom && !isSetupNeeded && !isSliderCustom && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
          height: 62,
          background: '#000000',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          padding: '0 14px',
        }}>
          <button
            style={{
              width: 38, height: 38, borderRadius: '50%',
              border: '1.5px solid #F5A623',
              background: 'rgba(245,166,35,0.18)',
              fontSize: 17, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 10px rgba(0,0,0,0.5), 0 0 0 3px rgba(245,166,35,0.25)',
            }}
            onClick={() => setShowScoreboard(true)}
            aria-label="Scoreboard"
          >
            🏆
          </button>
        </div>
      )}

      {/* Scoreboard button — slider custom (no top bar for this mode) */}
      {isSliderCustom && !isSetupNeeded && (
        <button
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 30,
            width: 46, height: 46, borderRadius: '50%',
            border: '1.5px solid #F5A623',
            background: 'rgba(245,166,35,0.18)',
            fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 2px 10px rgba(0,0,0,0.5), 0 0 0 3px rgba(245,166,35,0.25)',
          }}
          onClick={() => setShowScoreboard(true)}
          aria-label="Scoreboard"
        >
          🏆
        </button>
      )}

      {/* Scoreboard button — daily only */}
      {!isCustom && !isSetupNeeded && (
        <button
          style={{
            position: 'absolute', top: 10, right: 10, zIndex: 30,
            width: 46, height: 46, borderRadius: '50%',
            border: 'none',
            background: '#111',
            fontSize: 20, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setShowScoreboard(true)}
          aria-label="Scoreboard"
        >
          🏆
        </button>
      )}

      {/* Main content */}
      <div style={{ position: 'relative', zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isWheelCustom ? 10 : 15, width: '100%' }}>

      {/* Logo + Title + optional fan grouped tight */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: isWheelCustom ? 6 : 0 }}>
        <div style={{ textAlign: 'center' }}>
          {!isReadyCustom && (
            <img
              src="/icon.png"
              alt="Color Guessr"
              className={isSliderCustom ? 'splash-logo-shift' : undefined}
              style={{
                width: isSliderCustom ? 56 : 68, height: isSliderCustom ? 56 : 68, borderRadius: 18, display: 'block', margin: isSliderCustom ? '0 auto 12px' : '0 auto 14px',
                boxShadow: isDark ? '0 4px 28px rgba(0,0,0,0.55)' : '0 8px 32px rgba(245, 158, 11, 0.35)',
              }}
            />
          )}
          {isReadyCustom ? (
            <img
              src="/icon.png"
              alt="ColorGuessr"
              style={{
                width: 64, height: 64, borderRadius: 18, display: 'block', margin: '0 auto',
                boxShadow: isSliderCustom
                  ? '0 4px 28px rgba(0,0,0,0.55), 0 0 34px rgba(245,166,35,0.32)'
                  : isDark ? '0 4px 28px rgba(0,0,0,0.55)' : '0 8px 32px rgba(245,158,11,0.35)',
              }}
            />
          ) : isSetupNeeded ? (
            <>
              <h1 style={{ fontSize: 34, fontWeight: 900, color: isDark ? '#fff' : '#92400e', letterSpacing: '-0.03em', margin: 0 }} className="splash-title">Color Guessr</h1>
              <p style={{ fontSize: 14, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginTop: 4 }} className="splash-subtitle">Custom Puzzle — Setup Required</p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: 34, fontWeight: 900, color: '#fff', letterSpacing: '-0.03em', margin: 0 }} className="splash-title">ColorGuessr</h1>
              <p style={{ fontSize: 11.5, fontWeight: 500, color: 'rgba(255,255,255,0.45)', marginTop: 4 }} className="splash-subtitle">5 rounds per day • Max score: 100 points</p>
            </>
          )}
        </div>

        {/* Card fan — wheel custom only */}
        {isWheelCustom && (
          <CardFanShuffle colors={roundColors.map(c => c.hex)} />
        )}
      </div>

      {/* Info card — daily only */}
      {!isCustom && (
        <div
          className="splash-card"
          style={{
            width: '100%', maxWidth: 315, borderRadius: 14,
            background: 'rgba(255,255,255,0.08)', padding: '9px 6px',
            display: 'flex',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255,255,255,0.1)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
        >
          {[
            { icon: <span style={{ color: '#fbbf24', fontWeight: 900, fontSize: 13 }}>GOLD</span>, label: 'See a color name' },
            { icon: <span style={{ fontSize: 19 }}>🎨</span>, label: 'Pick the right shade' },
            { icon: <span style={{ fontSize: 19 }}>⭐</span>, label: `${PP_TOTAL_SCORE} pts total` },
          ].map((col, i) => (
            <div key={i} style={{
              flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '0 4px',
              borderRight: i < 2 ? '1px solid rgba(255,255,255,0.1)' : undefined,
            }}>
              <div style={{ height: 24, display: 'flex', alignItems: 'center' }}>{col.icon}</div>
              <p style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.75)', textAlign: 'center', lineHeight: 1.3, margin: 0 }}>{col.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Versus matchup — slider custom only; each avatar orbited by a glowing bulb */}
      {isSliderCustom && (
        <div style={{
          width: '100%', maxWidth: 330, margin: '0 auto',
          borderRadius: 14,
          background: 'linear-gradient(170deg, rgba(28,18,10,0.82), rgba(8,5,14,0.88))',
          border: '2px solid rgba(245,166,35,0.55)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
          boxShadow: '0 20px 48px rgba(0,0,0,0.62), inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.16)',
          padding: '12px 12px 16px',
        }}>
          {/* poster marquee */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '0 4px 12px' }}>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, transparent, rgba(245,166,35,0.6))' }} />
            <span style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: '0.22em', color: '#F5A623', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              Tonight's Challenger
            </span>
            <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, transparent, rgba(245,166,35,0.6))' }} />
          </div>
          <VsMatchup
            you={{ name: splashStats?.username ?? 'You', avatar: splashStats?.userAvatar ?? undefined }}
            rival={
              splashStats?.topPlayer
                ? { name: splashStats.topPlayer.username, avatar: splashStats.topPlayer.avatar ?? undefined, score: splashStats.topPlayer.score }
                : splashStats?.creator
                  ? { name: splashStats.creator, avatar: splashStats.creatorAvatar ?? undefined }
                  : null
            }
          />
        </div>
      )}

      {/* Accept Challenge — slider custom only, directly above Build (ring moved below both, as a footer accent). */}
      {isSliderCustom && (
        <button
          className="cg-slider-play"
          style={{
            height: 60, width: '100%', maxWidth: 340, borderRadius: 12,
            marginTop: 10,
            background: 'linear-gradient(180deg,#f97316 0%,#ea580c 55%,#c2410c 100%)',
            color: '#fff', fontWeight: 900, fontSize: 19, letterSpacing: '0.06em',
            textTransform: 'uppercase',
            border: '2px solid rgba(255,255,255,0.55)',
            cursor: 'pointer',
            textShadow: '0 1px 6px rgba(0,0,0,0.28)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
          onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
        >
          Accept Challenge
        </button>
      )}

      {/* Action buttons */}
      <div style={{ width: '100%', maxWidth: isWheelCustom ? 230 : isSliderCustom ? 340 : 315, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
        ) : !isSliderCustom ? (
          <button
            className={isWheelCustom ? 'cg-play-pulse' : undefined}
            style={{
              height: 50, width: '100%', borderRadius: 999,
              background: '#ea580c',
              color: '#fff', fontWeight: 800, fontSize: 15,
              border: '1.5px solid #F5A623',
              cursor: 'pointer',
              boxShadow: '0 4px 20px rgba(0,0,0,0.45), 0 0 0 3px rgba(245,166,35,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
          >
            {splashStats?.username && (
              <UserAvatar name={splashStats.username} url={splashStats.userAvatar ?? undefined} size={24} border="1.5px solid rgba(255,255,255,0.5)" />
            )}
            Play
          </button>
        ) : null}
        {!isSetupNeeded && !isSliderCustom && !isWheelCustom && (
          <button
            style={{
              height: 46, width: '100%', borderRadius: 999,
              background: '#fff',
              color: '#111',
              fontWeight: 700, fontSize: 13,
              border: '1.5px solid #A78BFA',
              cursor: 'pointer',
              letterSpacing: '0.01em',
              boxShadow: '0 4px 20px rgba(0,0,0,0.45), 0 0 0 3px rgba(167,139,250,0.3)',
            }}
            onClick={(e) => requestExpandedMode(e.nativeEvent, 'creator')}
          >
            Create Custom ColorGuessr
          </button>
        )}
      </div>

      </div>{/* end main content */}

      {/* Rank card — top-left for custom modes: Rank 1 player */}
      {(isSliderCustom || isWheelCustom) && splashStats?.topPlayer && (
        <div style={{ position: 'absolute', top: 10, left: 10, zIndex: 30, pointerEvents: 'none', maxWidth: '46%' }}>
          <RankCard
            username={splashStats.topPlayer.username}
            userAvatar={splashStats.topPlayer.avatar}
            rank={1}
            score={splashStats.topPlayer.score}
            maxScore={100}
            isDark={isDark}
          />
        </div>
      )}

      {/* Bottom stat cards */}
      {splashStats && (
        <div style={{
          position: 'absolute', bottom: 14, left: 14, right: 14, zIndex: 10,
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

          {/* Right: BUILD button for custom, Rank card for daily */}
          {(isSliderCustom || isWheelCustom) && !isSetupNeeded ? (
            <button
              onClick={() => setShowBuildModal(true)}
              style={{
                pointerEvents: 'auto', flexShrink: 0, whiteSpace: 'nowrap', overflow: 'visible',
                display: 'flex', alignItems: 'center', gap: 4,
                height: 46, padding: '0 22px 0 16px', borderRadius: 999,
                background: '#fff', color: '#111', fontWeight: 800, fontSize: 16, letterSpacing: '0.03em',
                border: '1.5px solid #A78BFA', cursor: 'pointer',
                boxShadow: '0 4px 20px rgba(0,0,0,0.45), 0 0 0 3px rgba(167,139,250,0.3)',
              }}
            >
              <img
                src="/hammer.webp"
                alt=""
                style={{ width: 40, height: 40, objectFit: 'contain', display: 'block', marginTop: -16, marginLeft: -6, filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.35))' }}
              />
              BUILD
            </button>
          ) : splashStats.userRank != null && splashStats.userScore != null && splashStats.username ? (
            <RankCard
              username={splashStats.username}
              userAvatar={splashStats.userAvatar}
              rank={splashStats.userRank}
              score={splashStats.userScore}
              maxScore={100}
              isDark={isDark}
            />
          ) : <div />}
        </div>
      )}

      {/* Build your own level — game mode picker */}
      {showBuildModal && (
        <div
          style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 50 }}
          onClick={() => setShowBuildModal(false)}
        >
          <div
            style={{ background: '#1f1f1f', borderRadius: 20, width: '100%', maxWidth: 380, border: '1px solid #3a3a3a', overflow: 'hidden' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 20px 4px' }}>
              <div>
                <p style={{ fontSize: 22, fontWeight: 900, color: '#fff', margin: 0, letterSpacing: '-0.02em' }}>Build your own level</p>
                <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#9ca3af', margin: '6px 0 0' }}>Select Game mode</p>
              </div>
              <button onClick={() => setShowBuildModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 20, lineHeight: 1, padding: 0 }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '16px 20px 20px' }}>
              <button
                style={{ flex: '1 1 40%', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 16, padding: '18px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={(e) => requestExpandedMode(e.nativeEvent, 'creator')}
              >
                <img src="/icon.png" alt="" style={{ width: 36, height: 36, borderRadius: 10 }} />
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>ColorGuessr</span>
                <span style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>Pick the exact shade</span>
              </button>
              <button
                style={{ flex: '1 1 40%', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 16, padding: '18px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={(e) => requestExpandedMode(e.nativeEvent, 'palette-poet-creator')}
              >
                <span style={{ fontSize: 30 }}>✍️</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Palette Poet</span>
                <span style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>Write clues, guess colors</span>
              </button>
              <button
                style={{ flex: '1 1 40%', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 16, padding: '18px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={(e) => requestExpandedMode(e.nativeEvent, 'wire-creator')}
              >
                <span style={{ fontSize: 30 }}>🔌</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Colorwire</span>
                <span style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>Connect every pair</span>
              </button>
              <button
                style={{ flex: '1 1 40%', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: 16, padding: '18px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, cursor: 'pointer' }}
                onClick={(e) => requestExpandedMode(e.nativeEvent, 'namecolor-creator')}
              >
                <span style={{ fontSize: 30 }}>🏷️</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>Name This Color</span>
                <span style={{ fontSize: 10, color: '#9ca3af', textAlign: 'center' }}>Most upvoted name leads</span>
              </button>
            </div>
          </div>
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
