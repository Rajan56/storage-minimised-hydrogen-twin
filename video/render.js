// render.js: renders animation.html to MP4 (1920x1080, 30 fps) with Playwright + ffmpeg.
// Usage:  node render.js <out.mp4> [timemap.json voiceover.wav]
// With a time map, each video frame shows the animation at the mapped time, so the
// scenes stretch to fit the narration; the voiceover is muxed in as AAC.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');

(async () => {
  const [out, mapFile, audio] = process.argv.slice(2);
  const FPS = 30;
  let total = 108.4, pts = [[0, 0], [108.4, 108.4]];
  if (mapFile) { const m = JSON.parse(fs.readFileSync(mapFile, 'utf8')); total = m.total; pts = m.points; }
  const animTime = T => {
    for (let i = 1; i < pts.length; i++) {
      const [T0, t0] = pts[i - 1], [T1, t1] = pts[i];
      if (T <= T1) return T1 === T0 ? t1 : t0 + (t1 - t0) * (T - T0) / (T1 - T0);
    }
    return pts[pts.length - 1][1];
  };
  const N = Math.round(total * FPS);
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto('file://' + __dirname + '/animation.html?static');
  const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-'];
  if (audio) args.push('-i', audio, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '160k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-shortest', out);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let i = 0; i < N; i++) {
    await p.evaluate(t => render(t), Math.min(pts[pts.length - 1][1] - 0.001, animTime(i / FPS)));
    const buf = await p.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if (i % 600 === 0) console.log('frame', i, 'of', N);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await b.close();
  console.log('done', out);
})();
