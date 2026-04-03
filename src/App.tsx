import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import GcsTab from './GcsTab';
import BigQueryTab from './BigQueryTab';
import VertexAITab from './VertexAITab';
import PipelinesTab from './PipelinesTab';
import CloudRunTab from './CloudRunTab';
import GceTab from './GceTab';

type ServiceTab = 'gcs' | 'bigquery' | 'vertex-ai' | 'pipelines' | 'cloud-run' | 'gce';
type ThemePreference = 'system' | 'light' | 'dark';

const TAB_ORDER: ServiceTab[] = ['gcs', 'bigquery', 'vertex-ai', 'pipelines', 'cloud-run', 'gce'];

const TAB_LABELS: Record<ServiceTab, string> = {
  gcs: 'Cloud Storage',
  bigquery: 'BigQuery',
  'vertex-ai': 'AI Jobs',
  pipelines: 'AI Pipelines',
  'cloud-run': 'Cloud Run',
  gce: 'Compute Engine',
};

const THEME_STORAGE_KEY = 'better-gcp:theme';

const isThemePreference = (value: string): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

const App = () => {
  const [activeService, setActiveService] = useState<ServiceTab>('gcs');
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

  const [showTabPalette, setShowTabPalette] = useState(false);
  const [tabPaletteQuery, setTabPaletteQuery] = useState('');
  const [tabPaletteIndex, setTabPaletteIndex] = useState(0);
  const tabPaletteInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (raw && isThemePreference(raw)) {
        setThemePreference(raw);
      }
    } catch {
      // Ignore storage errors.
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, themePreference);
    } catch {
      // Ignore storage errors.
    }
  }, [themePreference]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => {
      setSystemPrefersDark(event.matches);
    };
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);

  const resolvedTheme = useMemo(
    () => (themePreference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themePreference),
    [themePreference, systemPrefersDark]
  );

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  const filteredTabs = useMemo(() => {
    if (!tabPaletteQuery) return TAB_ORDER;
    const lower = tabPaletteQuery.toLowerCase();
    return TAB_ORDER.filter((tab) => TAB_LABELS[tab].toLowerCase().includes(lower));
  }, [tabPaletteQuery]);

  const handleTabPaletteSelect = useCallback((tab: ServiceTab) => {
    setActiveService(tab);
    setShowTabPalette(false);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key === 'Tab') {
        event.preventDefault();
        const direction = event.shiftKey ? -1 : 1;
        setActiveService((current) => {
          const idx = TAB_ORDER.indexOf(current);
          const next = (idx + direction + TAB_ORDER.length) % TAB_ORDER.length;
          return TAB_ORDER[next];
        });
        return;
      }

      if (mod && event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setShowTabPalette(true);
        setTabPaletteQuery('');
        setTabPaletteIndex(0);
        setTimeout(() => tabPaletteInputRef.current?.focus(), 50);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app-root">
      <div className="service-tabs">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            className={`service-tab ${activeService === tab ? 'active' : ''}`}
            onClick={() => setActiveService(tab)}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
        <div className="service-settings">
          <label className="service-settings-label" htmlFor="theme-preference">
            Theme
          </label>
          <select
            id="theme-preference"
            className="service-settings-select"
            value={themePreference}
            onChange={(event) => setThemePreference(event.target.value as ThemePreference)}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>
      <div className="service-content">
        <div className={`service-panel ${activeService === 'gcs' ? 'active' : ''}`}>
          <GcsTab isActive={activeService === 'gcs'} />
        </div>
        <div className={`service-panel ${activeService === 'bigquery' ? 'active' : ''}`}>
          <BigQueryTab isActive={activeService === 'bigquery'} />
        </div>
        <div className={`service-panel ${activeService === 'vertex-ai' ? 'active' : ''}`}>
          <VertexAITab />
        </div>
        <div className={`service-panel ${activeService === 'pipelines' ? 'active' : ''}`}>
          <PipelinesTab isActive={activeService === 'pipelines'} />
        </div>
        <div className={`service-panel ${activeService === 'cloud-run' ? 'active' : ''}`}>
          <CloudRunTab isActive={activeService === 'cloud-run'} />
        </div>
        <div className={`service-panel ${activeService === 'gce' ? 'active' : ''}`}>
          <GceTab isActive={activeService === 'gce'} />
        </div>
      </div>

      {/* Tab palette (Cmd+Shift+P) */}
      {showTabPalette && (
        <div className="modal-backdrop" onClick={() => setShowTabPalette(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Go to Tab</span>
              <span className="modal-shortcut">\u2318\u21E7P</span>
            </div>
            <input
              className="modal-input"
              ref={tabPaletteInputRef}
              value={tabPaletteQuery}
              onChange={(e) => {
                setTabPaletteQuery(e.target.value);
                setTabPaletteIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setTabPaletteIndex((i) => Math.min(i + 1, filteredTabs.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setTabPaletteIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && filteredTabs.length > 0) {
                  e.preventDefault();
                  handleTabPaletteSelect(filteredTabs[tabPaletteIndex]);
                } else if (e.key === 'Escape') {
                  setShowTabPalette(false);
                }
              }}
              placeholder="Type to filter tabs..."
            />
            <div className="modal-list">
              {filteredTabs.length === 0 && (
                <div className="modal-empty">No matching tabs.</div>
              )}
              {filteredTabs.map((tab, i) => (
                <button
                  key={tab}
                  className={`modal-item ${i === tabPaletteIndex ? 'active' : ''} ${activeService === tab ? 'tab-palette-current' : ''}`}
                  onClick={() => handleTabPaletteSelect(tab)}
                >
                  <span className="modal-item-title">
                    {TAB_LABELS[tab]}
                    {activeService === tab && (
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>current</span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
