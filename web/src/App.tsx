import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { StatusProvider, useAuth } from './lib/hooks';
import { LoadingBlock } from './components/ui';
import { LoginPage } from './pages/Login';
import { OverviewPage } from './pages/Overview';
import { LeadsPage } from './pages/Leads';
import { LeadDetailPage } from './pages/LeadDetail';
import { MarketResearchPage } from './pages/MarketResearch';
import { OpportunitiesPage } from './pages/Opportunities';
import { AgentsPage } from './pages/Agents';
import { WorkflowsPage } from './pages/Workflows';
import { MessagesPage } from './pages/Messages';
import { ApprovalsPage } from './pages/Approvals';
import { ProjectsPage } from './pages/Projects';
import { AnalyticsPage } from './pages/Analytics';
import { SettingsPage } from './pages/Settings';
import { IntegrationsPage } from './pages/Integrations';
import { LogsPage } from './pages/Logs';

export function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoadingBlock label="Starting the platform" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <StatusProvider>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/research" element={<MarketResearchPage />} />
          <Route path="/opportunities" element={<OpportunitiesPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/leads/:id" element={<LeadDetailPage />} />
          <Route path="/messages" element={<MessagesPage />} />
          <Route path="/approvals" element={<ApprovalsPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/workflows" element={<WorkflowsPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/integrations" element={<IntegrationsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </StatusProvider>
  );
}
