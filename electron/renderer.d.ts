import type {
  BqDataset,
  BqProject,
  BqQueryRequest,
  BqQueryResult,
  BqSavedQuery,
  BqTable,
  BqTablePreview,
  CloudRunService,
  DeleteRequest,
  DownloadManyRequest,
  DownloadRequest,
  CreateFolderRequest,
  GcsBucket,
  GceInstance,
  GetCloudRunServiceRequest,
  ListCloudRunServicesRequest,
  ListCloudRunServicesResponse,
  ListGceInstancesRequest,
  ListGceInstancesResponse,
  ListObjectsRequest,
  ListObjectsResponse,
  ListPipelineJobsRequest,
  ListPipelineJobsResponse,
  PipelineJob,
  StartDragRequest,
  UploadRequest,
} from '../shared/types';

type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

declare global {
  interface Window {
    gcs: {
      listBuckets: (projectId?: string) => Promise<GcsBucket[]>;
      listObjects: (req: ListObjectsRequest) => Promise<ListObjectsResponse>;
      download: (req: DownloadRequest) => Promise<{ canceled: boolean } | { canceled: boolean; error?: string }>;
      downloadMany: (
        req: DownloadManyRequest
      ) => Promise<{ canceled: boolean } | { canceled: boolean; error?: string }>;
      upload: (req: UploadRequest) => Promise<{ ok: boolean; error?: string }>;
      delete: (req: DeleteRequest) => Promise<{ ok: boolean; error?: string }>;
      createFolder: (req: CreateFolderRequest) => Promise<{ ok: boolean; error?: string }>;
      startDrag: (req: StartDragRequest) => Promise<{ ok: boolean; error?: string }>;
      chooseUpload: () => Promise<{ canceled: boolean; paths: string[] }>;
    };
    bq: {
      listProjects: () => Promise<IpcResult<BqProject[]>>;
      listDatasets: (req: { projectId: string }) => Promise<IpcResult<BqDataset[]>>;
      listTables: (req: { projectId: string; datasetId: string }) => Promise<IpcResult<BqTable[]>>;
      previewTable: (req: {
        projectId: string;
        datasetId: string;
        tableId: string;
      }) => Promise<IpcResult<BqTablePreview>>;
      runQuery: (req: BqQueryRequest) => Promise<IpcResult<BqQueryResult>>;
      loadSavedQueries: () => Promise<IpcResult<BqSavedQuery[]>>;
      saveSavedQueries: (queries: BqSavedQuery[]) => Promise<{ ok: boolean; error?: string }>;
    };
    pipelines: {
      list: (req: ListPipelineJobsRequest) => Promise<IpcResult<ListPipelineJobsResponse>>;
      get: (req: { projectId: string; region: string; pipelineJobId: string }) => Promise<IpcResult<PipelineJob>>;
      cancel: (jobName: string) => Promise<{ ok: boolean; error?: string }>;
      delete: (jobName: string) => Promise<{ ok: boolean; error?: string }>;
    };
    cloudrun: {
      listServices: (req: ListCloudRunServicesRequest) => Promise<IpcResult<ListCloudRunServicesResponse>>;
      getService: (req: GetCloudRunServiceRequest) => Promise<IpcResult<CloudRunService>>;
    };
    gce: {
      listInstances: (req: ListGceInstancesRequest) => Promise<IpcResult<ListGceInstancesResponse>>;
    };
    shell: {
      openExternal: (url: string) => Promise<void>;
    };
  }
}

export {};
