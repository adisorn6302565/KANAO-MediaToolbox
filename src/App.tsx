// เส้นทางของทั้ง 22 หน้า (โหลดแบบ lazy เพื่อให้เปิดโปรแกรมเร็ว)
import { lazy, Suspense, useEffect, Component, type ReactNode } from "react";
import { Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { useApp } from "./store/app";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Downloader = lazy(() => import("./pages/Downloader"));
const Converter = lazy(() => import("./pages/Converter"));
const Compressor = lazy(() => import("./pages/Compressor"));
const Editor = lazy(() => import("./pages/Editor"));
const Player = lazy(() => import("./pages/Player"));
const Automation = lazy(() => import("./pages/Automation"));
const CloudSync = lazy(() => import("./pages/CloudSync"));
const Analytics = lazy(() => import("./pages/Analytics"));
const Cleaner = lazy(() => import("./pages/Cleaner"));
const Library = lazy(() => import("./pages/Library"));
const Utilities = lazy(() => import("./pages/Utilities"));
const Streaming = lazy(() => import("./pages/Streaming"));
const Security = lazy(() => import("./pages/Security"));
const Social = lazy(() => import("./pages/Social"));
const Developer = lazy(() => import("./pages/Developer"));
const Fun = lazy(() => import("./pages/Fun"));
const Help = lazy(() => import("./pages/Help"));
const SystemPage = lazy(() => import("./pages/System"));
const Personalize = lazy(() => import("./pages/Personalize"));
const HistoryPage = lazy(() => import("./pages/History"));
const SettingsPage = lazy(() => import("./pages/Settings"));

/** กันหน้าพังทั้งโปรแกรม — แสดงข้อความภาษาไทยแทน */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error)
      return (
        <div className="card mx-auto mt-10 max-w-lg text-center">
          <div className="text-4xl">😵</div>
          <h2 className="mt-2 font-display text-lg">หน้านี้เกิดข้อผิดพลาด</h2>
          <p className="mt-1 text-sm text-muted selectable">{this.state.error.message}</p>
          <button className="btn-primary mt-4" onClick={() => this.setState({ error: null })}>
            ลองใหม่
          </button>
        </div>
      );
    return this.props.children;
  }
}

function Loading() {
  return (
    <div className="grid h-64 place-items-center text-muted">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
    </div>
  );
}

export default function App() {
  const init = useApp((s) => s.init);
  const ready = useApp((s) => !!s.settings);
  useEffect(() => {
    init().catch((e) => console.error(e));
  }, [init]);
  if (!ready) return <Loading />;
  const page = (el: ReactNode) => (
    <ErrorBoundary>
      <Suspense fallback={<Loading />}>{el}</Suspense>
    </ErrorBoundary>
  );
  return (
    <Layout>
      <Routes>
        <Route path="/" element={page(<Dashboard />)} />
        <Route path="/download" element={page(<Downloader />)} />
        <Route path="/convert" element={page(<Converter />)} />
        <Route path="/compress" element={page(<Compressor />)} />
        <Route path="/editor" element={page(<Editor />)} />
        <Route path="/player" element={page(<Player />)} />
        <Route path="/automation" element={page(<Automation />)} />
        <Route path="/cloud" element={page(<CloudSync />)} />
        <Route path="/analytics" element={page(<Analytics />)} />
        <Route path="/cleaner" element={page(<Cleaner />)} />
        <Route path="/library" element={page(<Library />)} />
        <Route path="/utilities" element={page(<Utilities />)} />
        <Route path="/streaming" element={page(<Streaming />)} />
        <Route path="/security" element={page(<Security />)} />
        <Route path="/social" element={page(<Social />)} />
        <Route path="/developer" element={page(<Developer />)} />
        <Route path="/fun" element={page(<Fun />)} />
        <Route path="/help" element={page(<Help />)} />
        <Route path="/system" element={page(<SystemPage />)} />
        <Route path="/personalize" element={page(<Personalize />)} />
        <Route path="/history" element={page(<HistoryPage />)} />
        <Route path="/settings" element={page(<SettingsPage />)} />
        <Route path="*" element={page(<Dashboard />)} />
      </Routes>
    </Layout>
  );
}
