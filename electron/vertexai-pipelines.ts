import { GoogleAuth } from 'google-auth-library';
import type {
  ListPipelineJobsRequest,
  ListPipelineJobsResponse,
  PipelineJob,
  PipelineTaskDetail,
} from './types';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const PIPELINE_STATE_MAP: Record<string, number> = {
  PIPELINE_STATE_UNSPECIFIED: 0,
  PIPELINE_STATE_QUEUED: 1,
  PIPELINE_STATE_PENDING: 2,
  PIPELINE_STATE_RUNNING: 3,
  PIPELINE_STATE_SUCCEEDED: 4,
  PIPELINE_STATE_FAILED: 5,
  PIPELINE_STATE_CANCELLING: 6,
  PIPELINE_STATE_CANCELLED: 7,
  PIPELINE_STATE_PAUSED: 8,
};

const PIPELINE_STATE_DISPLAY: Record<string, string> = {
  PIPELINE_STATE_UNSPECIFIED: 'UNSPECIFIED',
  PIPELINE_STATE_QUEUED: 'QUEUED',
  PIPELINE_STATE_PENDING: 'PENDING',
  PIPELINE_STATE_RUNNING: 'RUNNING',
  PIPELINE_STATE_SUCCEEDED: 'SUCCEEDED',
  PIPELINE_STATE_FAILED: 'FAILED',
  PIPELINE_STATE_CANCELLING: 'CANCELLING',
  PIPELINE_STATE_CANCELLED: 'CANCELLED',
  PIPELINE_STATE_PAUSED: 'PAUSED',
};

const TASK_STATE_DISPLAY: Record<string, string> = {
  NOT_STARTED: 'NOT_STARTED',
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED',
  CANCELLED: 'CANCELLED',
  CANCELLING: 'CANCELLING',
};

function extractArtifactUris(params: Record<string, any> | undefined): Record<string, string[]> {
  if (!params) return {};
  const result: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    const artifacts = value?.artifacts;
    if (Array.isArray(artifacts)) {
      result[key] = artifacts.map((a: any) => a.uri ?? '').filter(Boolean);
    }
  }
  return result;
}

function convertTaskDetail(raw: any): PipelineTaskDetail {
  const stateStr = raw.state ?? 'NOT_STARTED';
  return {
    taskId: raw.taskId ?? '',
    taskName: raw.taskName ?? '',
    state: TASK_STATE_DISPLAY[stateStr] ?? stateStr,
    createTime: raw.createTime ?? '',
    startTime: raw.startTime,
    endTime: raw.endTime,
    executionName: raw.execution?.name,
    inputs: extractArtifactUris(raw.inputs),
    outputs: extractArtifactUris(raw.outputs),
    parentTaskId: raw.parentTaskId,
    pipelineTaskStatus: raw.pipelineTaskStatus,
    error: raw.error,
  };
}

function convertPipelineJob(raw: any, region: string): PipelineJob {
  const stateStr = raw.state ?? 'PIPELINE_STATE_UNSPECIFIED';
  const taskDetails = raw.jobDetail?.taskDetails ?? [];
  return {
    name: raw.name ?? '',
    displayName: raw.displayName ?? 'N/A',
    state: PIPELINE_STATE_DISPLAY[stateStr] ?? stateStr.replace('PIPELINE_STATE_', ''),
    rawState: PIPELINE_STATE_MAP[stateStr] ?? 0,
    region,
    createTime: raw.createTime ?? '',
    startTime: raw.startTime,
    endTime: raw.endTime,
    updateTime: raw.updateTime,
    labels: raw.labels ?? {},
    taskDetails: taskDetails.map(convertTaskDetail),
    pipelineSpec: raw.pipelineSpec,
    templateUri: raw.templateUri,
    templateMetadata: raw.templateMetadata,
    runtimeConfig: raw.runtimeConfig,
    error: raw.error,
    network: raw.network,
    serviceAccount: raw.serviceAccount,
  };
}

export async function listPipelineJobs(
  req: ListPipelineJobsRequest
): Promise<ListPipelineJobsResponse> {
  const { projectId, region, pageSize = 30, pageToken, filter } = req;
  const client = await auth.getClient();
  const endpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/pipelineJobs`;

  const params = new URLSearchParams({
    pageSize: String(pageSize),
    orderBy: 'create_time desc',
  });
  if (pageToken) params.set('pageToken', pageToken);
  if (filter) params.set('filter', filter);

  const url = `${endpoint}?${params}`;
  const res = await client.request({ url, method: 'GET' });
  const data = res.data as any;

  return {
    jobs: (data.pipelineJobs ?? []).map((j: any) => convertPipelineJob(j, region)),
    nextPageToken: data.nextPageToken,
  };
}

export async function getPipelineJob(req: {
  projectId: string;
  region: string;
  pipelineJobId: string;
}): Promise<PipelineJob> {
  const { projectId, region, pipelineJobId } = req;
  const client = await auth.getClient();
  const url = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/pipelineJobs/${pipelineJobId}`;

  const res = await client.request({ url, method: 'GET' });
  return convertPipelineJob(res.data as any, region);
}

export async function cancelPipelineJob(jobName: string): Promise<void> {
  const region = jobName.split('/')[3]; // projects/{p}/locations/{loc}/pipelineJobs/{id}
  const client = await auth.getClient();
  const url = `https://${region}-aiplatform.googleapis.com/v1/${jobName}:cancel`;
  await client.request({ url, method: 'POST' });
}

export async function deletePipelineJob(jobName: string): Promise<void> {
  const region = jobName.split('/')[3];
  const client = await auth.getClient();
  const url = `https://${region}-aiplatform.googleapis.com/v1/${jobName}`;
  await client.request({ url, method: 'DELETE' });
}
