export type GcsBucket = {
  name: string;
  location?: string;
};

export type GcsObject = {
  name: string;
  size: number;
  updated?: string;
  contentType?: string;
  storageClass?: string;
};

export type ListObjectsRequest = {
  bucket: string;
  prefix?: string;
  delimiter?: string;
  pageToken?: string;
  pageSize?: number;
};

export type ListObjectsResponse = {
  prefixes: string[];
  files: GcsObject[];
  nextPageToken?: string;
};

export type DownloadRequest = {
  bucket: string;
  name: string;
  isPrefix?: boolean;
};

export type DownloadManyRequest = {
  bucket: string;
  names: string[];
  basePrefix?: string;
};

export type UploadRequest = {
  bucket: string;
  prefix?: string;
  paths: string[];
};

export type StartDragRequest = {
  bucket: string;
  name: string;
};

export type DeleteRequest = {
  bucket: string;
  names: string[];
};

export type CreateFolderRequest = {
  bucket: string;
  prefix: string;
  name: string;
};
