import { spawn } from 'node:child_process';

export default async function setup() {
  console.log('Running global setup: npm run build');
  await new Promise<void>((resolve, reject) => {
    const build = spawn('npm', ['run', 'build'], { stdio: 'inherit' });
    build.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Build failed with code ${code}`));
      }
    });
  });
}
