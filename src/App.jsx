import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore, setState, boot, toggleFavorite, favRegistry, activateProfile, getState, powerOff, toast } from './lib/store.js';
import { dispatchKey, dispatchKeyUp, setLongPressHandler, useBack, useKeyHandler, keyAction } from './nav/keys.js';
import { VolumeHud, changeVolume } from './components/VolumeHud.jsx';
import { JobModal, useProvision } from './components/SystemUpdate.jsx';
import { startControllerWatch, btJustConnected } from './lib/controllers.js';
import { startGamepadNav, padName } from './lib/gamepad.js';
import { noteInput, configureFeedback } from './lib/feedback.js';
import { HintBar } from './components/HintBar.jsx';
import { api } from './lib/api.js';
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
import { Games } from './views/Games.jsx';
import { WhoIsWatching } from './views/WhoIsWatching.jsx';
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
  const fbSettings = useStore((s) => s.settings);
  useEffect(() => configureFeedback(fbSettings || {}), [fbSettings]);
  // While GeForce NOW has the screen, ONYX is hidden: no screensaver or pixel shift.
  const gamesRunning = useStore((s) => s.gamesRunning);
  const [idle, setIdle] = useIdle(UI_SCREENSAVER_MS, !gamesRunning);
  const idleRef = useRef(idle);
  idleRef.current = idle;
  usePixelShift(rootRef, 120000, !gamesRunning);
  // Game controllers (USB or Bluetooth) drive the menus like a remote.
  useEffect(() => {
    const stop = startGamepadNav({ enabled: () => !getState().gamesRunning });
    const onConnect = (e) => {
      const name = padName(e.gamepad?.id);
      // Bluetooth pads already get a toast (with battery) from the Bluetooth watch.
      setTimeout(() => !getState().gamesRunning && !btJustConnected() && toast(`Controller connected · ${name}`, 4000), 2500);
    };
    const onGone = (e) => !getState().gamesRunning && !btJustConnected(60000) && toast(`Controller disconnected · ${padName(e.gamepad?.id)}`, 4000);
    window.addEventListener('gamepadconnected', onConnect);
    window.addEventListener('gamepaddisconnected', onGone);
    return () => {
      stop();
      window.removeEventListener('gamepadconnected', onConnect);
      window.removeEventListener('gamepaddisconnected', onGone);
    };
  }, []);
  useEffect(
    () =>
      api.on('games:state', ({ running }) => {
        setState({ gamesRunning: running });
        // Back from GeForce NOW: focus returns to the Games item in the menu.
        if (!running) requestAnimationFrame(() => focusByKey('rail-games') || focusGroup('rail'));
      }),
    []
  );

  useEffect(() => {
    boot().catch((e) => setState({ boot: 'login', catalogStatus: { error: e.message } }));
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      noteInput(e);
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
    const onKeyUp = (e) => !idleRef.current && dispatchKeyUp(e);
    // Hold OK on a card → add/remove Favourites (no F key needed on a remote).
    setLongPressHandler((el) => {
      const item = favRegistry.get(el.dataset.fav);
      if (item) toggleFavorite(item);
    });
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      setLongPressHandler(null);
    };
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
      {bootState === 'viewer' && <WhoIsWatching />}
      {bootState === 'login' && <Login />}
      {bootState === 'catalog' && <CatalogLoading />}
      {bootState === 'ready' && <Shell />}
      {bootState === 'ready' && <ProvisionPrompt />}
      {bootState === 'ready' && <ControllerWatch />}
      <ConfirmHost />
      <ToastHost />
      {bootState === 'ready' && <DockCaption />}
      {bootState === 'ready' && <HintBar />}
      <VolumeHud />
      {idle && <Screensaver />}
    </div>
  );
}

/**
 * Boxes upgraded to 1.2 by the 1.1 updater are missing Bluetooth/Flatpak until
 * 'stb-update provision' runs: ask once (it stays in Settings → System after that).
 */
/** Watch controllers in the background (connect/disconnect toasts). */
function ControllerWatch() {
  useEffect(() => startControllerWatch(), []);
  return null;
}

function ProvisionPrompt() {
  const settings = useStore((s) => s.settings);
  const { st, refresh } = useProvision();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (st?.needed && !settings?.provisionPrompted) {
      setOpen(true);
      api.invoke('settings:update', { provisionPrompted: true }).then((s) => setState({ settings: s }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.needed]);
  if (!open) return null;
  return <JobModal job="provision" onClose={() => setOpen(false)} onFinished={refresh} />;
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

/** Caption above the mini-player (the video itself is mpv's window, floating above). */
function DockCaption() {
  const d = useStore((s) => s.docked);
  if (!d || d.mode !== 'dock') return null;
  const it = d.item || {};
  return (
    <div className="dock-caption">
      <span className="live-dot" />
      {it.num ? `${it.num} · ` : ''}
      {it.name || 'Now playing'}
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

  // Mini-player / trailer preview: Play/Pause (X on a controller) goes back to
  // full screen, Stop closes it.
  useKeyHandler(
    (action) => {
      const d = getState().docked;
      if (!d) return false;
      if (action === 'playPause') {
        api.invoke('player:command', { type: d.mode === 'peek' ? 'stop' : 'undock' }).catch(() => {});
        return true;
      }
      if (action === 'stop') {
        api.invoke('player:command', { type: 'stop' }).catch(() => {});
        return true;
      }
      return false;
    },
    { priority: 40 }
  );

  // Base back behaviour: content → rail → (close the mini-player) → exit confirmation.
  useBack(
    () => {
      const inRail = document.activeElement?.closest('.rail');
      if (!inRail) {
        focusByKey(`rail-${getState().section}`) || focusGroup('rail');
        return true;
      }
      if (getState().docked) {
        api.invoke('player:command', { type: 'stop' }).catch(() => {});
        return true;
      }
      powerOff();
      return true;
    },
    { priority: -100 }
  );

  const View = { home: Home, live: LiveTV, movies: Library, series: Library, favorites: Favorites, search: Search, settings: Settings, games: Games }[section];

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
