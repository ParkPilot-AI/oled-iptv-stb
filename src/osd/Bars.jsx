// The playback bars drawn by the OSD: live channel banner and the film/episode bar.
import { imgUrl } from '../lib/api.js';
import { clock, duration, progressPct, epLabel } from '../lib/format.js';
import { Icon } from '../components/Icons.jsx';

export function LiveBanner({ st, epg, now }) {
  const it = st.item;
  const n = epg?.now;
  const nx = epg?.next;
  return (
    <div className="osd-banner">
      <div className="osd-logo">{it.icon ? <img src={imgUrl(it.icon, 240)} alt="" /> : <Icon name="live" size="3rem" />}</div>
      <div className="osd-main">
        <div className="osd-title">
          {it.num ? <span className="osd-num">{it.num}</span> : null}
          {it.name}
          <span className="osd-pos muted">
            {st.index + 1}/{st.total}
          </span>
        </div>
        {n ? (
          <>
            <div className="osd-now">
              <span className="tag">NOW</span> {n.title}
              <span className="muted">
                {clock(n.start)} – {clock(n.stop)}
              </span>
            </div>
            <div className="progress">
              <div style={{ width: `${progressPct(n.start, n.stop, now)}%` }} />
            </div>
          </>
        ) : (
          <div className="osd-now muted">No programme information</div>
        )}
        {nx && (
          <div className="osd-next muted">
            Next {clock(nx.start)} · {nx.title}
          </div>
        )}
      </div>
    </div>
  );
}

/** Title line for the bar: episodes show the series, trailers say so. */
export function vodTitle(it) {
  if (it.kind === 'trailer') return `${it.name} · Trailer`;
  return it.kind === 'episode' ? it.seriesName || it.name : it.name;
}

export function VodBar({ st }) {
  const it = st.item;
  const pct = st.dur ? (st.pos / st.dur) * 100 : 0;
  const sub = it.kind === 'episode' ? `${epLabel(it)}${it.name ? ` · ${it.name}` : ''}` : '';
  return (
    <div className="osd-banner osd-vod">
      <div className="osd-main">
        <div className="osd-title">
          <Icon name={st.paused ? 'pause' : 'play'} size="1.8rem" /> {vodTitle(it)}
        </div>
        {sub && <div className="osd-now muted">{sub}</div>}
        <div className="progress big">
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="osd-times">
          <span>{duration(st.pos)}</span>
          <span className="muted">{st.dur ? `-${duration(st.dur - st.pos)} · ends ${clock(Date.now() + (st.dur - st.pos) * 1000)}` : ''}</span>
          <span>{duration(st.dur)}</span>
        </div>
      </div>
    </div>
  );
}
