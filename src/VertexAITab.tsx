import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { VertexAICustomJob } from '@shared/types';
import RegionSelect from './RegionSelect';

const STATUS_EMOJI: Record<string, string> = {
  UNSPECIFIED: '\u{1F914}',
  QUEUED: '\u{23F3}',
  PENDING: '\u{23F1}\uFE0F',
  RUNNING: '\u{1F3C3}\u{1F4A8}',
  SUCCEEDED: '\u{2705}',
  FAILED: '\u{274C}',
  CANCELLING: '\u{1F6D1}',
  CANCELLED: '\u{1F6AB}',
  PAUSED: '\u{23F8}\uFE0F',
  EXPIRED: '\u{1F480}',
  UPDATING: '\u{1F504}',
};

const ACTIVE_STATES = new Set(['QUEUED', 'PENDING', 'RUNNING']);
const ALL_STATES = [
  'QUEUED',
  'PENDING',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLING',
  'CANCELLED',
  'PAUSED',
  'EXPIRED',
  'UPDATING',
];

const PAGE_SIZE = 30;

function formatTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false });
}

function jobId(name: string): string {
  const parts = name.split('/');
  return parts[parts.length - 1] ?? name;
}

function consoleUrl(job: VertexAICustomJob, projectId: string): string {
  const id = jobId(job.name);
  return `https://console.cloud.google.com/vertex-ai/locations/${job.region}/training/custom-jobs/${id}?project=${projectId}`;
}

function logsUrl(job: VertexAICustomJob, projectId: string): string {
  const id = jobId(job.name);
  let ts = '';
  if (job.createTime) {
    ts = `%20timestamp%3E%3D%22${encodeURIComponent(job.createTime)}%22`;
  }
  const query = `resource.labels.job_id%3D%22${id}%22${ts}`;
  return `https://console.cloud.google.com/logs/query;query=${query}?project=${projectId}`;
}

