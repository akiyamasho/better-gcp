import { Storage } from '@google-cloud/storage';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { GcsBucket, GcsObject, ListObjectsRequest, ListObjectsResponse, UploadRequest } from './types';

const storage = new Storage();

const normalizePrefix = (prefix?: string) => {
  if (!prefix) return '';
  return prefix.endsWith('/') ? prefix : `${prefix}/`;
};

const toPosix = (value: string) => value.split(path.sep).join('/');

export const listBuckets = async (projectId?: string): Promise<GcsBucket[]> => {
  const client = projectId ? new Storage({ projectId }) : storage;
  const [buckets] = await client.getBuckets();
  return buckets.map((bucket) => ({
    name: bucket.name,
    location: bucket.metadata?.location,
  }));
};

export const listObjects = async (req: ListObjectsRequest): Promise<ListObjectsResponse> => {
  const { bucket, prefix = '', delimiter = '/', pageToken, pageSize = 200 } = req;
  const bucketRef = storage.bucket(bucket);
  const [files, nextQuery, apiResponse] = await bucketRef.getFiles({
    prefix,
    delimiter,
    pageToken,
    maxResults: pageSize,
    autoPaginate: false,
  });

  const prefixes = (apiResponse as { prefixes?: string[] })?.prefixes ?? [];

  const mapped: GcsObject[] = files
    .filter((file) => {
      if (!file.name) return false;
      if (!file.name.endsWith('/')) return true;
      const size = Number(file.metadata?.size ?? 0);
      return size > 0;
    })
    .map((file) => ({
      name: file.name,
      size: Number(file.metadata?.size ?? 0),
      updated: file.metadata?.updated,
      contentType: file.metadata?.contentType,
      storageClass: file.metadata?.storageClass,
    }));

  return {
    prefixes,
    files: mapped,
    nextPageToken: nextQuery?.pageToken,
  };
};

export const downloadObjectToPath = async (bucket: string, name: string, destinationPath: string) => {
  const bucketRef = storage.bucket(bucket);
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await bucketRef.file(name).download({ destination: destinationPath });
  return destinationPath;
};

export const downloadPrefix = async (bucket: string, prefix: string, destinationDir: string) => {
  const bucketRef = storage.bucket(bucket);
  const normalized = normalizePrefix(prefix);
  const [files] = await bucketRef.getFiles({ prefix: normalized });
  for (const file of files) {
    if (file.name.endsWith('/')) continue;
    const relative = file.name.startsWith(normalized)
      ? file.name.slice(normalized.length)
      : file.name;
    const destinationPath = path.join(destinationDir, relative);
    await downloadObjectToPath(bucket, file.name, destinationPath);
  }
};

export const downloadObjectsToDir = async (
  bucket: string,
  names: string[],
  destinationDir: string,
  basePrefix?: string
) => {
  const normalizedBase = normalizePrefix(basePrefix);
  for (const name of names) {
    if (!name) continue;
    const relative = normalizedBase && name.startsWith(normalizedBase)
      ? name.slice(normalizedBase.length)
      : path.basename(name);
    const safeRelative = relative.replace(/^[/\\]+/, '');
    const destinationPath = path.join(destinationDir, safeRelative);
    await downloadObjectToPath(bucket, name, destinationPath);
  }
};

export const downloadToTemp = async (bucket: string, name: string) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'better-gcs-'));
  const fileName = path.basename(name);
  const destination = path.join(tempDir, fileName);
  await downloadObjectToPath(bucket, name, destination);
  return destination;
};

const walkDir = async (dir: string): Promise<string[]> => {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDir(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
};

export const uploadPaths = async (req: UploadRequest) => {
  const { bucket, prefix = '', paths } = req;
  const normalizedPrefix = normalizePrefix(prefix);
  const bucketRef = storage.bucket(bucket);

  for (const entryPath of paths) {
    const stats = await fs.stat(entryPath);
    if (stats.isDirectory()) {
      const baseName = path.basename(entryPath);
      const files = await walkDir(entryPath);
      for (const filePath of files) {
        const relative = toPosix(path.relative(entryPath, filePath));
        const destination = `${normalizedPrefix}${baseName}/${relative}`;
        await bucketRef.upload(filePath, { destination });
      }
    } else if (stats.isFile()) {
      const fileName = path.basename(entryPath);
      const destination = `${normalizedPrefix}${fileName}`;
      await bucketRef.upload(entryPath, { destination });
    }
  }
};

export const deleteObjects = async (bucket: string, names: string[]) => {
  const bucketRef = storage.bucket(bucket);
  for (const name of names) {
    await bucketRef.file(name).delete({ ignoreNotFound: true });
  }
};

export const createFolder = async (bucket: string, prefix: string, name: string) => {
  const bucketRef = storage.bucket(bucket);
  const normalizedPrefix = normalizePrefix(prefix);
  const trimmed = name.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) throw new Error('Folder name is required');
  const folderPath = `${normalizedPrefix}${trimmed}/`;
  await bucketRef.file(folderPath).save('');
};

export const renamePrefix = async (bucket: string, oldPrefix: string, newName: string) => {
  const bucketRef = storage.bucket(bucket);
  const oldNormalized = normalizePrefix(oldPrefix);
  const trimmed = newName.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) throw new Error('New folder name is required');

  // Extract parent prefix
  const parts = oldNormalized.split('/').filter(Boolean);
  parts.pop(); // Remove the last folder name
  const parentPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
  const newNormalized = `${parentPrefix}${trimmed}/`;

  if (oldNormalized === newNormalized) return;

  // Copy all files from old prefix to new prefix
  const [files] = await bucketRef.getFiles({ prefix: oldNormalized });

  for (const file of files) {
    const relativePath = file.name.slice(oldNormalized.length);
    const newPath = `${newNormalized}${relativePath}`;
    await file.copy(bucketRef.file(newPath));
  }

  // Delete all files with old prefix
  for (const file of files) {
    await file.delete({ ignoreNotFound: true });
  }
};
