import { GoogleAuth } from 'google-auth-library';
import type { SecretManagerSecret, SecretManagerVersion, ListSecretsRequest } from './types';

const auth = new GoogleAuth({
  scopes: ['https://www.googleapis.com/auth/cloud-platform'],
});

const getClient = async () => {
  const client = await auth.getClient();
  return client;
};

const makeRequest = async (url: string, method = 'GET') => {
  const client = await getClient();
  const response = await client.request({ url, method });
  return response.data;
};

export const listSecrets = async (req: ListSecretsRequest): Promise<SecretManagerSecret[]> => {
  const { projectId } = req;
  const url = `https://secretmanager.googleapis.com/v1/projects/${projectId}/secrets`;
  const data = await makeRequest(url);
  const secrets = (data as { secrets?: unknown[] }).secrets ?? [];
  return secrets.map((secret: any) => ({
    name: secret.name,
    displayName: secret.name.split('/').pop() ?? '',
    createTime: secret.createTime,
    replication: secret.replication?.automatic ? 'automatic' : 'user-managed',
    labels: secret.labels ?? {},
  }));
};

export const listSecretVersions = async (secretName: string): Promise<SecretManagerVersion[]> => {
  const url = `https://secretmanager.googleapis.com/v1/${secretName}/versions`;
  const data = await makeRequest(url);
  const versions = (data as { versions?: unknown[] }).versions ?? [];
  return versions.map((version: any) => ({
    name: version.name,
    versionId: version.name.split('/').pop() ?? '',
    state: version.state,
    createTime: version.createTime,
    destroyTime: version.destroyTime,
    replicationStatus: version.replicationStatus,
  }));
};

export const accessSecretVersion = async (versionName: string): Promise<string> => {
  const url = `https://secretmanager.googleapis.com/v1/${versionName}:access`;
  const data = await makeRequest(url);
  const payload = (data as { payload?: { data?: string } }).payload;
  if (!payload?.data) return '';
  // Decode base64
  return Buffer.from(payload.data, 'base64').toString('utf-8');
};

export const getLatestSecretValue = async (secretName: string): Promise<string> => {
  const latestVersionName = `${secretName}/versions/latest`;
  return accessSecretVersion(latestVersionName);
};
