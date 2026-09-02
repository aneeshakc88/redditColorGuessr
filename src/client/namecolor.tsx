import './index.css';

import { StrictMode, useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { navigateTo } from '@devvit/web/client';
import type { inferRouterOutputs } from '@trpc/server';
import { trpc } from './trpc';
import type { AppRouter } from '../server/trpc';
import { inkOn } from '../shared/ink';
import { NAMECOLOR_CONFIG, recapLine } from '../shared/namecolor-core';
import { VoteCount } from './components/UpvoteArrow';
import { submitName } from './namecolor-submit';
import { UserAvatar } from './leaderboard';
import { Loader } from './components/Loader';

type NamesData = inferRouterOutputs<AppRouter>['namecolor']['getNames'];
type FameData = inferRouterOutputs<AppRouter>['namecolor']['getHallOfFame'];

const BG = '#0f0f10';
const CARD = 'rgba(255,255,255,0.055)';
const BORDER = 'rgba(255,255,255,0.09)';

const ago = (ms: number | null): string => {
  if (ms == null) return 'not counted yet';
  const m = Math.floor((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
};

const MEDAL = ['🥇', '🥈', '🥉'];

// Slower than the splash: this screen is read at length, and every pass asks the
// server to recount, which it will actually do at most once a minute.
const NAMES_POLL_MS = 10_000;

// No recount at the tap: the vote has not been cast yet, and spending the
// server's one-a-minute budget on the pre-vote number would only delay the real
// one. The poll below already re-counts on every pass.
const openComment = (url: string): void => navigateTo(url);

const NameRow = ({ row, avatar }: { row: NamesData['names'][number]; avatar?: string | undefined }) => (
  <button
    onClick={() => openComment(row.url)}
    style={{
      display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
      padding: '10px 12px', borderRadius: 14, cursor: 'pointer',
      background: row.mine ? 'rgba(129,140,248,0.14)' : CARD,
      border: `1px solid ${row.mine ? 'rgba(129,140,248,0.45)' : BORDER}`,
    }}
  >
    <span style={{ width: 26, flexShrink: 0, textAlign: 'center', fontSize: row.rank <= 3 ? 17 : 13, fontWeight: 800, color: '#71717a' }}>
      {MEDAL[row.rank - 1] ?? row.rank}
    </span>
    <UserAvatar name={row.author} url={avatar} size={30} />
    <span style={{ flex: 1, minWidth: 0 }}>
      <span style={{ display: 'block', fontSize: 15, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.name}
      </span>
      <span style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        u/{row.author}{row.mine ? ' · you' : ''}
      </span>
    </span>
    <span style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <span style={{ fontSize: 15, fontWeight: 900 }}>
        <VoteCount votes={row.votes} size={13} color={row.votes > 0 ? '#f97316' : '#52525b'} />
      </span>
      <span style={{ fontSize: 9, fontWeight: 700, color: '#52525b', letterSpacing: '0.04em' }}>TAP TO VOTE</span>
    </span>
  </button>
);

const HallOfFame = () => {
  const [data, setData] = useState<FameData | null>(null);
  useEffect(() => { trpc.namecolor.getHallOfFame.query().then(setData).catch(() => {}); }, []);

  if (!data) return <p style={{ textAlign: 'center', color: '#71717a', fontSize: 13, padding: '32px 16px' }}>Loading…</p>;
  if (data.top.length === 0) {
    return <p style={{ textAlign: 'center', color: '#71717a', fontSize: 13, padding: '32px 16px' }}>No names have picked up votes yet. Come back once a few colors have been out a while.</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.stats && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          {[
            { label: 'Names', value: data.stats.names },
            { label: 'Best votes', value: data.stats.bestVotes },
            { label: 'Colors led', value: data.stats.wins },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '10px 8px', textAlign: 'center' }}>
              <p style={{ margin: 0, fontSize: 19, fontWeight: 900, color: '#fff' }}>{s.value}</p>
              <p style={{ margin: 0, fontSize: 10, fontWeight: 700, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</p>
            </div>
          ))}
        </div>
      )}
      <p style={{ margin: '0 0 2px', fontSize: 11, color: '#71717a', fontWeight: 600, textAlign: 'center' }}>
        Best-scoring names across every color, right now. Votes keep moving, so this order does too.
      </p>
      {data.top.map((t, i) => (
        <button key={t.id} onClick={() => navigateTo(t.url)} style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer',
          padding: '9px 12px', borderRadius: 14,
          background: t.author === data.username ? 'rgba(129,140,248,0.14)' : CARD,
          border: `1px solid ${t.author === data.username ? 'rgba(129,140,248,0.45)' : BORDER}`,
        }}>
          <span style={{ width: 26, textAlign: 'center', fontSize: i < 3 ? 17 : 13, fontWeight: 800, color: '#71717a' }}>{MEDAL[i] ?? i + 1}</span>
          <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, background: t.hex, border: `1px solid ${BORDER}` }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
            <span style={{ display: 'block', fontSize: 11, color: '#71717a', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>u/{t.author} · {t.hex}</span>
          </span>
          <UserAvatar name={t.author} url={data.snoovatars[t.author]} size={26} />
          <span style={{ fontSize: 14, fontWeight: 900, flexShrink: 0 }}>
            <VoteCount votes={t.votes} size={12} color="#f97316" />
          </span>
        </button>
      ))}
    </div>
  );
};

