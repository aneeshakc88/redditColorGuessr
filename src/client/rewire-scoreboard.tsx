// Rewire leaderboard — trimmed version of wire-scoreboard.tsx's Scores/Creators
// tabs. No Stats/Analytics tab: every Rewire board is custom, so there's no
// lifetime stats or streak accumulation to show (same reasoning Colorwire's
// own custom boards use).
import { useEffect, useState } from 'react';
import { navigateTo } from '@devvit/web/client';
import { trpc } from './trpc';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/trpc';

type RewireLbData = inferRouterOutputs<AppRouter>['rewire']['getLeaderboard'];
type RewireCreators = inferRouterOutputs<AppRouter>['rewire']['getCreatorLeaderboard'];
type Tab = 'scores' | 'creators';

const BG = 'radial-gradient(120% 90% at 50% -10%, #12314d 0%, #0c1b2c 45%, #070d16 100%)';
const ACCENT = '#38bdf8';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';

const rwTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const AVATAR_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#a855f7'];

const Avatar = ({ name, url, size = 30, border }: { name: string; url?: string | undefined; size?: number; border?: string }) => {
  if (url) return <img src={url} alt={name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border }} onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />;
  const bg = AVATAR_COLORS[name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_COLORS.length]!;
  return <div style={{ width: size, height: size, borderRadius: '50%', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.4, fontWeight: 700, color: '#fff', flexShrink: 0, border }}>{name[0]?.toUpperCase()}</div>;
};

const ScoresTab = ({ data }: { data: RewireLbData | null }) => {
  const top = data?.top ?? [];
  const username = data?.username ?? null;
  const snoovatars = data?.snoovatars ?? {};
  const podium = [top[1], top[0], top[2]] as (typeof top[number] | undefined)[];
  const count = data?.playerCount ?? 0;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: ACCENT, background: 'rgba(56,189,248,0.16)', borderRadius: 999, padding: '3px 10px', whiteSpace: 'nowrap' }}>
          This Board
        </span>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#71717a', whiteSpace: 'nowrap' }}>
          {count} {count === 1 ? 'solver' : 'solvers'}
        </span>
      </div>

      {data?.creator && (
        <p style={{ margin: '6px 16px 0', fontSize: 11, color: '#71717a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.title ? `${data.title} · ` : ''}by u/{data.creator}
        </p>
      )}

      {username && (
        <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 10, background: CARD, borderRadius: 12, padding: '9px 14px', border: `1px solid ${BORDER}` }}>
          <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: '#71717a', margin: 0, whiteSpace: 'nowrap' }}>Your Rank</p>
          <Avatar name={username} url={snoovatars[username]} size={26} />
          <p style={{ flex: 1, fontSize: 13, fontWeight: 900, color: '#fff', margin: 0 }}>
            {data?.userRank ? `#${data.userRank}` : '—'}
          </p>
          <p style={{ fontSize: 13, fontWeight: 800, color: ACCENT, margin: 0, fontVariantNumeric: 'tabular-nums' }}>
            {data?.userScore ?? '—'}
          </p>
        </div>
      )}

      {top.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 13, color: '#71717a' }}>Nobody has solved it yet. Be the first!</p>
        </div>
      ) : (
        <div className="rw-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ margin: '16px 16px 4px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            {podium.map((entry, podiumIdx) => {
              const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
              const isFirst = rank === 1;
              const isMe = entry?.member === username;
              return entry ? (
                <div
                  key={entry.member}
                  style={{
                    flex: isFirst ? 1.4 : 1, minWidth: 0,
                    background: isFirst ? 'rgba(56,189,248,0.14)' : CARD,
                    border: `1.5px solid ${isFirst ? ACCENT : BORDER}`,
                    borderRadius: 16, padding: '12px 8px 10px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    outline: isMe ? `2px solid ${ACCENT}` : undefined,
                  }}
                >
                  <Avatar name={entry.member} url={snoovatars[entry.member]} size={isFirst ? 44 : 34} border={`1.5px solid ${isFirst ? ACCENT : BORDER}`} />
                  <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? ACCENT : '#71717a', margin: 0 }}>{rank}</p>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#d4d4d8', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <span style={{ background: isFirst ? ACCENT : 'rgba(255,255,255,0.1)', color: isFirst ? '#04212f' : '#d4d4d8', fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px', fontVariantNumeric: 'tabular-nums' }}>{entry.score}</span>
                  {entry.l1TimeSec != null && entry.l2TimeSec != null && (
                    <p style={{ fontSize: 9, fontWeight: 600, color: '#71717a', margin: 0 }}>{rwTime(entry.l1TimeSec + entry.l2TimeSec)}</p>
                  )}
                </div>
              ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1 }} />;
            })}
          </div>

          <div style={{ paddingBottom: 16 }}>
            {top.slice(3).map((entry, i) => {
              const rank = i + 4;
              const isMe = entry.member === username;
              return (
                <div
                  key={entry.member}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                    background: isMe ? 'rgba(56,189,248,0.12)' : 'transparent',
                    borderLeft: `3px solid ${isMe ? ACCENT : 'transparent'}`,
                  }}
                >
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#71717a', margin: 0 }}>{rank}</p>
                  <Avatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#fff' : '#d4d4d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                    {entry.l1TimeSec != null && entry.l2TimeSec != null && (
                      <p style={{ fontSize: 10, fontWeight: 600, color: '#71717a', margin: '1px 0 0' }}>{rwTime(entry.l1TimeSec + entry.l2TimeSec)} · {entry.l1Swaps} swaps · {entry.l2Moves} wires</p>
                    )}
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

