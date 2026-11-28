// "Type it on your phone": while the playlist form is open, a tiny one-time web
// form is served on the home network. The TV shows its address as a QR code; what
// the phone sends fills in the form on the TV (the person still presses Save).
// Only the random path is answered; it changes after every successful send.
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';

const MAX_BODY = 8 * 1024;

/** The TV's address on the home network (private IPv4 first), or null. */
export function lanAddress(ifaces = os.networkInterfaces()) {
  const all = Object.values(ifaces)
    .flat()
    .filter((a) => a && (a.family === 'IPv4' || a.family === 4) && !a.internal);
  const priv = (ip) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  return (all.find((a) => priv(a.address)) || all[0])?.address || null;
}

/** Parse and tidy the phone's form (url-encoded). Returns { fields } or { error }. */
export function parseSubmission(body) {
  const p = new URLSearchParams(body);
  const f = {
    name: (p.get('name') || '').trim().slice(0, 60),
    server: (p.get('server') || '').trim().slice(0, 300),
    username: (p.get('username') || '').trim().slice(0, 200),
    password: (p.get('password') || '').slice(0, 200),
  };
  if (!f.server || !f.username || !f.password) return { error: 'Server URL, username and password are all needed.' };
  if (!/^https?:\/\//i.test(f.server)) f.server = `http://${f.server}`;
  try {
    new URL(f.server);
  } catch {
    return { error: 'That server address doesn’t look right.' };
  }
  return { fields: f };
}

const page = (body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>ONYX · Add playlist</title>
<style>
body{margin:0;background:#000;color:#f5f5f5;font:16px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:28rem;margin:0 auto;padding:2rem 1.25rem}
h1{font-size:1.5rem;letter-spacing:.2em;margin:0 0 .25rem}p{color:#8e8e93;margin:.25rem 0 1.5rem}
label{display:block;font-size:.85rem;color:#8e8e93;margin:1rem 0 .35rem}
input{box-sizing:border-box;width:100%;padding:.85rem 1rem;border-radius:.7rem;border:1px solid #2a2a2e;background:#121214;color:#f5f5f5;font-size:1rem}
button{margin-top:1.75rem;width:100%;padding:1rem;border:0;border-radius:.8rem;background:#e50914;color:#fff;font-size:1.05rem;font-weight:600}
.ok{font-size:1.2rem;color:#f5f5f5}.err{color:#ff6b6b}
</style></head><body><main><h1>ONYX</h1>${body}</main></body></html>`;

const FORM = (error = '') =>
  page(`<p>Add an Xtream Codes playlist. It goes straight to your TV.</p>
${error ? `<p class="err">${error}</p>` : ''}
<form method="post" autocomplete="off">
<label for="n">Name (optional)</label><input id="n" name="name" placeholder="Living room">
<label for="s">Server URL</label><input id="s" name="server" inputmode="url" placeholder="http://provider.tv:8080" required autocapitalize="off" autocorrect="off">
<label for="u">Username</label><input id="u" name="username" required autocapitalize="off" autocorrect="off">
<label for="p">Password</label><input id="p" name="password" type="password" required>
<button type="submit">Send to TV</button></form>`);

const DONE = page('<p class="ok">Sent ✓</p><p>Check the TV and press <b>Save &amp; connect</b>.</p>');

/**
 * createPhoneLogin({ onSubmit(fields), address?() }) → { start() → {url}|{error}, stop() }.
 */
export function createPhoneLogin({ onSubmit, address = lanAddress, host = '0.0.0.0' }) {
  let server = null;
  let token = null;
  let port = 0;
  const newToken = () => (token = crypto.randomBytes(12).toString('hex'));
  const url = () => `http://${address()}:${port}/${token}`;

  const handler = (req, res) => {
    const send = (code, html) => {
      res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' });
      res.end(html);
    };
    if (req.url !== `/${token}`) return send(404, page('<p>This link has expired. Scan the code on the TV again.</p>'));
    if (req.method === 'GET') return send(200, FORM());
    if (req.method !== 'POST') return send(405, page('<p>Not allowed.</p>'));
    let body = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (d) => {
      body += d;
      if (body.length > MAX_BODY) {
        tooBig = true;
        req.destroy();
      }
    });
    req.on('end', () => {
      if (tooBig) return;
      const r = parseSubmission(body);
      if (r.error) return send(400, FORM(r.error));
      newToken(); // one use per code
      onSubmit(r.fields, url());
      send(200, DONE);
    });
  };

  return {
    async start() {
      if (!address()) return { error: 'Not connected to a network' };
      if (!server) {
        newToken();
        server = http.createServer(handler);
        await new Promise((resolve, reject) => {
          server.once('error', reject);
          server.listen(0, host, () => resolve());
        });
        port = server.address().port;
      }
      return { url: url() };
    },
    stop() {
      server?.close();
      server = null;
      token = null;
    },
  };
}
