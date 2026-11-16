// Development: rebuild pages + content scripts on change. Reload the extension at chrome://extensions.
import { spawn } from 'node:child_process';
const run = (cmd, args) => spawn(cmd, args, { stdio: 'inherit', shell: true });
run('npx', ['vite', 'build', '--watch', '--mode', 'development']);
setTimeout(() => {
  run('node', ['scripts/build-content.mjs', '--watch']);
  run('node', ['scripts/copy-ocr-assets.mjs']);
}, 4000);
