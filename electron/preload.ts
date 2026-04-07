import { contextBridge, ipcRenderer } from 'electron';
import type {
  BqQueryRequest,
  BqSavedQuery,
  CreateFolderRequest,
  DeleteRequest,
  DownloadManyRequest,
  DownloadRequest,
  GetCloudRunServiceRequest,
  AppUpdateInfo,
  ListCloudRunServicesRequest,
  ListCustomJobsRequest,
  ListGceInstancesRequest,
  ListPipelineJobsRequest,
  ListVectorSearchIndicesRequest,
  ListIndexEndpointsRequest,
  ListObjectsRequest,
  RenamePrefixRequest,
  StartDragRequest,
  UploadRequest,
} from './types';

contextBridge.exposeInMainWorld('gcs', {
  listBuckets: (projectId?: string) => ipcRenderer.invoke('gcs:list-buckets', projectId),
  listObjects: (req: ListObjectsRequest) => ipcRenderer.invoke('gcs:list-objects', req),
  download: (req: DownloadRequest) => ipcRenderer.invoke('gcs:download', req),
  downloadMany: (req: DownloadManyRequest) => ipcRenderer.invoke('gcs:download-many', req),
  upload: (req: UploadRequest) => ipcRenderer.invoke('gcs:upload', req),
  delete: (req: DeleteRequest) => ipcRenderer.invoke('gcs:delete', req),
  createFolder: (req: CreateFolderRequest) => ipcRenderer.invoke('gcs:create-folder', req),
  renamePrefix: (req: RenamePrefixRequest) => ipcRenderer.invoke('gcs:rename-prefix', req),
  startDrag: (req: StartDragRequest) => ipcRenderer.invoke('gcs:start-drag', req),
  chooseUpload: () => ipcRenderer.invoke('gcs:choose-upload'),
});

contextBridge.exposeInMainWorld('bq', {
  listProjects: () => ipcRenderer.invoke('bq:list-projects'),
  listDatasets: (req: { projectId: string }) => ipcRenderer.invoke('bq:list-datasets', req),
  listTables: (req: { projectId: string; datasetId: string }) =>
    ipcRenderer.invoke('bq:list-tables', req),
  previewTable: (req: { projectId: string; datasetId: string; tableId: string }) =>
    ipcRenderer.invoke('bq:preview-table', req),
  runQuery: (req: BqQueryRequest) => ipcRenderer.invoke('bq:run-query', req),
  loadSavedQueries: () => ipcRenderer.invoke('bq:load-saved-queries'),
  saveSavedQueries: (queries: BqSavedQuery[]) => ipcRenderer.invoke('bq:save-queries', queries),
});

contextBridge.exposeInMainWorld('vertexai', {
  listCustomJobs: (req: ListCustomJobsRequest) =>
    ipcRenderer.invoke('vertexai:list-custom-jobs', req),
  cancelCustomJob: (jobName: string) => ipcRenderer.invoke('vertexai:cancel-custom-job', jobName),
  deleteCustomJob: (jobName: string) => ipcRenderer.invoke('vertexai:delete-custom-job', jobName),
});

contextBridge.exposeInMainWorld('pipelines', {
  list: (req: ListPipelineJobsRequest) => ipcRenderer.invoke('pipelines:list', req),
  get: (req: { projectId: string; region: string; pipelineJobId: string }) =>
    ipcRenderer.invoke('pipelines:get', req),
  cancel: (jobName: string) => ipcRenderer.invoke('pipelines:cancel', jobName),
  delete: (jobName: string) => ipcRenderer.invoke('pipelines:delete', jobName),
});

contextBridge.exposeInMainWorld('vectorsearch', {
  listIndices: (req: ListVectorSearchIndicesRequest) => ipcRenderer.invoke('vectorsearch:list-indices', req),
  listEndpoints: (req: ListIndexEndpointsRequest) => ipcRenderer.invoke('vectorsearch:list-endpoints', req),
  deleteIndex: (indexName: string) => ipcRenderer.invoke('vectorsearch:delete-index', indexName),
});

contextBridge.exposeInMainWorld('cloudrun', {
  listServices: (req: ListCloudRunServicesRequest) =>
    ipcRenderer.invoke('cloudrun:list-services', req),
  getService: (req: GetCloudRunServiceRequest) =>
    ipcRenderer.invoke('cloudrun:get-service', req),
});

contextBridge.exposeInMainWorld('gce', {
  listInstances: (req: ListGceInstancesRequest) =>
    ipcRenderer.invoke('gce:list-instances', req),
});

contextBridge.exposeInMainWorld('secretmanager', {
  listSecrets: (projectId: string) =>
    ipcRenderer.invoke('secretmanager:list-secrets', { projectId }),
  listVersions: (secretName: string) =>
    ipcRenderer.invoke('secretmanager:list-versions', secretName),
  accessVersion: (versionName: string) =>
    ipcRenderer.invoke('secretmanager:access-version', versionName),
  getLatestValue: (secretName: string) =>
    ipcRenderer.invoke('secretmanager:get-latest-value', secretName),
});

contextBridge.exposeInMainWorld('shell', {
  openExternal: (url: string) => ipcRenderer.invoke('shell:open-external', url),
});

contextBridge.exposeInMainWorld('updates', {
  check: (): Promise<{ ok: true; data: AppUpdateInfo } | { ok: false; error: string }> =>
    ipcRenderer.invoke('updates:check'),
  install: () => ipcRenderer.invoke('updates:install'),
});
