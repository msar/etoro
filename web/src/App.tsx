import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PrivacyProvider } from './privacy';
import { AbnAmroPage } from './pages/AbnAmroPage';
import { EtoroPage } from './pages/EtoroPage';
import { OverviewPage } from './pages/OverviewPage';

export default function App() {
  return (
    <PrivacyProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/etoro" element={<EtoroPage />} />
          <Route path="/abnamro" element={<AbnAmroPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </PrivacyProvider>
  );
}
