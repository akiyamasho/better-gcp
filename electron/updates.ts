import { app } from 'electron';
import { createWriteStream } from 'node:fs';
import { access, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { AppUpdateAsset, AppUpdateInfo } from './types';

const execFileAsync = promisify(execFile);

const RELEASE_API_URL = 'https://api.github.com/repos/akiyamasho/better-gcp/releases/latest';
const APP_SUFFIX = '.app';
const APPLICATIONS_DIR = '/Applications';

type GithubReleaseAsset = {
  name?: string;
  browser_download_url?: string;
};

type GithubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  body?: string;
  assets?: GithubReleaseAsset[];
};

const normalizeVersion = (value: string) =>
  value
    .trim()
    .replace(/^v/i, '')
    .split(/[+-]/, 1)[0];

const compareVersions = (left: string, right: string) => {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }

  return 0;
};

const isGithubRelease = (value: unknown): value is GithubRelease => {
  if (!value || typeof value !== 'object') return false;
  return 'tag_name' in value;
};

const requestJson = async (url: string) =>
  new Promise<unknown>((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'better-gcp-updater',
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 0;
        const location = response.headers.location;
        if (statusCode >= 300 && statusCode < 400 && location) {
          response.resume();
          void requestJson(location).then(resolve, reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`GitHub release request failed with status ${statusCode}`));
          return;
        }

        const chunks: Buffer[] = [];
        response.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        response.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      }
    );

    request.on('error', reject);
  });

const downloadToFile = async (url: string, destinationPath: string) =>
  new Promise<void>((resolve, reject) => {
    const request = https.get(
      url,
      {
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': 'better-gcp-updater',
        },
      },
      async (response) => {
        try {
          const statusCode = response.statusCode ?? 0;
          const location = response.headers.location;
          if (statusCode >= 300 && statusCode < 400 && location) {
            response.resume();
            await downloadToFile(location, destinationPath);
            resolve();
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            response.resume();
            reject(new Error(`DMG download failed with status ${statusCode}`));
            return;
          }

          await pipeline(response, createWriteStream(destinationPath));
          resolve();
        } catch (error) {
          reject(error);
        }
      }
    );

    request.on('error', reject);
  });

const pickDmgAsset = (assets: GithubReleaseAsset[] | undefined): AppUpdateAsset | undefined => {
  if (!assets?.length) return undefined;

  const dmgAssets = assets.filter(
    (asset): asset is Required<Pick<GithubReleaseAsset, 'name' | 'browser_download_url'>> =>
      Boolean(asset.name?.toLowerCase().endsWith('.dmg') && asset.browser_download_url)
  );
  if (!dmgAssets.length) return undefined;

  const preferredArch = process.arch === 'arm64' ? 'arm64' : process.arch;
  const exactMatch = dmgAssets.find((asset) => asset.name.toLowerCase().includes(preferredArch));
  const fallback = exactMatch ?? dmgAssets[0];

  return {
    name: fallback.name,
    downloadUrl: fallback.browser_download_url,
  };
};

const loadLatestRelease = async (): Promise<AppUpdateInfo> => {
  const payload = await requestJson(RELEASE_API_URL);
  if (!isGithubRelease(payload)) {
    throw new Error('Unexpected GitHub release response');
  }

  const latestVersion = normalizeVersion(payload.tag_name ?? payload.name ?? '');
  if (!latestVersion) {
    throw new Error('Latest release is missing a version tag');
  }

  const currentVersion = normalizeVersion(app.getVersion());
  const dmg = pickDmgAsset(payload.assets);

  return {
    currentVersion,
    latestVersion,
    releaseName: payload.name ?? `v${latestVersion}`,
    releaseUrl: payload.html_url ?? 'https://github.com/akiyamasho/better-gcp/releases/latest',
    publishedAt: payload.published_at ?? '',
    notes: payload.body ?? '',
    hasUpdate: compareVersions(currentVersion, latestVersion) < 0,
    dmg,
  };
};

const parseMountedVolumePath = (stdout: string) => {
  const match = stdout
    .split('\n')
    .map((line) => line.trim())
    .reverse()
    .find((line) => line.includes('/Volumes/'));

  if (!match) {
    throw new Error('Unable to determine mounted DMG volume path');
  }

  const volumePath = match.match(/\/Volumes\/.+$/)?.[0];
  if (!volumePath) {
    throw new Error('Unable to parse mounted DMG volume path');
  }

  return volumePath;
};

