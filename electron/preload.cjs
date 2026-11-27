// Sandboxed preload: exposes a minimal, whitelisted bridge as window.iptv.
const { contextBridge, ipcRenderer } = require('electron');

const INVOKE = new Set([
  'app:info', 'app:quit', 'app:toggleFullscreen',
  'profiles:list', 'profiles:save', 'profiles:delete', 'profiles:activate',
  'settings:get', 'settings:update',
  'catalog:load', 'epg:load', 'epg:nowNext', 'epg:range', 'epg:grid', 'epg:short',
  'vod:info', 'series:info', 'cache:clear',
  'art:get', 'art:testKey', 'art:refreshLogos',
  'doc:get', 'doc:set',
  'player:play', 'player:command', 'player:playlist',
]);
const EVENTS = new Set([
  'catalog:progress', 'catalog:updated', 'epg:progress', 'epg:updated',
  'player:closed', 'player:state', 'player:key',
]);

contextBridge.exposeInMainWorld('iptv', {
  async invoke(channel, arg) {
    if (!INVOKE.has(channel)) throw new Error(`Blocked channel ${channel}`);
    const res = await ipcRenderer.invoke(channel, arg);
    if (!res.ok) throw new Error(res.error);
    return res.data;
  },
  on(channel, cb) {
    if (!EVENTS.has(channel)) throw new Error(`Blocked event ${channel}`);
    const fn = (_e, data) => cb(data);
    ipcRenderer.on(channel, fn);
    return () => ipcRenderer.removeListener(channel, fn);
  },
});