type CreatorSub = 'builders' | 'engaging' | 'rising';

const CREATOR_SUBS: { id: CreatorSub; label: string; blurb: string }[] = [
  { id: 'builders', label: 'Builders', blurb: 'Most boards posted that reached 5+ solvers' },
  { id: 'engaging', label: 'Engaging', blurb: 'Biggest single board — tap a row to play it' },
  { id: 'rising', label: 'Rising', blurb: 'New creators — first board in the last 30 days' },
];

const CreatorsTab = ({ data, failed }: { data: RewireCreators | null; failed: boolean }) => {
  const [sub, setSub] = useState<CreatorSub>('builders');
  const top = data?.[sub] ?? [];
  const username = data?.username ?? null;
  const snoovatars = data?.snoovatars ?? {};
  const userRank = data?.ranks?.[sub] ?? null;
  const podium = [top[1], top[0], top[2]] as (typeof top[number] | undefined)[];
  const meta = CREATOR_SUBS.find(s => s.id === sub)!;

  const unit = (e: typeof top[number]) =>
    sub === 'builders' ? `board${e.score === 1 ? '' : 's'}` : `solver${e.score === 1 ? '' : 's'}`;
  const detail = (e: typeof top[number]) =>
    sub === 'builders' ? `${e.plays} solver${e.plays === 1 ? '' : 's'} total`
      : sub === 'engaging' ? (e.bestTitle || 'Untitled board')
        : `${e.boards} board${e.boards === 1 ? '' : 's'} posted`;

  return (
    <div className="rw-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain' }}>
      <div style={{ margin: '10px 16px 0', display: 'flex', gap: 6 }}>
        {CREATOR_SUBS.map(s => (
          <button
            key={s.id}
            onClick={() => setSub(s.id)}
            style={{
              flex: 1, borderRadius: 999, padding: '5px 0', fontSize: 10, fontWeight: 800,
              letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer',
              background: sub === s.id ? 'rgba(56,189,248,0.18)' : 'transparent',
              color: sub === s.id ? ACCENT : '#71717a',
              border: `1px solid ${sub === s.id ? ACCENT : BORDER}`,
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p style={{ margin: '8px 16px 0', fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', color: '#71717a' }}>
        {meta.blurb}
      </p>

      {userRank && username && (
        <div style={{ margin: '10px 16px 0', display: 'flex', alignItems: 'center', gap: 10, background: CARD, borderRadius: 12, padding: '9px 14px', border: `1px solid ${BORDER}` }}>
          <p style={{ fontSize: 9, fontWeight: 800, textTransform: 'uppercase', color: '#71717a', margin: 0, whiteSpace: 'nowrap' }}>Your Rank</p>
          <Avatar name={username} url={snoovatars[username]} size={26} />
          <p style={{ flex: 1, fontSize: 13, fontWeight: 900, color: '#fff', margin: 0 }}>#{userRank}</p>
        </div>
      )}

      {top.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 16px' }}>
          <p style={{ fontSize: 13, color: '#71717a', textAlign: 'center' }}>
            {!data && !failed ? 'Loading…'
              : failed ? "Couldn't load creators. Close and reopen the leaderboard."
                : sub === 'rising' ? 'No new creators this month. Post your first board to land here!'
                  : sub === 'builders' ? 'No board has reached 5 solvers yet. Build one to top this list!'
                    : 'No custom boards posted yet. Build one to top this list!'}
          </p>
        </div>
      ) : (
        <>
          <div style={{ margin: '16px 16px 4px', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            {podium.map((entry, podiumIdx) => {
              const rank = podiumIdx === 0 ? 2 : podiumIdx === 1 ? 1 : 3;
              const isFirst = rank === 1;
              const isMe = entry?.member === username;
              const playable = sub === 'engaging' && !!entry?.bestUrl;
              return entry ? (
                <div
                  key={entry.member}
                  onClick={playable ? () => navigateTo(entry.bestUrl!) : undefined}
                  style={{
                    flex: isFirst ? 1.4 : 1, minWidth: 0,
                    background: isFirst ? 'rgba(56,189,248,0.14)' : CARD,
                    border: `1.5px solid ${isFirst ? ACCENT : BORDER}`,
                    borderRadius: 16, padding: '12px 8px 10px',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                    outline: isMe ? `2px solid ${ACCENT}` : undefined,
                    cursor: playable ? 'pointer' : 'default',
                  }}
                >
                  <Avatar name={entry.member} url={snoovatars[entry.member]} size={isFirst ? 44 : 34} border={`1.5px solid ${isFirst ? ACCENT : BORDER}`} />
                  <p style={{ fontSize: isFirst ? 22 : 18, fontWeight: 900, color: isFirst ? ACCENT : '#71717a', margin: 0 }}>{rank}</p>
                  <p style={{ fontSize: 10, fontWeight: 700, color: '#d4d4d8', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                  <span style={{ background: isFirst ? ACCENT : 'rgba(255,255,255,0.1)', color: isFirst ? '#04212f' : '#d4d4d8', fontSize: 12, fontWeight: 800, borderRadius: 8, padding: '2px 8px', fontVariantNumeric: 'tabular-nums' }}>{entry.score} {unit(entry)}</span>
                  <p style={{ fontSize: 9, fontWeight: 600, color: '#71717a', margin: 0, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail(entry)}</p>
                </div>
              ) : <div key={podiumIdx} style={{ flex: isFirst ? 1.4 : 1 }} />;
            })}
          </div>

          <div style={{ paddingBottom: 16 }}>
            {top.slice(3).map((entry, i) => {
              const rank = i + 4;
              const isMe = entry.member === username;
              const playable = sub === 'engaging' && !!entry.bestUrl;
              return (
                <div
                  key={entry.member}
                  onClick={playable ? () => navigateTo(entry.bestUrl!) : undefined}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                    background: isMe ? 'rgba(56,189,248,0.12)' : 'transparent',
                    borderLeft: `3px solid ${isMe ? ACCENT : 'transparent'}`,
                    cursor: playable ? 'pointer' : 'default',
                  }}
                >
                  <p style={{ width: 24, textAlign: 'center', fontSize: 12, fontWeight: 700, color: '#71717a', margin: 0 }}>{rank}</p>
                  <Avatar name={entry.member} url={snoovatars[entry.member]} size={30} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: isMe ? 800 : 600, color: isMe ? '#fff' : '#d4d4d8', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.member}</p>
                    <p style={{ fontSize: 10, fontWeight: 600, color: playable ? ACCENT : '#71717a', margin: '1px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail(entry)}</p>
                  </div>
                  <p style={{ fontSize: 13, fontWeight: 800, color: isMe ? ACCENT : '#a1a1aa', margin: 0, fontVariantNumeric: 'tabular-nums' }}>{entry.score}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

export const RewireScoreboard = ({ onClose, overlay }: { onClose: () => void; overlay?: boolean }) => {
  const [tab, setTab] = useState<Tab>('scores');
  const [data, setData] = useState<RewireLbData | null>(null);
  const [creators, setCreators] = useState<RewireCreators | null>(null);
  const [creatorsFailed, setCreatorsFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    trpc.rewire.getLeaderboard.query().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tab === 'creators' && !creators) {
      trpc.rewire.getCreatorLeaderboard.query().then(setCreators).catch(() => setCreatorsFailed(true));
    }
  }, [tab, creators]);

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      style={{
        flex: 1, borderRadius: 999, padding: '6px 0',
        fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
        background: tab === t ? ACCENT : 'transparent',
        color: tab === t ? '#04212f' : '#71717a',
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
      <style>{`.rw-scroll::-webkit-scrollbar{ width:0; height:0; }`}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px 12px', flexShrink: 0 }}>
        <h2 style={{ fontSize: 18, fontWeight: 900, letterSpacing: '-0.02em', margin: 0 }}>Leaderboard</h2>
        <button onClick={onClose} style={{ width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${BORDER}`, background: 'transparent', cursor: 'pointer', color: '#a1a1aa', fontSize: 15 }}>✕</button>
      </div>

      <div style={{ margin: '0 16px', background: 'rgba(255,255,255,0.06)', borderRadius: 999, padding: 3, display: 'flex', flexShrink: 0 }}>
        {tabBtn('scores', 'Scores')}
        {tabBtn('creators', 'Creators')}
      </div>

      {loading ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ fontSize: 13, color: '#71717a' }}>Loading…</p></div>
      ) : tab === 'scores' ? (
        <ScoresTab data={data} />
      ) : (
        <CreatorsTab data={creators} failed={creatorsFailed} />
      )}
    </div>
  );
};