const findAppBundle = async (volumePath: string) => {
  const directPath = path.join(volumePath, `${app.getName()}${APP_SUFFIX}`);
  try {
    await access(directPath);
    return directPath;
  } catch {
    const entries = await readdir(volumePath);
    const appEntry = entries.find((entry) => entry.endsWith(APP_SUFFIX));
    if (!appEntry) {
      throw new Error('No .app bundle found in mounted DMG');
    }
    return path.join(volumePath, appEntry);
  }
};

const resolveCurrentBundlePath = () => {
  const executablePath = app.getPath('exe');
  const marker = `${APP_SUFFIX}${path.sep}`;
  const markerIndex = executablePath.indexOf(marker);
  if (markerIndex === -1) return undefined;
  return executablePath.slice(0, markerIndex + APP_SUFFIX.length);
};

const resolveInstallTarget = async () => {
  const currentBundlePath = resolveCurrentBundlePath();
  if (currentBundlePath && !currentBundlePath.startsWith('/Volumes/')) {
    return currentBundlePath;
  }

  return path.join(APPLICATIONS_DIR, `${app.getName()}${APP_SUFFIX}`);
};

const ensurePathExists = async (targetPath: string) => {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
};

const movePath = async (sourcePath: string, destinationPath: string) => {
  await execFileAsync('mv', [sourcePath, destinationPath]);
};

export const checkForUpdates = async () => loadLatestRelease();

export const installLatestUpdate = async () => {
  if (process.platform !== 'darwin') {
    throw new Error('Auto-update is only supported on macOS');
  }
  if (!app.isPackaged) {
    throw new Error('Auto-update is only available in the packaged app');
  }

  const release = await loadLatestRelease();
  if (!release.hasUpdate) {
    return { ok: true };
  }
  if (!release.dmg) {
    throw new Error('Latest release does not include a DMG asset');
  }

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'better-gcp-update-'));
  const downloadedDmgPath = path.join(tempRoot, release.dmg.name);
  const stagedAppPath = path.join(tempRoot, `${app.getName()}${APP_SUFFIX}`);
  const backupAppPath = path.join(tempRoot, `${app.getName()}-backup${APP_SUFFIX}`);
  const installTargetPath = await resolveInstallTarget();

  let mountedVolumePath: string | undefined;
  let movedExistingApp = false;

  try {
    await downloadToFile(release.dmg.downloadUrl, downloadedDmgPath);

    const { stdout } = await execFileAsync('hdiutil', ['attach', '-nobrowse', '-readonly', downloadedDmgPath]);
    mountedVolumePath = parseMountedVolumePath(stdout);

    const sourceAppPath = await findAppBundle(mountedVolumePath);
    await execFileAsync('ditto', [sourceAppPath, stagedAppPath]);

    const targetExists = await ensurePathExists(installTargetPath);
    if (targetExists) {
      await movePath(installTargetPath, backupAppPath);
      movedExistingApp = true;
    }

    await movePath(stagedAppPath, installTargetPath);
    await execFileAsync('xattr', ['-dr', 'com.apple.quarantine', installTargetPath]);

    if (movedExistingApp) {
      await rm(backupAppPath, { recursive: true, force: true });
    }

    if (mountedVolumePath) {
      await execFileAsync('hdiutil', ['detach', mountedVolumePath]);
      mountedVolumePath = undefined;
    }

    await execFileAsync('open', ['-n', installTargetPath]);
    setTimeout(() => app.quit(), 1000);
    return { ok: true };
  } catch (error) {
    if (!(await ensurePathExists(installTargetPath)) && movedExistingApp && (await ensurePathExists(backupAppPath))) {
      await movePath(backupAppPath, installTargetPath);
      movedExistingApp = false;
    }
    throw error;
  } finally {
    if (mountedVolumePath) {
      try {
        await execFileAsync('hdiutil', ['detach', mountedVolumePath]);
      } catch {
        // Ignore detach failures during cleanup.
      }
    }

    await rm(tempRoot, { recursive: true, force: true });
  }
};
