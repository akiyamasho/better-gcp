import { GoogleAuth } from 'google-auth-library';
import type {
  GceInstance,
  TpuInstance,
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

  // Check for GPU accelerators
  const guestAccelerators = raw.guestAccelerators ?? [];
  const hasGpu = guestAccelerators.length > 0;

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
    hasGpu,
    gpuType: hasGpu ? guestAccelerators[0]?.acceleratorType?.split('/').pop() : undefined,
    gpuCount: hasGpu ? guestAccelerators[0]?.acceleratorCount : undefined,
  };
}

function convertTpuInstance(raw: any, zone: string, projectId: string): TpuInstance {
  const labels: Record<string, string> = raw.labels ?? {};
  const networkEndpoints = (raw.networkEndpoints ?? []).map((ne: any) => ({
    ipAddress: ne.ipAddress ?? '',
    port: ne.port ?? 0,
  }));

  // Extract just the name from the full resource path
  // Format: projects/{project}/locations/{location}/nodes/{name}
  const nameParts = (raw.name ?? '').split('/');
  const instanceName = nameParts.length > 0 ? nameParts[nameParts.length - 1] : raw.name ?? '';

  return {
    name: instanceName,
    zone,
    projectId,
    state: raw.state ?? 'UNKNOWN',
    acceleratorType: raw.acceleratorType?.split('/').pop() ?? '',
    runtimeVersion: raw.runtimeVersion?.split('/').pop() ?? '',
    creationTimestamp: raw.createTime ?? '',
    description: raw.description ?? '',
    networkEndpoints,
    serviceAccount: raw.serviceAccount ?? '',
    labels,
    cidrBlock: raw.cidrBlock ?? '',
    isTpu: true,
  };
}

export async function listGceInstances(
  req: ListGceInstancesRequest
): Promise<ListGceInstancesResponse> {
  const { projectId, zone } = req;
  const client = await auth.getClient();

  // Fetch both GCE instances and TPUs in parallel
  const [gceRes, tpuRes] = await Promise.allSettled([
    client.request({
      url: `https://compute.googleapis.com/compute/v1/projects/${projectId}/zones/${zone}/instances`,
      method: 'GET'
    }),
    client.request({
      url: `https://tpu.googleapis.com/v2/projects/${projectId}/locations/${zone}/nodes`,
      method: 'GET'
    })
  ]);

  const gceInstances: GceInstance[] = [];
  const tpuInstances: TpuInstance[] = [];

  // Process GCE instances
  if (gceRes.status === 'fulfilled') {
    const data = gceRes.value.data as any;
    gceInstances.push(
      ...(data.items ?? []).map((inst: any) => convertInstance(inst, zone, projectId))
    );
  }

  // Process TPU instances
  if (tpuRes.status === 'fulfilled') {
    const data = tpuRes.value.data as any;
    tpuInstances.push(
      ...(data.nodes ?? []).map((node: any) => convertTpuInstance(node, zone, projectId))
    );
  }

  const allInstances = [...gceInstances, ...tpuInstances];
  allInstances.sort((a, b) => {
    const ta = a.creationTimestamp ? new Date(a.creationTimestamp).getTime() : 0;
    const tb = b.creationTimestamp ? new Date(b.creationTimestamp).getTime() : 0;
    return tb - ta;
  });

  return { instances: allInstances };
}
