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

export type BqProject = {
  id: string;
  name: string;
};

export type BqDataset = {
  id: string;
  projectId: string;
};

export type BqTable = {
  id: string;
  datasetId: string;
  projectId: string;
  type: string;
};

export type BqTablePreview = {
  columns: string[];
  rows: string[][];
  totalRows: number;
};

export type BqQueryRequest = {
  query: string;
  projectId?: string;
};

export type BqQueryResult = {
  columns: string[];
  rows: string[][];
  totalRows: number;
  durationMs: number;
  bytesProcessed: number;
};

export type BqSavedQuery = {
  id: string;
  name: string;
  query: string;
  projectId?: string;
  createdAt: string;
};

export type VertexAICustomJob = {
  name: string;
  displayName: string;
  state: string;
  rawState: number;
  region: string;
  createTime: string;
  startTime?: string;
  endTime?: string;
  updateTime?: string;
  labels: Record<string, string>;
  error?: { code: number; message: string };
  workerPoolSpecs: VertexAIWorkerPoolSpec[];
  baseOutputDirectory?: string;
};

export type VertexAIWorkerPoolSpec = {
  replicaCount: string;
  machineSpec?: {
    machineType: string;
    acceleratorType?: string;
    acceleratorCount?: number;
  };
  diskSpec?: {
    bootDiskType: string;
    bootDiskSizeGb: number;
  };
  containerSpec?: {
    imageUri: string;
    env?: { name: string; value: string }[];
    command?: string[];
    args?: string[];
  };
};

export type ListCustomJobsRequest = {
  projectId: string;
  region: string;
  pageSize?: number;
  pageToken?: string;
};

export type ListCustomJobsResponse = {
  jobs: VertexAICustomJob[];
  nextPageToken?: string;
};

// Vertex AI Pipelines

export type PipelineTaskDetail = {
  taskId: string;
  taskName: string;
  state: string;
  createTime: string;
  startTime?: string;
  endTime?: string;
  executionName?: string;
  inputs: Record<string, string[]>;
  outputs: Record<string, string[]>;
  parentTaskId?: string;
  pipelineTaskStatus?: { state: string; updateTime: string }[];
  error?: { code: number; message: string };
};

export type PipelineJob = {
  name: string;
  displayName: string;
  state: string;
  rawState: number;
  region: string;
  createTime: string;
  startTime?: string;
  endTime?: string;
  updateTime?: string;
  labels: Record<string, string>;
  taskDetails: PipelineTaskDetail[];
  pipelineSpec?: any;
  templateUri?: string;
  templateMetadata?: { version?: string };
  runtimeConfig?: {
    parameters?: Record<string, any>;
    gcsOutputDirectory?: string;
    parameterValues?: Record<string, any>;
  };
  error?: { code: number; message: string };
  network?: string;
  serviceAccount?: string;
};

export type ListPipelineJobsRequest = {
  projectId: string;
  region: string;
  pageSize?: number;
  pageToken?: string;
  filter?: string;
};

export type ListPipelineJobsResponse = {
  jobs: PipelineJob[];
  nextPageToken?: string;
};
