import { GoogleAuth } from 'google-auth-library';
import type {
  ListCustomJobsRequest,
  ListCustomJobsResponse,
  VertexAICustomJob,
  VertexAIWorkerPoolSpec,
} from './types';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const JOB_STATE_MAP: Record<string, number> = {
  JOB_STATE_UNSPECIFIED: 0,
  JOB_STATE_QUEUED: 1,
  JOB_STATE_PENDING: 2,
  JOB_STATE_RUNNING: 3,
  JOB_STATE_SUCCEEDED: 4,
  JOB_STATE_FAILED: 5,
  JOB_STATE_CANCELLING: 6,
  JOB_STATE_CANCELLED: 7,
  JOB_STATE_PAUSED: 8,
  JOB_STATE_EXPIRED: 9,
  JOB_STATE_UPDATING: 10,
};

const STATE_DISPLAY: Record<string, string> = {
  JOB_STATE_UNSPECIFIED: 'UNSPECIFIED',
  JOB_STATE_QUEUED: 'QUEUED',
  JOB_STATE_PENDING: 'PENDING',
  JOB_STATE_RUNNING: 'RUNNING',
  JOB_STATE_SUCCEEDED: 'SUCCEEDED',
  JOB_STATE_FAILED: 'FAILED',
  JOB_STATE_CANCELLING: 'CANCELLING',
  JOB_STATE_CANCELLED: 'CANCELLED',
  JOB_STATE_PAUSED: 'PAUSED',
  JOB_STATE_EXPIRED: 'EXPIRED',
  JOB_STATE_UPDATING: 'UPDATING',
};

function convertWorkerPoolSpec(raw: any): VertexAIWorkerPoolSpec {
  const spec: VertexAIWorkerPoolSpec = {
    replicaCount: raw.replicaCount ?? '0',
  };
  if (raw.machineSpec) {
    spec.machineSpec = {
      machineType: raw.machineSpec.machineType ?? 'unknown',
      acceleratorType: raw.machineSpec.acceleratorType,
      acceleratorCount: raw.machineSpec.acceleratorCount,
    };
  }
  if (raw.diskSpec) {
    spec.diskSpec = {
      bootDiskType: raw.diskSpec.bootDiskType ?? 'unknown',
      bootDiskSizeGb: raw.diskSpec.bootDiskSizeGb ?? 0,
    };
  }
  if (raw.containerSpec) {
    spec.containerSpec = {
      imageUri: raw.containerSpec.imageUri ?? '',
      env: raw.containerSpec.env,
      command: raw.containerSpec.command,
      args: raw.containerSpec.args,
    };
  }
  return spec;
}

function convertJob(raw: any, region: string): VertexAICustomJob {
  const stateStr = raw.state ?? 'JOB_STATE_UNSPECIFIED';
  return {
    name: raw.name ?? '',
    displayName: raw.displayName ?? 'N/A',
    state: STATE_DISPLAY[stateStr] ?? stateStr.replace('JOB_STATE_', ''),
    rawState: JOB_STATE_MAP[stateStr] ?? 0,
    region,
    createTime: raw.createTime ?? '',
    startTime: raw.startTime,
    endTime: raw.endTime,
    updateTime: raw.updateTime,
    labels: raw.labels ?? {},
    error: raw.error,
    workerPoolSpecs: (raw.jobSpec?.workerPoolSpecs ?? []).map(convertWorkerPoolSpec),
    baseOutputDirectory: raw.jobSpec?.baseOutputDirectory?.outputUriPrefix,
  };
}

export async function listCustomJobs(
  req: ListCustomJobsRequest
): Promise<ListCustomJobsResponse> {
  const { projectId, region, pageSize = 30, pageToken } = req;
  const client = await auth.getClient();
  const endpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/customJobs`;

  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (pageToken) params.set('pageToken', pageToken);

  const url = `${endpoint}?${params}`;
  const res = await client.request({ url, method: 'GET' });
  const data = res.data as any;

  return {
    jobs: (data.customJobs ?? []).map((j: any) => convertJob(j, region)),
    nextPageToken: data.nextPageToken,
  };
}

export async function cancelCustomJob(jobName: string): Promise<void> {
  const region = jobName.split('/')[3]; // projects/{p}/locations/{loc}/customJobs/{id}
  const client = await auth.getClient();
  const url = `https://${region}-aiplatform.googleapis.com/v1/${jobName}:cancel`;
  await client.request({ url, method: 'POST' });
}

export async function deleteCustomJob(jobName: string): Promise<void> {
  const region = jobName.split('/')[3];
  const client = await auth.getClient();
  const url = `https://${region}-aiplatform.googleapis.com/v1/${jobName}`;
  await client.request({ url, method: 'DELETE' });
}
