import React, { useEffect, useMemo, useState } from 'react';
import GcsTab from './GcsTab';
import BigQueryTab from './BigQueryTab';
import VertexAITab from './VertexAITab';
import PipelinesTab from './PipelinesTab';

type ServiceTab = 'gcs' | 'bigquery' | 'vertex-ai' | 'pipelines';
type ThemePreference = 'system' | 'light' | 'dark';

const TAB_ORDER: ServiceTab[] = ['gcs', 'bigquery', 'vertex-ai', 'pipelines'];
const THEME_STORAGE_KEY = 'better-gcp:theme';

const isThemePreference = (value: string): value is ThemePreference =>
  value === 'system' || value === 'light' || value === 'dark';

const App = () => {
  const [activeService, setActiveService] = useState<ServiceTab>('gcs');
  const [themePreference, setThemePreference] = useState<ThemePreference>('system');
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );

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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.key !== 'Tab') return;
      event.preventDefault();
      const direction = event.shiftKey ? -1 : 1;
      setActiveService((current) => {
        const idx = TAB_ORDER.indexOf(current);
        const next = (idx + direction + TAB_ORDER.length) % TAB_ORDER.length;
        return TAB_ORDER[next];
      });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app-root">
      <div className="service-tabs">
        <button
          className={`service-tab ${activeService === 'gcs' ? 'active' : ''}`}
          onClick={() => setActiveService('gcs')}
        >
          Cloud Storage
        </button>
        <button
          className={`service-tab ${activeService === 'bigquery' ? 'active' : ''}`}
          onClick={() => setActiveService('bigquery')}
        >
          BigQuery
        </button>
        <button
          className={`service-tab ${activeService === 'vertex-ai' ? 'active' : ''}`}
          onClick={() => setActiveService('vertex-ai')}
        >
          Vertex AI Jobs
        </button>
        <button
          className={`service-tab ${activeService === 'pipelines' ? 'active' : ''}`}
          onClick={() => setActiveService('pipelines')}
        >
          Pipelines
        </button>
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
      </div>
    </div>
  );
};

export default App;
