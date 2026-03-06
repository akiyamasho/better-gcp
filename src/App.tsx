import React, { useState } from 'react';
import GcsTab from './GcsTab';
import BigQueryTab from './BigQueryTab';
import VertexAITab from './VertexAITab';

type ServiceTab = 'gcs' | 'bigquery' | 'vertex-ai';

const App = () => {
  const [activeService, setActiveService] = useState<ServiceTab>('gcs');

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
      </div>
      <div className="service-content">
        {activeService === 'gcs' && <GcsTab />}
        {activeService === 'bigquery' && <BigQueryTab />}
        {activeService === 'vertex-ai' && <VertexAITab />}
      </div>
    </div>
  );
};

export default App;
