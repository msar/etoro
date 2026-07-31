import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { PrivacyProvider } from './privacy';
import { AbnAmroPage } from './pages/AbnAmroPage';
import { EtoroPage } from './pages/EtoroPage';
import { EtradePage } from './pages/EtradePage';
import { KrakenPage } from './pages/KrakenPage';
import { OverviewPage } from './pages/OverviewPage';

export default function App() {
  return (
    <PrivacyProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/etoro" element={<EtoroPage />} />
          <Route path="/abnamro" element={<AbnAmroPage />} />
          <Route path="/etrade" element={<EtradePage />} />
          <Route path="/kraken" element={<KrakenPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </PrivacyProvider>
  );
}
