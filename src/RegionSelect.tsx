import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DEFAULT_REGIONS = [
  'us-west1',
  'us-central1',
  'us-east1',
  'us-east4',
  'us-south1',
  'us-west2',
  'us-west3',
  'us-west4',
  'northamerica-northeast1',
  'northamerica-northeast2',
  'southamerica-east1',
  'europe-west1',
  'europe-west2',
  'europe-west3',
  'europe-west4',
  'europe-west6',
  'europe-central2',
  'europe-north1',
  'asia-northeast1',
  'asia-northeast2',
  'asia-northeast3',
  'asia-east1',
  'asia-east2',
  'asia-south1',
  'asia-southeast1',
  'asia-southeast2',
  'australia-southeast1',
  'me-west1',
];

const STORAGE_KEY = 'better-gcp:known-regions';

function readKnownRegions(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeKnownRegions(regions: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(regions));
  } catch {
    // Ignore storage errors.
  }
}

type RegionSelectProps = {
  regions: string[];
  onChange: (regions: string[]) => void;
};

const RegionSelect = ({ regions, onChange }: RegionSelectProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [customRegions, setCustomRegions] = useState<string[]>(readKnownRegions);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const allRegions = useMemo(() => {
    const set = new Set([...DEFAULT_REGIONS, ...customRegions]);
    return [...set].sort();
  }, [customRegions]);

  const filtered = useMemo(() => {
    const base = query ? allRegions.filter((r) => r.includes(query.toLowerCase())) : allRegions;
    return [...base].sort((a, b) => {
      const aActive = regions.includes(a) ? 0 : 1;
      const bActive = regions.includes(b) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return a.localeCompare(b);
    });
  }, [allRegions, query, regions]);

  const exactMatch = useMemo(
    () => allRegions.includes(query.trim().toLowerCase()),
    [allRegions, query]
  );

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  const toggle = useCallback(
    (r: string) => {
      const next = regions.includes(r) ? regions.filter((x) => x !== r) : [...regions, r];
      onChange(next);
    },
    [regions, onChange]
  );

  const addCustom = useCallback(
    (r: string) => {
      const trimmed = r.trim().toLowerCase();
      if (!trimmed) return;
      if (!allRegions.includes(trimmed)) {
        const next = [...customRegions, trimmed];
        setCustomRegions(next);
        writeKnownRegions(next);
      }
      if (!regions.includes(trimmed)) {
        onChange([...regions, trimmed]);
      }
      setQuery('');
    },
    [allRegions, customRegions, regions, onChange]
  );

  return (
    <div className="region-select" ref={ref}>
      <button
        className="region-select-trigger"
        onClick={() => setOpen((v) => !v)}
      >
        Regions ({regions.length})
        <span className="cr-dropdown-arrow">{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="region-select-menu">
          <div className="region-select-search">
            <input
              ref={inputRef}
              className="region-select-input"
              placeholder="Search or add region..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && query.trim()) {
                  e.preventDefault();
                  if (filtered.length === 1) {
                    toggle(filtered[0]);
                    setQuery('');
                  } else if (!exactMatch && query.trim()) {
                    addCustom(query);
                  }
                } else if (e.key === 'Escape') {
                  setOpen(false);
                  setQuery('');
                }
              }}
            />
            {query.trim() && !exactMatch && filtered.length === 0 && (
              <button
                className="region-select-add-btn"
                onClick={() => addCustom(query)}
              >
                Add &quot;{query.trim()}&quot;
              </button>
            )}
          </div>
          <div className="region-select-list">
            {filtered.map((r) => (
              <button
                key={r}
                className={`region-select-item ${regions.includes(r) ? 'active' : ''}`}
                onClick={() => toggle(r)}
              >
                <span className="cr-project-check">
                  {regions.includes(r) ? '\u2705' : '\u2B1C'}
                </span>
                <span className="region-select-name">{r}</span>
              </button>
            ))}
            {query.trim() && !exactMatch && filtered.length > 0 && (
              <button
                className="region-select-item region-select-custom"
                onClick={() => addCustom(query)}
              >
                <span className="cr-project-check">{'\u2795'}</span>
                <span className="region-select-name">Add &quot;{query.trim()}&quot;</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default RegionSelect;
