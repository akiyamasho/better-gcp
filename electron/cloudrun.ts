import { GoogleAuth } from 'google-auth-library';
import type {
  CloudRunService,
  CloudRunRevision,
  ListCloudRunServicesRequest,
  ListCloudRunServicesResponse,
  GetCloudRunServiceRequest,
} from './types';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

function convertService(raw: any, region: string, projectId: string): CloudRunService {
  const conditions: { type: string; status: string; lastTransitionTime?: string; message?: string }[] = [];
  for (const c of raw.status?.conditions ?? []) {
    conditions.push({
      type: c.type ?? '',
      status: c.status ?? '',
      lastTransitionTime: c.lastTransitionTime,
      message: c.message,
    });
  }

  const revisions: CloudRunRevision[] = [];
  for (const t of raw.status?.traffic ?? []) {
    revisions.push({
      revisionName: t.revisionName ?? '',
      percent: t.percent ?? 0,
      latestRevision: t.latestRevision ?? false,
    });
  }

  const annotations = raw.metadata?.annotations ?? {};
  const labels = raw.metadata?.labels ?? {};

  return {
    name: raw.metadata?.name ?? '',
    namespace: raw.metadata?.namespace ?? projectId,
    region,
    uid: raw.metadata?.uid ?? '',
    generation: raw.metadata?.generation ?? 0,
    createTime: raw.metadata?.creationTimestamp ?? '',
    updateTime: annotations['serving.knative.dev/lastModifier']
      ? raw.status?.conditions?.find((c: any) => c.type === 'Ready')?.lastTransitionTime ?? ''
      : '',
    creator: annotations['serving.knative.dev/creator'] ?? '',
    lastModifier: annotations['serving.knative.dev/lastModifier'] ?? '',
    url: raw.status?.url ?? '',
    latestReadyRevision: raw.status?.latestReadyRevisionName ?? '',
    latestCreatedRevision: raw.status?.latestCreatedRevisionName ?? '',
    conditions,
    traffic: revisions,
    containerImage: raw.spec?.template?.spec?.containers?.[0]?.image ?? '',
    containerPort: raw.spec?.template?.spec?.containers?.[0]?.ports?.[0]?.containerPort ?? 8080,
    serviceAccount: raw.spec?.template?.spec?.serviceAccountName ?? '',
    maxInstances: raw.spec?.template?.metadata?.annotations?.['autoscaling.knative.dev/maxScale'] ?? '',
    minInstances: raw.spec?.template?.metadata?.annotations?.['autoscaling.knative.dev/minScale'] ?? '0',
    cpuLimit: raw.spec?.template?.spec?.containers?.[0]?.resources?.limits?.cpu ?? '',
    memoryLimit: raw.spec?.template?.spec?.containers?.[0]?.resources?.limits?.memory ?? '',
    env: (raw.spec?.template?.spec?.containers?.[0]?.env ?? []).map((e: any) => ({
      name: e.name ?? '',
      value: e.value ?? e.valueFrom?.secretKeyRef ? `secret:${e.valueFrom?.secretKeyRef?.name}` : (e.value ?? ''),
    })),
    labels,
    ingress: annotations['run.googleapis.com/ingress'] ?? 'all',
  };
}

export async function listCloudRunServices(
  req: ListCloudRunServicesRequest
): Promise<ListCloudRunServicesResponse> {
  const { projectId, region } = req;
  const client = await auth.getClient();
  const url = `https://${region}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${projectId}/services`;

  const res = await client.request({ url, method: 'GET' });
  const data = res.data as any;

  const services = (data.items ?? []).map((s: any) => convertService(s, region, projectId));
  services.sort((a: CloudRunService, b: CloudRunService) => {
    const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
    const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
    return tb - ta;
  });

  return { services };
}

export async function getCloudRunService(
  req: GetCloudRunServiceRequest
): Promise<CloudRunService> {
  const { projectId, region, serviceName } = req;
  const client = await auth.getClient();
  const url = `https://${region}-run.googleapis.com/apis/serving.knative.dev/v1/namespaces/${projectId}/services/${serviceName}`;

  const res = await client.request({ url, method: 'GET' });
  return convertService(res.data, region, projectId);
}
