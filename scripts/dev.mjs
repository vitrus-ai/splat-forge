import net from 'net';
import { spawn } from 'child_process';

async function getFreePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => res(port));
    });
    srv.on('error', rej);
  });
}

(async () => {
  const port = await getFreePort();
  console.log(`[dev.mjs] Found free port for React/Vite: ${port}`);
  
  const child = spawn('npx', ['tauri', 'dev', '--config', JSON.stringify({
    build: {
      devUrl: `http://localhost:${port}`
    }
  })], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: port.toString()
    }
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
})();