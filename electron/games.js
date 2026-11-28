// Games: launches NVIDIA's official GeForce NOW app and brings ONYX back when it
// closes. Linux (the box): the Flatpak `com.nvidia.geforcenow` (installed by
// `stb-update games install`), run as the kiosk user. Windows: the GeForce NOW app
// if installed, otherwise a link to NVIDIA's download page.
import path from 'node:path';

export const GFN_APP_ID = 'com.nvidia.geforcenow';
export const GFN_DOWNLOAD_URL = 'https://www.nvidia.com/en-gb/geforce-now/download/';
// Windows installer's uninstall entry (its DisplayIcon / InstallLocation point at the app).
export const GFN_WIN_UNINSTALL_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{B2FE1952-0186-46C3-BAEC-A80AA35AC5B8}_GeforceNOW';

/** Usual Windows install locations of GeForceNOW.exe, most likely first. */
export function windowsCandidates(env = process.env) {
  const out = [];
  const w = path.win32;
  if (env.LOCALAPPDATA) out.push(w.join(env.LOCALAPPDATA, 'NVIDIA Corporation', 'GeForceNOW', 'CEF', 'GeForceNOW.exe'));
  for (const pf of [env.ProgramFiles, env['ProgramFiles(x86)']]) if (pf) out.push(w.join(pf, 'NVIDIA Corporation', 'GeForceNOW', 'CEF', 'GeForceNOW.exe'));
  return out;
}

/** Path to GeForceNOW.exe from `reg query` output (DisplayIcon or InstallLocation), or null. */
export function exeFromRegistry(regOutput) {
  const val = (name) => new RegExp(`^\\s*${name}\\s+REG_\\w+\\s+(.+?)\\s*$`, 'mi').exec(regOutput || '')?.[1];
  const icon = val('DisplayIcon')?.replace(/^"|"?(,\d+)?$/g, '');
  if (icon && /GeForceNOW\.exe$/i.test(icon)) return icon;
  const dir = val('InstallLocation')?.replace(/^"|"$/g, '');
  return dir ? path.win32.join(dir, 'CEF', 'GeForceNOW.exe') : null;
}

/**
 * deps: { platform, exec(cmd, args) → Promise<{code, stdout}>, spawn(cmd, args, opts) → child,
 *         exists(path), env, ui: { hide(), show(), stopPlayer(), send(channel, data) },
 *         sleep(ms), isRunningWin() → Promise<bool> }
 */
export function createGames(deps) {
  const { platform = process.platform, ui } = deps;
  let child = null;
  let running = false;

  async function findWindowsExe() {
    const r = await deps.exec('reg', ['query', GFN_WIN_UNINSTALL_KEY]).catch(() => ({ code: 1, stdout: '' }));
    const fromReg = r.code === 0 ? exeFromRegistry(r.stdout) : null;
    for (const p of [fromReg, ...windowsCandidates(deps.env || process.env)]) if (p && deps.exists(p)) return p;
    return null;
  }

  async function status() {
    if (platform === 'win32') {
      const exe = await findWindowsExe();
      return { platform, installed: !!exe, exe, downloadUrl: GFN_DOWNLOAD_URL, running };
    }
    if (platform !== 'linux') return { platform, installed: false, supported: false, running };
    const r = await deps.exec('flatpak', ['info', '--system', GFN_APP_ID]).catch(() => ({ code: 127, stdout: '' }));
    const version = /^\s*Version:\s*(\S+)/m.exec(r.stdout || '')?.[1] || null;
    return { platform, installed: r.code === 0, version, flatpak: r.code !== 127, running };
  }

  function finish(code) {
    if (!running) return;
    running = false;
    child = null;
    ui.show();
    ui.send('games:state', { running: false, code });
  }

  async function launch() {
    if (running) return { running: true };
    const st = await status();
    if (!st.installed) throw new Error(platform === 'win32' ? 'GeForce NOW isn’t installed' : 'Install GeForce NOW first');
    await ui.stopPlayer();
    const [cmd, args] = platform === 'win32' ? [st.exe, []] : ['flatpak', ['run', GFN_APP_ID]];
    child = deps.spawn(cmd, args, { stdio: 'ignore', detached: false });
    running = true;
    ui.hide();
    ui.send('games:state', { running: true });
    child.on('error', () => finish(-1));
    child.on('exit', async (code) => {
      // On Windows the launcher can hand over to another process and exit at once:
      // keep ONYX hidden until GeForceNOW.exe has really gone.
      if (platform === 'win32' && deps.isRunningWin) {
        while (await deps.isRunningWin()) await deps.sleep(3000);
      }
      finish(code);
    });
    return { running: true };
  }

  return { status, launch, isRunning: () => running, kill: () => child?.kill() };
}
