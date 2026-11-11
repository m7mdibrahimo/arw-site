// INCIDENTS #1235: vidmoly files that played at home were hidden from three show pages because the headless
// checker saw «JW Player Error 232011» and then «no stream seen». A stream that comes back when fetched directly
// is proof the server works.
import test from 'node:test';
import assert from 'node:assert/strict';
import { embedStream, streamProof } from '../scripts/check-playback.ts';

const PAGE = `<script>jwplayer("vplayer").setup({ sources: [{ file: 'https://prx-1.vmpx.online/hls2/03/x_,n,l,.urlset/master.m3u8?t=abc&s=1' }], image: "x.jpg" });</script>`;
const fake = (map: Record<string, { status?: number; type?: string; body?: string; size?: number }>) => async (u: string) => {
  const k = Object.keys(map).find(k => u.startsWith(k));
  const r = k ? map[k] : { status: 404 };
  return { status: r.status ?? 200, type: r.type ?? '', body: r.body ?? '', size: r.size ?? (r.body ?? '').length };
};

test('the stream a vidmoly page hands its player is read from the page', () => {
  assert.equal(embedStream(PAGE), 'https://prx-1.vmpx.online/hls2/03/x_,n,l,.urlset/master.m3u8?t=abc&s=1');
  assert.equal(embedStream('<html>File was deleted</html>'), null);
});

test('manifest, variant and a real piece of video = the server plays', async () => {
  const get = fake({
    'https://vidmoly.org/embed-a.html': { type: 'text/html', body: PAGE },
    'https://prx-1.vmpx.online/hls2/03/x_,n,l,.urlset/master.m3u8': { type: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttps://prx-1.vmpx.online/hls2/03/x_n/index-v1-a1.m3u8?t=1\n' },
    'https://prx-1.vmpx.online/hls2/03/x_n/index-v1-a1.m3u8': { type: 'application/vnd.apple.mpegurl', body: '#EXTM3U\n#EXTINF:10,\nseg-1-v1-a1.ts?t=1\n' },
    'https://prx-1.vmpx.online/hls2/03/x_n/seg-1': { type: 'video/mp2t', size: 1900000 },
  });
  assert.equal(await streamProof('https://vidmoly.org/embed-a.html', get), true);
});

test('a deleted file, a refused manifest or an empty piece proves nothing', async () => {
  assert.equal(await streamProof('https://vidmoly.org/embed-b.html', fake({ 'https://vidmoly.org/embed-b.html': { type: 'text/html', body: 'File was deleted' } })), false);
  assert.equal(await streamProof('https://vidmoly.org/embed-a.html', fake({ 'https://vidmoly.org/embed-a.html': { type: 'text/html', body: PAGE }, 'https://prx-1': { status: 403 } })), false);
  assert.equal(await streamProof('https://vidmoly.org/embed-a.html', fake({
    'https://vidmoly.org/embed-a.html': { type: 'text/html', body: PAGE },
    'https://prx-1.vmpx.online/hls2/03/x_,n,l,.urlset/master.m3u8': { type: 'application/vnd.apple.mpegurl', body: '#EXTM3U\nhttps://prx-1.vmpx.online/hls2/03/x_n/index.m3u8\n' },
    'https://prx-1.vmpx.online/hls2/03/x_n/index.m3u8': { type: 'application/vnd.apple.mpegurl', body: '#EXTM3U\nseg-1.ts\n' },
    'https://prx-1.vmpx.online/hls2/03/x_n/seg-1': { type: 'text/html', size: 120 },
  })), false);
  assert.equal(await streamProof('https://vidmoly.org/embed-c.html', async () => { throw new Error('network'); }), false);
});
