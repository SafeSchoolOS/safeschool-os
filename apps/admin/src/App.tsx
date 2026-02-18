import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StatusPage } from './pages/StatusPage';
import { SyncPage } from './pages/SyncPage';
import { ConfigPage } from './pages/ConfigPage';
import { ServicesPage } from './pages/ServicesPage';
import { UpdatesPage } from './pages/UpdatesPage';

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<StatusPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/config" element={<ConfigPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/updates" element={<UpdatesPage />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );
}