const VertexAITab = () => {
  const [projectId, setProjectId] = useState('');
  const [projectInput, setProjectInput] = useState('');
  const [regions, setRegions] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('better-gcp:vertexai-regions');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return ['us-west1'];
  });
  const [stateFilter, setStateFilter] = useState<Set<string>>(new Set());
  const [jobs, setJobs] = useState<VertexAICustomJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState('');
  const [pageTokens, setPageTokens] = useState<Record<string, string | undefined>>({});
  const [loadingMore, setLoadingMore] = useState<string | null>(null);

  useEffect(() => {
    // Read default project from gcloud env (same pattern as BQ)
    (window as any).bq?.listProjects?.().then((res: any) => {
      if (res?.ok && res.data?.length > 0) {
        const first = res.data[0].id;
        setProjectId(first);
        setProjectInput(first);
      }
    });
  }, []);

  const fetchJobs = useCallback(async () => {
    if (!projectId || regions.length === 0) return;
    setLoading(true);
    setError('');
    setSelected(new Set());
    setExpandedJob(null);
    setPageTokens({});

    try {
      const results = await Promise.all(
        regions.map(async (region) => {
          const res = await (window as any).vertexai.listCustomJobs({
            projectId,
            region,
            pageSize: PAGE_SIZE,
          });
          if (!res.ok) throw new Error(res.error);
          setPageTokens((prev) => ({ ...prev, [region]: res.data.nextPageToken }));
          return res.data.jobs as VertexAICustomJob[];
        })
      );
      setJobs(results.flat());
    } catch (err: any) {
      setError(String(err));
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, regions]);

  useEffect(() => {
    if (projectId) fetchJobs();
  }, [projectId, regions, fetchJobs]);

  const loadMore = useCallback(
    async (region: string) => {
      const token = pageTokens[region];
      if (!token) return;
      setLoadingMore(region);
      try {
        const res = await (window as any).vertexai.listCustomJobs({
          projectId,
          region,
          pageSize: PAGE_SIZE,
          pageToken: token,
        });
        if (!res.ok) throw new Error(res.error);
        setJobs((prev) => [...prev, ...(res.data.jobs as VertexAICustomJob[])]);
        setPageTokens((prev) => ({ ...prev, [region]: res.data.nextPageToken }));
      } catch (err: any) {
        setError(String(err));
      } finally {
        setLoadingMore(null);
      }
    },
    [projectId, pageTokens]
  );

  const filteredJobs = useMemo(() => {
    const filtered = stateFilter.size === 0 ? jobs : jobs.filter((j) => stateFilter.has(j.state));
    return [...filtered].sort((a, b) => {
      const ta = a.createTime ? new Date(a.createTime).getTime() : 0;
      const tb = b.createTime ? new Date(b.createTime).getTime() : 0;
      return tb - ta;
    });
  }, [jobs, stateFilter]);

  const toggleSelect = useCallback((name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (selected.size === filteredJobs.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filteredJobs.map((j) => j.name)));
    }
  }, [filteredJobs, selected]);

  const selectedJobs = useMemo(
    () => filteredJobs.filter((j) => selected.has(j.name)),
    [filteredJobs, selected]
  );

  const cancellableJobs = useMemo(
    () => selectedJobs.filter((j) => ACTIVE_STATES.has(j.state)),
    [selectedJobs]
  );
  const deletableJobs = useMemo(
    () => selectedJobs.filter((j) => !ACTIVE_STATES.has(j.state)),
    [selectedJobs]
  );

  const cancelSelected = useCallback(async () => {
    if (cancellableJobs.length === 0) return;
    setActionMsg('');
    let ok = 0;
    const errors: string[] = [];
    for (const j of cancellableJobs) {
      const res = await (window as any).vertexai.cancelCustomJob(j.name);
      if (res.ok) ok++;
      else errors.push(`${jobId(j.name)}: ${res.error}`);
    }
    if (ok) setActionMsg(`Requested cancellation for ${ok} job(s).`);
    if (errors.length) setError(errors.join('\n'));
    setSelected(new Set());
    setTimeout(fetchJobs, 1500);
  }, [cancellableJobs, fetchJobs]);

  const deleteSelected = useCallback(async () => {
    if (deletableJobs.length === 0) return;
    setActionMsg('');
    let ok = 0;
    const errors: string[] = [];
    for (const j of deletableJobs) {
      const res = await (window as any).vertexai.deleteCustomJob(j.name);
      if (res.ok) ok++;
      else errors.push(`${jobId(j.name)}: ${res.error}`);
    }
    if (ok) setActionMsg(`Deleted ${ok} job(s).`);
    if (errors.length) setError(errors.join('\n'));
    setSelected(new Set());
    setTimeout(fetchJobs, 1500);
  }, [deletableJobs, fetchJobs]);

  const handleRegionsChange = useCallback((next: string[]) => {
    setRegions(next);
    try { localStorage.setItem('better-gcp:vertexai-regions', JSON.stringify(next)); } catch { /* ignore */ }
  }, []);

  const toggleStateFilter = useCallback((s: string) => {
    setStateFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }, []);

  const detail = expandedJob ? jobs.find((j) => j.name === expandedJob) : null;

  return (
    <div className="vai-layout">
      {/* Toolbar */}
      <div className="vai-toolbar">
        <div className="vai-toolbar-left">
          <form
            className="vai-project-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (projectInput.trim()) setProjectId(projectInput.trim());
            }}
          >
            <input
              className="vai-project-input"
              placeholder="Project ID"
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
            />
            <button className="primary-button" type="submit">
              Load
            </button>
          </form>
          <button className="secondary-button" onClick={fetchJobs} disabled={loading}>
            Refresh
          </button>
        </div>
        <div className="vai-toolbar-right">
          <RegionSelect regions={regions} onChange={handleRegionsChange} />
          <div className="vai-filter-group">
            <span className="vai-filter-label">State</span>
            <div className="vai-chips">
              {ALL_STATES.map((s) => (
                <button
                  key={s}
                  className={`vai-chip ${stateFilter.has(s) ? 'active' : ''}`}
                  onClick={() => toggleStateFilter(s)}
                >
                  {STATUS_EMOJI[s]} {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Action bar */}
      {selectedJobs.length > 0 && (
        <div className="vai-action-bar">
          <span>{selectedJobs.length} job(s) selected</span>
          <div className="vai-action-buttons">
            <button
              className="secondary-button"
              disabled={cancellableJobs.length === 0}
              onClick={cancelSelected}
              title={cancellableJobs.length > 0 ? `Cancel ${cancellableJobs.length} active job(s)` : 'No active jobs selected'}
            >
              Cancel{cancellableJobs.length > 0 ? ` (${cancellableJobs.length})` : ''}
            </button>
            <button
              className="danger-button"
              disabled={deletableJobs.length === 0}
              onClick={deleteSelected}
              title={deletableJobs.length > 0 ? `Delete ${deletableJobs.length} completed job(s)` : 'No completed jobs selected'}
            >
              Delete{deletableJobs.length > 0 ? ` (${deletableJobs.length})` : ''}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      {actionMsg && (
        <div className="vai-msg vai-msg-ok" onClick={() => setActionMsg('')}>
          {actionMsg}
        </div>
      )}
      {error && (
        <div className="vai-msg vai-msg-err" onClick={() => setError('')}>
          {error}
        </div>
      )}

      {/* Jobs table + detail */}
      <div className="vai-body">
        <div className="vai-table-area">
          {loading && <div className="vai-loading">Loading jobs...</div>}
          {!loading && filteredJobs.length === 0 && (
            <div className="empty-state">No jobs found. Enter a project ID and select regions above.</div>
          )}
          {!loading && filteredJobs.length > 0 && (
            <>
              <div className="vai-table-wrapper">
                <table className="vai-table">
                  <thead>
                    <tr>
                      <th className="vai-th-check">
                        <input
                          type="checkbox"
                          checked={selected.size === filteredJobs.length && filteredJobs.length > 0}
                          onChange={selectAll}
                        />
                      </th>
                      <th>Name</th>
                      <th>Region</th>
                      <th>State</th>
                      <th>Created</th>
                      <th>Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredJobs.map((job) => (
                      <tr
                        key={job.name}
                        className={`vai-row ${selected.has(job.name) ? 'selected' : ''} ${
                          expandedJob === job.name ? 'expanded' : ''
                        }`}
                      >
                        <td className="vai-td-check">
                          <input
                            type="checkbox"
                            checked={selected.has(job.name)}
                            onChange={() => toggleSelect(job.name)}
                          />
                        </td>
                        <td
                          className="vai-td-name"
                          onClick={() =>
                            setExpandedJob(expandedJob === job.name ? null : job.name)
                          }
                        >
                          {job.displayName}
                        </td>
                        <td className="vai-td-region">{job.region}</td>
                        <td className="vai-td-state">
                          <span className={`vai-state vai-state-${job.state.toLowerCase()}`}>
                            {STATUS_EMOJI[job.state] ?? ''} {job.state}
                          </span>
                        </td>
                        <td className="vai-td-time">{formatTime(job.createTime)}</td>
                        <td className="vai-td-links">
                          <button
                            className="vai-link-btn"
                            onClick={() =>
                              (window as any).shell.openExternal(consoleUrl(job, projectId))
                            }
                          >
                            Console
                          </button>
                          <button
                            className="vai-link-btn"
                            onClick={() =>
                              (window as any).shell.openExternal(logsUrl(job, projectId))
                            }
                          >
                            Logs
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Load more buttons per region */}
              <div className="vai-load-more">
                {regions.map(
                  (r) =>
                    pageTokens[r] && (
                      <button
                        key={r}
                        className="secondary-button"
                        disabled={loadingMore === r}
                        onClick={() => loadMore(r)}
                      >
                        {loadingMore === r ? `Loading ${r}...` : `Load more in ${r}`}
                      </button>
                    )
                )}
              </div>
            </>
          )}
        </div>

        {/* Detail panel */}
        {detail && (
          <div className="vai-detail">
            <div className="vai-detail-header">
              <h3>{detail.displayName}</h3>
              <button
                className="vai-detail-close"
                onClick={() => setExpandedJob(null)}
              >
                &times;
              </button>
            </div>

            <div className="vai-detail-section">
              <h4>Overview</h4>
              <div className="vai-detail-grid">
                <span className="vai-detail-label">State</span>
                <span>{STATUS_EMOJI[detail.state]} {detail.state}</span>
                <span className="vai-detail-label">Region</span>
                <span>{detail.region}</span>
                <span className="vai-detail-label">Resource</span>
                <span className="vai-detail-mono">{detail.name}</span>
                <span className="vai-detail-label">Created</span>
                <span>{formatTime(detail.createTime)}</span>
                <span className="vai-detail-label">Started</span>
                <span>{formatTime(detail.startTime)}</span>
                <span className="vai-detail-label">Ended</span>
                <span>{formatTime(detail.endTime)}</span>
                <span className="vai-detail-label">Updated</span>
                <span>{formatTime(detail.updateTime)}</span>
                {detail.baseOutputDirectory && (
                  <>
                    <span className="vai-detail-label">Output</span>
                    <span className="vai-detail-mono">{detail.baseOutputDirectory}</span>
                  </>
                )}
              </div>
            </div>

            {detail.error && (
              <div className="vai-detail-section">
                <h4>Error</h4>
                <div className="vai-msg vai-msg-err">{detail.error.message}</div>
              </div>
            )}

            {detail.labels && Object.keys(detail.labels).length > 0 && (
              <div className="vai-detail-section">
                <h4>Labels</h4>
                <div className="vai-detail-grid">
                  {Object.entries(detail.labels).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <span className="vai-detail-label">{k}</span>
                      <span className="vai-detail-mono">{v}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}

            {detail.workerPoolSpecs.length > 0 && (
              <div className="vai-detail-section">
                <h4>Worker Pool</h4>
                {detail.workerPoolSpecs.map((spec, i) => (
                  <div key={i} className="vai-worker-spec">
                    <div className="vai-detail-grid">
                      <span className="vai-detail-label">Replicas</span>
                      <span>{spec.replicaCount}</span>
                      {spec.machineSpec && (
                        <>
                          <span className="vai-detail-label">Machine</span>
                          <span>{spec.machineSpec.machineType}</span>
                          {spec.machineSpec.acceleratorType && (
                            <>
                              <span className="vai-detail-label">Accelerator</span>
                              <span>
                                {spec.machineSpec.acceleratorType} x{' '}
                                {spec.machineSpec.acceleratorCount ?? 1}
                              </span>
                            </>
                          )}
                        </>
                      )}
                      {spec.diskSpec && (
                        <>
                          <span className="vai-detail-label">Disk</span>
                          <span>
                            {spec.diskSpec.bootDiskType} ({spec.diskSpec.bootDiskSizeGb} GB)
                          </span>
                        </>
                      )}
                    </div>
                    {spec.containerSpec && (
                      <div className="vai-container-spec">
                        <span className="vai-detail-label">Image</span>
                        <span className="vai-detail-mono">{spec.containerSpec.imageUri}</span>
                        {spec.containerSpec.env && spec.containerSpec.env.length > 0 && (
                          <details className="vai-env-details">
                            <summary>Environment ({spec.containerSpec.env.length})</summary>
                            <div className="vai-detail-grid">
                              {spec.containerSpec.env.map((e, ei) => (
                                <React.Fragment key={ei}>
                                  <span className="vai-detail-label">{e.name}</span>
                                  <span className="vai-detail-mono">{e.value}</span>
                                </React.Fragment>
                              ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VertexAITab;
