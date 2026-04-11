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

export type RenamePrefixRequest = {
  bucket: string;
  prefix: string;
  newName: string;
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

export type AiEditRequest = {
  instruction: string;
  currentQuery?: string;
  tableContext?: string;
};

export type AiEditResult = {
  updatedQuery: string;
  cliUsed: string;
};

export type AppUpdateAsset = {
  name: string;
  downloadUrl: string;
};

export type AppUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseUrl: string;
  publishedAt: string;
  notes?: string;
  hasUpdate: boolean;
  dmg?: AppUpdateAsset;
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

// Cloud Run

export type CloudRunRevision = {
  revisionName: string;
  percent: number;
  latestRevision: boolean;
};

export type CloudRunService = {
  name: string;
  namespace: string;
  region: string;
  uid: string;
  generation: number;
  createTime: string;
  updateTime: string;
  creator: string;
  lastModifier: string;
  url: string;
  latestReadyRevision: string;
  latestCreatedRevision: string;
  conditions: { type: string; status: string; lastTransitionTime?: string; message?: string }[];
  traffic: CloudRunRevision[];
  containerImage: string;
  containerPort: number;
  serviceAccount: string;
  maxInstances: string;
  minInstances: string;
  cpuLimit: string;
  memoryLimit: string;
  env: { name: string; value: string }[];
  labels: Record<string, string>;
  ingress: string;
};

export type ListCloudRunServicesRequest = {
  projectId: string;
  region: string;
};

export type ListCloudRunServicesResponse = {
  services: CloudRunService[];
};

export type GetCloudRunServiceRequest = {
  projectId: string;
  region: string;
  serviceName: string;
};

// GCE (Google Compute Engine)

export type GceInstance = {
  name: string;
  id: string;
  zone: string;
  projectId: string;
  status: 'PROVISIONING' | 'STAGING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'SUSPENDING' | 'SUSPENDED' | 'TERMINATED';
  machineType: string;
  cpuPlatform: string;
  creationTimestamp: string;
  description: string;
  internalIP: string;
  externalIP: string;
  serviceAccount: string;
  scopes: string[];
  labels: Record<string, string>;
  tags: string[];
  metadata: { key: string; value: string }[];
  disks: { deviceName: string; source: string; mode: string; boot: boolean }[];
  networkInterfaces: { network: string; networkIP: string; accessConfigs: { natIP?: string; name: string }[] }[];
  canIpForward: boolean;
  fingerprint: string;
  scheduling: {
    automaticRestart: boolean;
    onHostMaintenance: string;
    preemptible: boolean;
  };
  hasGpu: boolean;
  gpuType?: string;
  gpuCount?: number;
  isTpu?: false;
};

export type TpuInstance = {
  name: string;
  zone: string;
  projectId: string;
  state: string;
  acceleratorType: string;
  runtimeVersion: string;
  creationTimestamp: string;
  description: string;
  networkEndpoints: { ipAddress: string; port: number }[];
  serviceAccount: string;
  labels: Record<string, string>;
  cidrBlock: string;
  schedulingConfig?: {
    preemptible: boolean;
    reserved: boolean;
  };
  isTpu: true;
};

export type ListGceInstancesRequest = {
  projectId: string;
  zone: string;
};

export type ListGceInstancesResponse = {
  instances: (GceInstance | TpuInstance)[];
};

export type SecretManagerSecret = {
  name: string;
  displayName: string;
  createTime: string;
  replication: string;
  labels: Record<string, string>;
};

export type SecretManagerVersion = {
  name: string;
  versionId: string;
  state: string;
  createTime: string;
  destroyTime?: string;
  replicationStatus?: unknown;
};

export type ListSecretsRequest = {
  projectId: string;
};

export type AccessSecretVersionRequest = {
  versionName: string;
};

export type GetLatestSecretValueRequest = {
  secretName: string;
};

// Vertex AI Vector Search (Matching Engine)

export type VectorSearchIndex = {
  name: string;
  displayName: string;
  region: string;
  state: string;
  createTime: string;
  updateTime: string;
  deployedIndexes: { id: string; indexEndpoint: string }[];
  indexStats?: { vectorsCount: string; shardsCount: number };
  metadata?: {
    contentsDeltaUri?: string;
    config?: {
      dimensions?: number;
      approximateNeighborsCount?: number;
      distanceMeasureType?: string;
      algorithmConfig?: {
        treeAhConfig?: { leafNodeEmbeddingCount?: string };
        bruteForceConfig?: Record<string, never>;
      };
    };
  };
  metadataSchemaUri?: string;
  labels: Record<string, string>;
  indexUpdateMethod?: string;
};

export type IndexEndpoint = {
  name: string;
  displayName: string;
  region: string;
  createTime: string;
  updateTime: string;
  network: string;
  publicEndpointEnabled: boolean;
  publicEndpointDomainName?: string;
  deployedIndexes: DeployedIndexRef[];
  labels: Record<string, string>;
};

export type DeployedIndexRef = {
  id: string;
  index: string;
  displayName?: string;
  createTime?: string;
  privateEndpoints?: { matchGrpcAddress?: string; serviceAttachment?: string };
  dedicatedServingEndpoint?: { publicEndpointDomainName?: string };
  automaticResources?: { minReplicaCount?: number; maxReplicaCount?: number };
  deployedIndexAuthConfig?: { authProvider?: unknown };
};

export type ListVectorSearchIndicesRequest = {
  projectId: string;
  region: string;
};

export type ListVectorSearchIndicesResponse = {
  indices: VectorSearchIndex[];
};

export type ListIndexEndpointsRequest = {
  projectId: string;
  region: string;
};

export type ListIndexEndpointsResponse = {
  endpoints: IndexEndpoint[];
};
