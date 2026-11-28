import { lazy, Suspense, useEffect, useRef } from 'react';
import { useStore, setState, boot, toggleFavorite, favRegistry, activateProfile, getState, powerOff } from './lib/store.js';
import { dispatchKey, useBack, useKeyHandler, keyAction } from './nav/keys.js';
import { VolumeHud, changeVolume } from './components/VolumeHud.jsx';
import { focusFirst, focusGroup, focusByKey } from './nav/spatial.js';
import { NavRail } from './components/NavRail.jsx';
import { ConfirmHost, ToastHost, usePixelShift } from './components/Modal.jsx';
import { Screensaver, useIdle } from './components/Screensaver.jsx';
import { Focusable } from './components/Focusable.jsx';
import { Login } from './views/Login.jsx';
import { Home } from './views/Home.jsx';
import { LiveTV } from './views/LiveTV.jsx';
import { Library } from './views/Library.jsx';
import { Favorites } from './views/Favorites.jsx';
import { Search } from './views/Search.jsx';
import { Settings } from './views/Settings.jsx';
import { MovieDetail } from './views/MovieDetail.jsx';
import { SeriesDetail } from './views/SeriesDetail.jsx';

const OsdApp = lazy(() => import('./osd/OsdApp.jsx'));

export default function App() {
  if (location.hash.startsWith('#osd')) {
    return (
      <Suspense fallback={null}>
        <OsdApp />
      </Suspense>
    );
  }
  return <MainApp />;
}

const UI_SCREENSAVER_MS = 10 * 60 * 1000;

function MainApp() {
  const bootState = useStore((s) => s.boot);
  const rootRef = useRef(null);
  const [idle, setIdle] = useIdle(UI_SCREENSAVER_MS);
  const idleRef = useRef(idle);
  idleRef.current = idle;
  usePixelShift(rootRef);

  useEffect(() => {
    boot().catch((e) => setState({ boot: 'login', catalogStatus: { error: e.message } }));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      const act = keyAction(e);
      if (act === 'volUp' || act === 'volDown' || act === 'mute') {
        e.preventDefault();
        changeVolume(act);
        return;
      }
      if (idleRef.current) {
        // First key only wakes the screen.
        e.preventDefault();
        setIdle(false);
        return;
      }
      dispatchKey(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setIdle]);

  // Global: F toggles favorite on the focused item.
  useKeyHandler(
    (action) => {
      if (action !== 'fav') return false;
      const item = favRegistry.get(document.activeElement?.dataset?.fav);
      if (item) toggleFavorite(item);
      return !!item;
    },
    { priority: -10 }
  );

  return (
    <div className="app" ref={rootRef}>
      {bootState === 'loading' && <Splash text="Starting…" />}
      {bootState === 'login' && <Login />}
      {bootState === 'catalog' && <CatalogLoading />}
      {bootState === 'ready' && <Shell />}
      <ConfirmHost />
      <ToastHost />
      <VolumeHud />
      {idle && <Screensaver />}
    </div>
  );
}

function Splash({ text }) {
  return (
    <div className="splash">
      <div className="spinner" />
      <p>{text}</p>
    </div>
  );
}

function CatalogLoading() {
  const st = useStore((s) => s.catalogStatus);
  const pid = useStore((s) => s.profileId);
  const ref = useRef(null);
  useEffect(() => {
    if (st.error) requestAnimationFrame(() => focusFirst(ref.current));
  }, [st.error]);
  if (!st.error) return <Splash text={st.stage || 'Loading playlist…'} />;
  return (
    <div className="splash" ref={ref}>
      <h2>Couldn’t load the playlist</h2>
      <p className="error-text">{st.error}</p>
      <div className="row-buttons">
        <Focusable className="btn btn-primary" autoFocus onSelect={() => activateProfile(pid)}>
          Retry
        </Focusable>
        <Focusable className="btn" onSelect={() => setState({ boot: 'login' })}>
          Change playlist
        </Focusable>
      </div>
    </div>
  );
}

function Shell() {
  const section = useStore((s) => s.section);
  const detail = useStore((s) => s.detail);
  const contentRef = useRef(null);

  useEffect(() => {
    requestAnimationFrame(() => focusFirst(contentRef.current));
  }, []);

  // Base back behaviour: content → rail → exit confirmation.
  useBack(
    () => {
      const inRail = document.activeElement?.closest('.rail');
      if (!inRail) {
        focusByKey(`rail-${getState().section}`) || focusGroup('rail');
        return true;
      }
      powerOff();
      return true;
    },
    { priority: -100 }
  );

  const View = { home: Home, live: LiveTV, movies: Library, series: Library, favorites: Favorites, search: Search, settings: Settings }[section];

  return (
    <div className="shell">
      <NavRail section={section} onSelect={(id) => setState({ section: id, detail: null })} />
      <main className="content" ref={contentRef} key={section}>
        <View section={section === 'series' ? 'series' : 'vod'} />
      </main>
      {detail?.kind === 'movie' && <MovieDetail item={detail.item} />}
      {detail?.kind === 'series' && <SeriesDetail item={detail.item} />}
    </div>
  );
}
