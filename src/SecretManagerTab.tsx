import React, { useCallback, useEffect, useState } from 'react';
import type { SecretManagerSecret, SecretManagerVersion } from '@shared/types';

const STORAGE_KEY = 'better-gcp:secretmanager-project';

function formatTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
}

type SecretManagerTabProps = {
  isActive?: boolean;
};

const SecretManagerTab = ({ isActive }: SecretManagerTabProps) => {
  const [projectId, setProjectId] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });
  const [projectInput, setProjectInput] = useState(() => projectId);
  const [secrets, setSecrets] = useState<SecretManagerSecret[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedSecret, setSelectedSecret] = useState<SecretManagerSecret | null>(null);
  const [versions, setVersions] = useState<SecretManagerVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [copyingSecret, setCopyingSecret] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (projectId) {
      try {
        localStorage.setItem(STORAGE_KEY, projectId);
      } catch {}
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setError('');
    window.secretmanager
      .listSecrets(projectId)
      .then((res) => {
        if (res.ok) {
          setSecrets(res.data);
        } else {
          setError(res.error);
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleProjectSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = projectInput.trim();
    if (!trimmed) return;
    setProjectId(trimmed);
    setSelectedSecret(null);
    setVersions([]);
  };

  const handleSelectSecret = useCallback((secret: SecretManagerSecret) => {
    if (selectedSecret?.name === secret.name) {
      setSelectedSecret(null);
      setVersions([]);
      return;
    }
    setSelectedSecret(secret);
    setLoadingVersions(true);
    window.secretmanager
      .listVersions(secret.name)
      .then((res) => {
        if (res.ok) {
          setVersions(res.data);
        } else {
          setError(res.error);
        }
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoadingVersions(false));
  }, [selectedSecret]);

  const handleCopyLatestValue = useCallback(async (secret: SecretManagerSecret) => {
    setCopyingSecret(secret.name);
    try {
      const res = await window.secretmanager.getLatestValue(secret.name);
      if (res.ok) {
        await navigator.clipboard.writeText(res.data);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setTimeout(() => setCopyingSecret(null), 800);
    }
  }, []);

  const handleCopyVersion = useCallback(async (version: SecretManagerVersion) => {
    try {
      const res = await window.secretmanager.accessVersion(version.name);
      if (res.ok) {
        await navigator.clipboard.writeText(res.data);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const filteredSecrets = secrets.filter((secret) =>
    secret.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="vai-layout">
      {/* Toolbar */}
      <div className="vai-toolbar">
        <div className="vai-toolbar-left">
          <form onSubmit={handleProjectSubmit} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: 13, color: 'var(--muted)' }}>Project:</label>
            <input
              className="cr-project-dropdown-input"
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
              placeholder="project-id"
              style={{ fontFamily: 'IBM Plex Mono, monospace', width: 250 }}
            />
            <button className="secondary-button" type="submit" style={{ padding: '6px 12px', fontSize: 13 }}>
              Go
            </button>
          </form>
          <input
            className="cr-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter secrets..."
            disabled={!projectId}
          />
        </div>
        <span className="vai-count">
          {projectId ? `${filteredSecrets.length} ${filteredSecrets.length === 1 ? 'secret' : 'secrets'}` : ''}
        </span>
      </div>

      {/* Main content */}
      <div className="vai-content">
        {error ? <div className="cr-error">{error}</div> : null}
        {loading ? (
          <div className="cr-loading">Loading secrets...</div>
        ) : !projectId ? (
          <div className="empty-state">Enter a project ID above to view secrets.</div>
        ) : (
          <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
            <div style={{ flex: 1, overflow: 'auto', display: 'flex', gap: 0 }}>
              <div style={{ flex: selectedSecret ? '0 0 50%' : '1 1 100%', overflow: 'auto', borderRight: selectedSecret ? '1px solid var(--border)' : 'none' }}>
                <table className="bq-table">
                  <thead>
                    <tr>
                      <th style={{ width: '45%' }}>Secret Name</th>
                      <th style={{ width: '20%' }}>Replication</th>
                      <th style={{ width: '20%' }}>Created</th>
                      <th style={{ width: '15%', textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSecrets.length === 0 ? (
                      <tr>
                        <td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                          {searchQuery ? 'No secrets match your filter.' : 'No secrets found.'}
                        </td>
                      </tr>
                    ) : (
                      filteredSecrets.map((secret) => (
                        <tr
                          key={secret.name}
                          onClick={() => handleSelectSecret(secret)}
                          style={{
                            cursor: 'pointer',
                            background: selectedSecret?.name === secret.name ? 'var(--accent-soft)' : undefined,
                          }}
                        >
                          <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 13 }}>
                            {secret.displayName}
                          </td>
                          <td>{secret.replication}</td>
                          <td>{formatTime(secret.createTime)}</td>
                          <td style={{ textAlign: 'center' }}>
                            <button
                              className="secondary-button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopyLatestValue(secret);
                              }}
                              disabled={copyingSecret === secret.name}
                              style={{ padding: '4px 8px', fontSize: 12 }}
                            >
                              {copyingSecret === secret.name ? 'Copied!' : 'Copy Latest'}
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {selectedSecret ? (
                <div style={{ flex: '0 0 50%', overflow: 'auto', padding: 24 }}>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
                      {selectedSecret.displayName}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'IBM Plex Mono, monospace' }}>
                      {selectedSecret.name}
                    </div>
                  </div>
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Versions</div>
                    {loadingVersions ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>Loading versions...</div>
                    ) : versions.length === 0 ? (
                      <div style={{ color: 'var(--muted)', fontSize: 13 }}>No versions found.</div>
                    ) : (
                      <table className="bq-table">
                        <thead>
                          <tr>
                            <th style={{ width: '25%' }}>Version</th>
                            <th style={{ width: '20%' }}>State</th>
                            <th style={{ width: '35%' }}>Created</th>
                            <th style={{ width: '20%' }}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {versions.map((version) => (
                            <tr key={version.name}>
                              <td style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 12 }}>
                                {version.versionId}
                              </td>
                              <td>
                                <span
                                  style={{
                                    padding: '2px 6px',
                                    borderRadius: 4,
                                    fontSize: 11,
                                    fontWeight: 500,
                                    background: version.state === 'ENABLED' ? '#dcfce7' : '#f3f4f6',
                                    color: version.state === 'ENABLED' ? '#166534' : '#6b7280',
                                  }}
                                >
                                  {version.state}
                                </span>
                              </td>
                              <td style={{ fontSize: 12 }}>{formatTime(version.createTime)}</td>
                              <td>
                                <button
                                  className="secondary-button"
                                  onClick={() => handleCopyVersion(version)}
                                  disabled={version.state !== 'ENABLED'}
                                  style={{ padding: '2px 6px', fontSize: 11 }}
                                >
                                  Copy
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SecretManagerTab;
