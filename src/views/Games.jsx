import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { toast, useStore } from '../lib/store.js';
import { Focusable } from '../components/Focusable.jsx';
import { Icon } from '../components/Icons.jsx';
import { JobModal, useProvision } from '../components/SystemUpdate.jsx';
import { useControllers, connectedPadText } from '../lib/controllers.js';
import { useGamepads } from '../lib/gamepad.js';

/** Games: launches NVIDIA's GeForce NOW app full screen; ONYX comes back when it closes. */
export function Games() {
  const [st, setSt] = useState(null);
  const [job, setJob] = useState(null); // 'games' | 'provision'
  const running = useStore((s) => s.gamesRunning);
  const bt = useControllers(true);
  const usbPads = useGamepads();
  const { st: prov, refresh: refreshProv } = useProvision();
  const refresh = () =>
    api
      .invoke('games:status')
      .then(setSt)
      .catch(() => setSt({ installed: false, error: true }));
  useEffect(() => {
    refresh();
  }, [running]);

  const needsProvision = prov?.needed && st?.platform !== 'win32';
  const win = st?.platform === 'win32';
  const play = async () => {
    try {
      await api.invoke('games:launch');
    } catch (e) {
      toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
    }
  };

  let primary;
  if (!st) primary = null;
  else if (needsProvision)
    primary = (
      <Focusable className="btn btn-primary games-play" autoFocus onSelect={() => setJob('provision')}>
        Finish installing the update
      </Focusable>
    );
  else if (st.installed)
    primary = (
      <Focusable className="btn btn-primary games-play" autoFocus onSelect={play}>
        <Icon name="play" size="2rem" /> {running ? 'GeForce NOW is open' : 'Play GeForce NOW'}
      </Focusable>
    );
  else if (st.platform === 'linux' || win)
    primary = (
      <Focusable className="btn btn-primary games-play" autoFocus onSelect={() => (win ? api.invoke('games:install') : setJob('games'))}>
        {win ? 'Get GeForce NOW from NVIDIA' : 'Install GeForce NOW'}
      </Focusable>
    );

  return (
    <div className="games">
      <header className="page-head">
        <h1>Games</h1>
      </header>
      <section className="games-hero">
        <Icon name="gamepad" size="5rem" />
        <div className="games-copy">
          <h2>GeForce NOW</h2>
          <p>Stream PC games from NVIDIA’s cloud. Your library from Steam, Epic, Ubisoft and others plays at up to 4K.</p>
          {st?.version && <p className="muted">Version {st.version}</p>}
          {needsProvision && <p className="games-note">This box needs the rest of the update before games can be installed.</p>}
          {st && !st.installed && st.platform !== 'linux' && !win && <p className="games-note">Games are available on the ONYX box and on Windows.</p>}
          <div className="games-actions">{primary}</div>
        </div>
      </section>
      <section className="games-info">
        <div>
          <h3>Controller</h3>
          <p>{connectedPadText(bt, usbPads) || 'No controller found. Plug one in by USB (then press any button), or pair one in Settings → Controllers.'}</p>
        </div>
        <div>
          <h3>Account</h3>
          <p>Sign in with your NVIDIA account the first time. A free or paid membership is needed.</p>
        </div>
        <div>
          <h3>Network</h3>
          <p>Use a wired connection if you can. NVIDIA recommends at least 25 Mbps for 1080p at 60 fps and 40 Mbps for 4K at 60 fps.</p>
        </div>
        <div>
          <h3>Getting back</h3>
          <p>Quit GeForce NOW to return here. If it gets stuck, press Ctrl+Alt+Home on a keyboard (or Home on the remote).</p>
        </div>
      </section>
      {job && (
        <JobModal
          job={job}
          onClose={() => setJob(null)}
          onFinished={() => {
            refresh();
            refreshProv();
          }}
        />
      )}
    </div>
  );
}
