import { GoogleAuth } from 'google-auth-library';
import type {
  ListVectorSearchIndicesRequest,
  ListVectorSearchIndicesResponse,
  ListIndexEndpointsRequest,
  ListIndexEndpointsResponse,
  VectorSearchIndex,
  IndexEndpoint,
} from './types';

const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

const INDEX_STATE_DISPLAY: Record<string, string> = {
  STATE_UNSPECIFIED: 'UNSPECIFIED',
  CREATING: 'CREATING',
  CREATED: 'CREATED',
  UPDATING: 'UPDATING',
  DELETING: 'DELETING',
};

function convertIndex(raw: any, region: string): VectorSearchIndex {
  const stateStr = raw.state ?? 'STATE_UNSPECIFIED';
  return {
    name: raw.name ?? '',
    displayName: raw.displayName ?? 'N/A',
    region,
    state: INDEX_STATE_DISPLAY[stateStr] ?? stateStr,
    createTime: raw.createTime ?? '',
    updateTime: raw.updateTime ?? '',
    deployedIndexes: raw.deployedIndexes ?? [],
    indexStats: raw.indexStats,
    metadata: raw.metadata,
    metadataSchemaUri: raw.metadataSchemaUri,
    labels: raw.labels ?? {},
    indexUpdateMethod: raw.indexUpdateMethod,
  };
}

function convertIndexEndpoint(raw: any, region: string): IndexEndpoint {
  return {
    name: raw.name ?? '',
    displayName: raw.displayName ?? 'N/A',
    region,
    createTime: raw.createTime ?? '',
    updateTime: raw.updateTime ?? '',
    network: raw.network ?? '',
    publicEndpointEnabled: raw.publicEndpointEnabled ?? false,
    publicEndpointDomainName: raw.publicEndpointDomainName,
    deployedIndexes: raw.deployedIndexes ?? [],
    labels: raw.labels ?? {},
  };
}

export async function listVectorSearchIndices(
  req: ListVectorSearchIndicesRequest
): Promise<ListVectorSearchIndicesResponse> {
  const { projectId, region } = req;
  const client = await auth.getClient();
  const endpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/indexes`;

  const res = await client.request({ url: endpoint, method: 'GET' });
  const data = res.data as any;

  return {
    indices: (data.indexes ?? []).map((idx: any) => convertIndex(idx, region)),
  };
}

export async function listIndexEndpoints(
  req: ListIndexEndpointsRequest
): Promise<ListIndexEndpointsResponse> {
  const { projectId, region } = req;
  const client = await auth.getClient();
  const endpoint = `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${region}/indexEndpoints`;

  const res = await client.request({ url: endpoint, method: 'GET' });
  const data = res.data as any;

  return {
    endpoints: (data.indexEndpoints ?? []).map((ep: any) => convertIndexEndpoint(ep, region)),
  };
}

export async function deleteIndex(indexName: string): Promise<void> {
  const region = indexName.split('/')[3]; // projects/{p}/locations/{loc}/indexes/{id}
  const client = await auth.getClient();
  const url = `https://${region}-aiplatform.googleapis.com/v1/${indexName}`;
  await client.request({ url, method: 'DELETE' });
}