export const NameColor = () => {
  const [data, setData] = useState<NamesData | null>(null);
  const [tab, setTab] = useState<'names' | 'fame'>('names');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  // Naming happens on the splash; this screen exists to browse the board, so it
  // opens closed — nobody who came to read gets a keyboard thrown at them.
  const [editing, setEditing] = useState(false);
  // Short webviews — landscape phones, split screen — can't carry the full hero,
  // the counts line and a naming form at once, and the form is what got cut.
  const [short, setShort] = useState(() => window.innerHeight < 560);
  useEffect(() => {
    const onResize = () => setShort(window.innerHeight < 560);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const load = useCallback(async () => {
    try { setData(await trpc.namecolor.getNames.query()); } catch (e) { console.error('[namecolor] load failed:', e); }
  }, []);

  useEffect(() => { trpc.namecolor.getNames.query().then(setData).catch(() => {}); }, []);

  // Tapping a name opens Reddit's comment UI as an overlay on top of this
  // webview, and Devvit overlays do not fire visibilitychange — so there is no
  // event to listen for when the user comes back from voting. Poll instead.
  // getNames also sweeps, but sweepPost floors itself at one Reddit read a
  // minute per post, so the poll costs Redis reads and nothing else.
  useEffect(() => {
    const t = setInterval(() => void load(), NAMES_POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    try { await trpc.namecolor.refresh.mutate(); } catch { /* the reload below still shows what we have */ }
    await load();
    setBusy(false);
  };

  const publish = async () => {
    const raw = draft.trim();
    if (busy || !raw) return;
    setBusy(true);
    const out = await submitName(raw);
    setBusy(false);
    if (out.kind === 'ok') {
      setDraft('');
      setEditing(false);
      setNote(`"${out.name}" is in. Upvotes decide the rest.`);
      await load();
      return;
    }
    setNote(out.message);
  };

  if (!data) return <Loader label="Loading color" />;

  const ink = inkOn(data.hex);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: BG, color: '#fff', overflow: 'hidden' }}>
      {/* Hero — the color is the whole post, so it gets real estate */}
      <div style={{ flexShrink: 0, background: data.hex, padding: short ? '10px 16px 8px' : '18px 16px 14px', color: ink }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, maxWidth: 560, margin: '0 auto' }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', opacity: 0.7 }}>Name this color</p>
            <p style={{ margin: '2px 0 0', fontSize: short ? 21 : 27, fontWeight: 900, letterSpacing: '-0.03em' }}>{data.hex}</p>
            <p style={{ margin: '2px 0 0', fontSize: 12, fontWeight: 600, opacity: 0.75 }}>
              {data.isCustom && data.creator
                ? `${data.title ? `${data.title} · ` : ''}by u/${data.creator}`
                : recapLine(data.createdAt)}
            </p>
          </div>
          <button onClick={() => void refresh()} disabled={busy} aria-label="Refresh vote counts"
            style={{ flexShrink: 0, width: 38, height: 38, borderRadius: '50%', border: `1px solid ${ink}33`, background: `${ink}14`, color: ink, fontSize: 17, cursor: busy ? 'default' : 'pointer' }}>
            ↻
          </button>
        </div>
      </div>

      {/* Votes live in Reddit's comment UI — a webview can't cast them, so the
          job of this screen is to hand people off to the right comment. */}
      {!short && (
        <div style={{ flexShrink: 0, padding: '8px 16px', background: 'rgba(255,255,255,0.03)', borderBottom: `1px solid ${BORDER}` }}>
          <p style={{ margin: 0, fontSize: 11, color: '#a1a1aa', textAlign: 'center', fontWeight: 600, maxWidth: 560, marginInline: 'auto' }}>
            {data.totalNames} {data.totalNames === 1 ? 'name' : 'names'} · tap any name to open its comment and upvote · counts {ago(data.lastSweptAt)}
          </p>
        </div>
      )}

      <div style={{ flexShrink: 0, display: 'flex', gap: 6, padding: short ? '6px 16px 4px' : '10px 16px 6px', maxWidth: 560, width: '100%', margin: '0 auto' }}>
        {([['names', `Names${data.totalNames ? ` (${data.totalNames})` : ''}`], ['fame', 'Hall of Fame']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              flex: 1, height: short ? 30 : 34, borderRadius: 999, fontSize: 12, fontWeight: 800, cursor: 'pointer',
              background: tab === id ? 'rgba(255,255,255,0.13)' : 'transparent',
              border: `1px solid ${tab === id ? 'rgba(255,255,255,0.25)' : BORDER}`,
              color: tab === id ? '#fff' : '#71717a',
            }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 16px 12px', maxWidth: 560, width: '100%', margin: '0 auto' }}>
        {tab === 'fame' ? <HallOfFame /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {data.names.length === 0 ? (
              <p style={{ textAlign: 'center', color: '#71717a', fontSize: 13, padding: '36px 16px', lineHeight: 1.5 }}>
                Nobody has named it yet.<br />Whatever you call it could stick.
              </p>
            ) : data.names.map(row => (
              <NameRow key={row.id} row={row} avatar={data.snoovatars[row.author]} />
            ))}
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, padding: short ? '6px 16px 8px' : '10px 16px 14px', borderTop: `1px solid ${BORDER}`, background: 'rgba(0,0,0,0.35)' }}>
        <div style={{ maxWidth: 560, margin: '0 auto' }}>
          {note && <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#fbbf24', textAlign: 'center' }}>{note}</p>}

          {editing ? (
            <form onSubmit={e => { e.preventDefault(); void publish(); }} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input
                value={draft}
                onChange={e => { setDraft(e.target.value); setNote(null); }}
                placeholder="Type a name…"
                maxLength={NAMECOLOR_CONFIG.maxNameLen * 2}
                autoFocus
                autoCapitalize="words"
                autoComplete="off"
                enterKeyHint="send"
                style={{
                  width: '100%', height: short ? 44 : 52, borderRadius: 14, outline: 'none', textAlign: 'center',
                  background: 'rgba(255,255,255,0.07)', border: `1px solid ${BORDER}`,
                  color: '#fff', fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em',
                }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => { setEditing(false); setDraft(''); }}
                  style={{ flexShrink: 0, height: short ? 42 : 48, padding: '0 18px', borderRadius: 999, background: 'rgba(255,255,255,0.07)', border: `1px solid ${BORDER}`, color: '#a1a1aa', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
                  Cancel
                </button>
                <button type="submit" disabled={busy || !draft.trim()}
                  style={{
                    flex: 1, height: short ? 42 : 48, borderRadius: 999, border: 'none', fontSize: 16, fontWeight: 900,
                    cursor: busy || !draft.trim() ? 'default' : 'pointer',
                    background: draft.trim() ? data.hex : 'rgba(255,255,255,0.08)',
                    color: draft.trim() ? inkOn(data.hex) : '#71717a',
                  }}>
                  {busy ? 'Publishing…' : 'Publish'}
                </button>
              </div>
              {!short && (
                <p style={{ margin: 0, fontSize: 10, color: '#52525b', textAlign: 'center', fontWeight: 600 }}>
                  Publishes as a comment from your account
                </p>
              )}
            </form>
          ) : (
            <button onClick={() => { setEditing(true); setNote(null); }}
              style={{
                width: '100%', height: short ? 44 : 52, borderRadius: 999, border: 'none', fontSize: 16, fontWeight: 900,
                cursor: 'pointer', background: data.hex, color: inkOn(data.hex),
              }}>
              {data.myNameCount ? 'Name it again' : 'Name it'}
            </button>
          )}

          {!editing && data.myNameCount > 0 && (
            <p style={{ margin: '7px 0 0', fontSize: 11, color: '#71717a', textAlign: 'center', fontWeight: 600 }}>
              {data.myNameCount} {data.myNameCount === 1 ? 'name' : 'names'} from you
              {data.userRank ? ` · your best sits at #${data.userRank}` : ''}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <NameColor />
  </StrictMode>
);
