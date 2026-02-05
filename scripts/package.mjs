import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stage = path.join(root, 'dist-app');

const run = (command, args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}`));
    });
  });

const copyDir = async (from, to) => {
  await fs.mkdir(to, { recursive: true });
  await fs.cp(from, to, { recursive: true });
};

const main = async () => {
  const dist = path.join(root, 'dist');
  const distElectron = path.join(root, 'dist-electron');

  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });

  await copyDir(dist, path.join(stage, 'dist'));
  await copyDir(distElectron, path.join(stage, 'dist-electron'));

  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const appPkg = {
    name: pkg.name,
    version: pkg.version,
    private: true,
    main: pkg.main,
    description: pkg.description,
    author: pkg.author,
    dependencies: pkg.dependencies,
  };

  await fs.writeFile(path.join(stage, 'package.json'), `${JSON.stringify(appPkg, null, 2)}\n`);

  await run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: stage });
  await run('pnpm', ['exec', 'electron-builder', '--mac'], { cwd: root });
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
