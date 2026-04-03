import { GoogleAuth } from 'google-auth-library';
import type {
  GceInstance,
  ListGceInstancesRequest,
  ListGceInstancesResponse,
} from './types';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

type StateCode = 'PROVISIONING' | 'STAGING' | 'RUNNING' | 'STOPPING' | 'STOPPED' | 'SUSPENDING' | 'SUSPENDED' | 'TERMINATED';

function getStateName(status: string): StateCode {
  return status as StateCode;
}

function convertInstance(raw: any, zone: string, projectId: string): GceInstance {
  const labels: Record<string, string> = raw.labels ?? {};
  const metadata: { key: string; value: string }[] = [];
  for (const item of raw.metadata?.items ?? []) {
    metadata.push({
      key: item.key ?? '',
      value: item.value ?? '',
    });
  }

  const disks: { deviceName: string; source: string; mode: string; boot: boolean }[] = [];
  for (const disk of raw.disks ?? []) {
    disks.push({
      deviceName: disk.deviceName ?? '',
      source: disk.source ?? '',
      mode: disk.mode ?? '',
      boot: disk.boot ?? false,
    });
  }

  const networkInterfaces: { network: string; networkIP: string; accessConfigs: { natIP?: string; name: string }[] }[] = [];
  for (const iface of raw.networkInterfaces ?? []) {
    networkInterfaces.push({
      network: iface.network ?? '',
      networkIP: iface.networkIP ?? '',
      accessConfigs: (iface.accessConfigs ?? []).map((ac: any) => ({
        natIP: ac.natIP,
        name: ac.name ?? '',
      })),
    });
  }

  const tags: string[] = raw.tags?.items ?? [];

  return {
    name: raw.name ?? '',
    id: raw.id ?? '',
    zone,
    projectId,
    status: getStateName(raw.status ?? 'TERMINATED'),
    machineType: raw.machineType ? raw.machineType.split('/').pop() : '',
    cpuPlatform: raw.cpuPlatform ?? '',
    creationTimestamp: raw.creationTimestamp ?? '',
    description: raw.description ?? '',
    internalIP: networkInterfaces[0]?.networkIP ?? '',
    externalIP: networkInterfaces[0]?.accessConfigs?.[0]?.natIP ?? '',
    serviceAccount: raw.serviceAccounts?.[0]?.email ?? '',
    scopes: raw.serviceAccounts?.[0]?.scopes ?? [],
    labels,
    tags,
    metadata,
    disks,
    networkInterfaces,
    canIpForward: raw.canIpForward ?? false,
    fingerprint: raw.fingerprint ?? '',
    scheduling: {
      automaticRestart: raw.scheduling?.automaticRestart ?? false,
      onHostMaintenance: raw.scheduling?.onHostMaintenance ?? '',
      preemptible: raw.scheduling?.preemptible ?? false,
    },
  };
}

export async function listGceInstances(
  req: ListGceInstancesRequest
): Promise<ListGceInstancesResponse> {
  const { projectId, zone } = req;
  const client = await auth.getClient();
  const url = `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances`;

  try {
    const res = await client.request({ url, method: 'GET' });
    const data = res.data as any;

    const instances = (data.items ?? []).map((inst: any) => convertInstance(inst, zone, projectId));
    instances.sort((a: GceInstance, b: GceInstance) => {
      const ta = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0;
      const tb = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0;
      return tb - ta;
    });

    return { instances };
  } catch (err: any) {
    if (err.response?.status === 404) {
      return { instances: [] };
    }
    throw err;
  }
}
