import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export interface Person {
  name: string;
  role?: string;
  photo?: string;
  /** Bands: when they were in it. */
  years?: string;
  current?: boolean;
  /** TV: the leads, or everyone else. */
  group?: 'main' | 'supporting';
  episodes?: number;
  /** Dimmed: hidden from the viewer but shown while editing. */
  dim?: boolean;
  /** An administrator changed this one. */
  edited?: boolean;
}

const initials = (name: string) => name.split(/\s+/).map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();

function Card({ person, link, extra }: { person: Person; link: boolean; extra?: ReactNode }) {
  const [broken, setBroken] = useState(false);
  const body = (
    <>
      {person.photo && !broken
        ? <img className="person-photo" src={person.photo} alt="" loading="lazy" onError={() => setBroken(true)} />
        : <span className="person-photo person-photo--empty" aria-hidden="true">{initials(person.name)}</span>}
      <span className="person-name">{person.name}</span>
      {(person.role || person.years) && <span className="person-role">{[person.role, person.years].filter(Boolean).join(' · ')}</span>}
    </>
  );
  const cls = `person${person.dim ? ' is-dim' : ''}`;
  const face = link ? <Link className="person-face" to={`/people/${encodeURIComponent(person.name)}`}>{body}</Link> : <div className="person-face">{body}</div>;
  return <div className={cls}>{face}{extra}</div>;
}

function Rail({ people, link, all, extra }: { people: Person[]; link: boolean; all: boolean; extra?: (p: Person) => ReactNode }) {
  return <div className={`people-rail${all ? ' people-rail--wrap' : ''}`}>{people.map((p, i) => <Card key={`${p.name}-${i}`} person={p} link={link} extra={extra?.(p)} />)}</div>;
}

const SHOWN = 14;

/**
 * People in a film, a series or a band. Shows the first few in a row you can
 * scroll, with "Show all" for the rest. TV cast splits into the leads and the
 * supporting cast; a band into current and former members.
 */
export function CastRow({ title, people, loading, link = false, empty, inPage = false, toolbar, cardExtra }: { title: string; people: Person[]; loading?: boolean; link?: boolean; empty?: string; /** Controls shown beside the heading. */ toolbar?: ReactNode; /** Something under each card (edit controls). */ cardExtra?: (p: Person) => ReactNode; /** On film and TV pages the row sits in the same padded column as the other sections. */ inPage?: boolean }) {
  const cls = `people-section${inPage ? ' page' : ''}`;
  const [all, setAll] = useState(false);
  if (loading && people.length === 0) {
    return (
      <section className={cls} aria-label={title} aria-busy="true">
        <div className="rail-head"><h2 className="rail-title">{title}</h2></div>
        <div className="people-rail" aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <div key={i} className="person person--skeleton"><span className="person-photo" /><span className="person-name" /></div>)}</div>
      </section>
    );
  }
  if (people.length === 0) return empty ? <section className={cls}><div className="rail-head"><h2 className="rail-title">{title}</h2></div><p className="people-empty">{empty}</p></section> : null;

  const tv = people.some(p => p.group === 'supporting');
  const band = people.some(p => p.years !== undefined);
  const groups: Array<{ label?: string; list: Person[] }> = tv
    ? [{ list: people.filter(p => p.group !== 'supporting') }, { label: 'Supporting cast', list: people.filter(p => p.group === 'supporting') }]
    : band && people.some(p => p.current === false)
      ? [{ list: people.filter(p => p.current !== false) }, { label: 'Former members', list: people.filter(p => p.current === false) }]
      : [{ list: people }];
  const total = people.length;
  const limited = !all && total > SHOWN;
  let budget = limited ? SHOWN : Infinity;

  return (
    <section className={cls} aria-label={title}>
      <div className="rail-head">
        <h2 className="rail-title">{title}</h2>
        <div className="rail-tools">{toolbar}{total > SHOWN && <button type="button" className="mp-link" onClick={() => setAll(v => !v)} aria-expanded={all}>{all ? 'Show fewer' : `Show all ${total}`}</button>}</div>
      </div>
      {groups.filter(g => g.list.length > 0).map((g, gi) => {
        const list = g.list.slice(0, Math.max(0, budget));
        budget -= list.length;
        if (list.length === 0) return null;
        return (
          <div key={gi} className="people-group">
            {g.label && <h3 className="people-group-label">{g.label}</h3>}
            <Rail people={list} link={link} all={all} extra={cardExtra} />
          </div>
        );
      })}
    </section>
  );
}
