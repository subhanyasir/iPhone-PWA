import { Children, cloneElement, createContext, isValidElement, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Activity, ArrowDownToLine, BarChart3, Check, ChevronDown, CircleHelp, Clock3, Database,
  Download, FileText, HardDrive, History, Home, LoaderCircle, Moon, Pause, Play, Plus,
  Radio, Settings as SettingsIcon, ShieldCheck, Smartphone, Sun, Trash2, TriangleAlert, X
} from "lucide-react";
import {
  countEntries, createSession, deleteAllData, deleteSession, estimateStorage, getSessionEntryCount,
  getSessions, getSettings, markInterruptedSessions, saveBatch, saveSettings, streamSession, updateSession
} from "./db";
import type { GenerationSession, GeneratorSettings, Section, SessionStatus } from "./types";
import { exportHeader, formatExportChunk } from "./exportFormat";
import { formatLocale, translateText, type Locale } from "./i18n";

const navigation: { name: Section; icon: typeof Home }[] = [
  { name: "Dashboard", icon: Home },
  { name: "Generate", icon: Plus },
  { name: "History", icon: History },
  { name: "Export", icon: Download },
  { name: "Settings", icon: SettingsIcon }
];

const initialSettings: GeneratorSettings = {
  countryCode: "39",
  quantity: 1000,
  batchSize: 500,
  avoidDuplicates: true,
  exportFormat: "TXT"
};
const LocaleContext = createContext<Locale>("it");

const formatNumber = (value: number) => new Intl.NumberFormat(document.documentElement.lang || "it-IT").format(value);
const formatBytes = (value?: number) => {
  if (value === undefined) return "Not available";
  const locale = document.documentElement.lang || "it-IT";
  if (value < 1024 * 1024) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value / 1024)} KB`;
  return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / (1024 * 1024 * 1024))} GB`;
};
const formatDate = (value?: number) => value ? new Intl.DateTimeFormat(document.documentElement.lang || "it-IT", { dateStyle: "medium", timeStyle: "short" }).format(value) : "No sessions yet";
const statusLabel: Record<SessionStatus, string> = {
  running: "In progress", complete: "Completed", cancelled: "Cancelled", interrupted: "Interrupted", error: "Error"
};

interface ActiveGeneration {
  worker: Worker;
  session: GenerationSession;
  startedAt: number;
  pendingSave?: Promise<void>;
}

function App() {
  const [locale, setLocale] = useState<Locale>(() => localStorage.getItem("numero-locale") === "en" ? "en" : "it");
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("numero-theme") === "light" ? "light" : "dark");
  const [section, setSection] = useState<Section>("Dashboard");
  const [settings, setSettings] = useState(initialSettings);
  const [sessions, setSessions] = useState<GenerationSession[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [storage, setStorage] = useState<{ usage?: number; quota?: number }>({});
  const [active, setActive] = useState<ActiveGeneration | null>(null);
  const [progress, setProgress] = useState({ done: 0, speed: 0, paused: false, startedAt: 0 });
  const [selectedExportId, setSelectedExportId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportFormat, setExportFormat] = useState<"TXT" | "CSV">("TXT");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const activeRef = useRef<ActiveGeneration | null>(null);
  const cancelRef = useRef(false);
  const generationErrorRef = useRef(false);

  useLayoutEffect(() => {
    document.documentElement.lang = formatLocale(locale);
    document.documentElement.style.colorScheme = theme;
    document.title = locale === "it" ? "Generatore di numeri italiani" : "Italian Number Generator";
    document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute(
      "content",
      locale === "it"
        ? "Genera numeri di prova in formato italiano, in modo privato e direttamente sul tuo dispositivo."
        : "Generate Italian-format test phone numbers privately on your device."
    );
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      "content",
      theme === "dark" ? "#0b0d0c" : "#f4f6f1"
    );
    localStorage.setItem("numero-locale", locale);
    localStorage.setItem("numero-theme", theme);
  }, [locale, theme]);

  const refresh = useCallback(async () => {
    const [nextSessions, entries, nextStorage] = await Promise.all([getSessions(), countEntries(), estimateStorage()]);
    setSessions(nextSessions);
    setTotalEntries(entries);
    setStorage(nextStorage);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([markInterruptedSessions(), getSettings()])
      .then(async ([, savedSettings]) => {
        if (!mounted) return;
        setSettings(savedSettings);
        await refresh();
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load local data."))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
      if (activeRef.current) activeRef.current.worker.terminate();
    };
  }, [refresh]);

  const currentSession = active?.session;
  const latestSession = sessions[0];
  const percentComplete = currentSession
    ? Math.min(100, Math.round((progress.done / currentSession.requested) * 100))
    : 0;
  const speed = progress.startedAt ? Math.round(progress.done / Math.max(1, (Date.now() - progress.startedAt) / 1000)) : progress.speed;

  const updateSettings = (patch: Partial<GeneratorSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not save settings."));
  };

  const finishGeneration = useCallback(async (status: SessionStatus, generation: ActiveGeneration) => {
    if (generation.pendingSave) await generation.pendingSave;
    generation.worker.terminate();
    const finished = { ...generation.session, status, updatedAt: Date.now() };
    await updateSession(finished);
    activeRef.current = null;
    setActive(null);
    setProgress((previous) => ({ ...previous, paused: false }));
    await refresh();
    if (status === "complete") setNotice(`${formatNumber(finished.generated)} numbers generated successfully.`);
    else if (status === "cancelled") setNotice(`Generation stopped. ${formatNumber(finished.generated)} numbers were saved.`);
  }, [refresh]);

  const startGeneration = async () => {
    setError("");
    setNotice("");
    if (activeRef.current) {
      setError("A generation session is already active. Finish or cancel it before starting another.");
      return;
    }
    if (!/^\d{1,4}$/.test(settings.countryCode)) {
      setError("Country code must contain 1 to 4 digits.");
      return;
    }
    if (!Number.isInteger(settings.quantity) || settings.quantity < 1 || settings.quantity > 2_000_000) {
      setError("Choose between 1 and 2,000,000 entries.");
      return;
    }
    if (!Number.isInteger(settings.batchSize) || settings.batchSize < 50 || settings.batchSize > 5000) {
      setError("Batch size must be between 50 and 5,000.");
      return;
    }
    try {
      const session: GenerationSession = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
        requested: settings.quantity,
        generated: 0,
        countryCode: settings.countryCode,
        batchSize: settings.batchSize,
        avoidDuplicates: settings.avoidDuplicates,
        exportFormat: settings.exportFormat,
        status: "running"
      };
      await createSession(session);
      const worker = new Worker(new URL("./generation.worker.ts", import.meta.url), { type: "module" });
      const generation: ActiveGeneration = { worker, session, startedAt: Date.now() };
      activeRef.current = generation;
      cancelRef.current = false;
      generationErrorRef.current = false;
      setActive(generation);
      setProgress({ done: 0, speed: 0, paused: false, startedAt: Date.now() });
      setSection("Generate");
      worker.onmessage = async (event: MessageEvent<{ type: string; numbers?: string[] }>) => {
        const current = activeRef.current;
        if (!current || current.session.id !== session.id) return;
        if (event.data.type === "batch" && event.data.numbers) {
          const batch = event.data.numbers;
          current.pendingSave = (async () => {
            try {
              const { inserted } = await saveBatch(session.id, batch, settings.avoidDuplicates);
              current.session = { ...current.session, generated: current.session.generated + inserted, updatedAt: Date.now() };
              await updateSession(current.session);
              setProgress((previous) => ({ ...previous, done: current.session.generated }));
              if (inserted > 0) setTotalEntries((previous) => previous + inserted);
              if (cancelRef.current) current.worker.postMessage({ type: "cancel" });
              else current.worker.postMessage({ type: "ack", inserted });
            } catch (cause) {
              generationErrorRef.current = true;
              const isQuotaError = cause instanceof DOMException && cause.name === "QuotaExceededError";
              setError(isQuotaError
                ? "Device storage is full. Free browser storage or reduce the session size, then try again."
                : cause instanceof Error ? cause.message : "Could not save this batch.");
              current.worker.postMessage({ type: "cancel" });
              cancelRef.current = true;
            }
          })();
          await current.pendingSave;
          return;
        }
        if (event.data.type === "done") await finishGeneration("complete", current);
        if (event.data.type === "cancelled") {
          await finishGeneration(generationErrorRef.current ? "error" : cancelRef.current ? "cancelled" : "error", current);
        }
      };
      worker.onerror = (event) => {
        setError(`Generation worker failed: ${event.message || "unknown error"}`);
        generationErrorRef.current = true;
        const current = activeRef.current;
        if (current) void finishGeneration("error", current);
      };
      worker.postMessage({
        type: "start",
        quantity: settings.quantity,
        batchSize: settings.batchSize,
        countryCode: settings.countryCode
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start generation.");
    }
  };

  const pauseGeneration = () => {
    activeRef.current?.worker.postMessage({ type: "pause" });
    setProgress((previous) => ({ ...previous, paused: true }));
  };

  const resumeGeneration = () => {
    activeRef.current?.worker.postMessage({ type: "resume" });
    setProgress((previous) => ({ ...previous, paused: false }));
  };

  const cancelGeneration = () => {
    cancelRef.current = true;
    activeRef.current?.worker.postMessage({ type: "cancel" });
  };

  const downloadSession = async (session: GenerationSession, format: "TXT" | "CSV") => {
    setError("");
    setNotice("");
    setExporting(true);
    setExportProgress(0);
    let writable: FileSystemWritableFileStream | undefined;
    let parts: BlobPart[] = [];
    let fileName = `italian-numbers-${new Date(session.createdAt).toISOString().slice(0, 10)}.${format.toLowerCase()}`;
    let exported = 0;
    try {
      const pickerWindow = window as Window & {
        showSaveFilePicker?: (options: {
          suggestedName: string;
          types: { description: string; accept: Record<string, string[]> }[];
        }) => Promise<{ createWritable: () => Promise<FileSystemWritableFileStream> }>;
      };
      if (pickerWindow.showSaveFilePicker) {
        const handle = await pickerWindow.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: `${format} file`,
            accept: { [format === "CSV" ? "text/csv" : "text/plain"]: [`.${format.toLowerCase()}`] }
          }]
        });
        writable = await handle.createWritable();
      }

      const count = await getSessionEntryCount(session.id);
      const header = exportHeader(format);
      if (writable) await writable.write(header);
      else if (header) parts.push(header);

      await streamSession(session.id, async (numbers) => {
        const text = formatExportChunk(numbers, format);
        if (writable) await writable.write(text);
        else parts.push(text);
        exported += numbers.length;
        setExportProgress(count ? Math.min(100, Math.round((exported / count) * 100)) : 100);
      });

      if (writable) await writable.close();
      else {
        const blob = new Blob(parts, { type: format === "CSV" ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      await updateSession({ ...session, exportedAt: Date.now(), updatedAt: Date.now() });
      await refresh();
      setNotice(`Exported ${formatNumber(exported)} entries as ${format}.`);
    } catch (cause) {
      if (writable) await writable.abort().catch(() => undefined);
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setNotice("Export cancelled.");
      } else {
        setError(cause instanceof Error ? cause.message : "Export failed.");
      }
    } finally {
      parts = [];
      setExporting(false);
      setExportProgress(0);
    }
  };

  const removeSession = async (session: GenerationSession) => {
    if (!window.confirm(translateText(`Delete ${formatNumber(session.generated)} entries from this session? This cannot be undone.`, locale))) return;
    try {
      await deleteSession(session.id);
      await refresh();
      setNotice("Session and its generated entries were deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete the session.");
    }
  };

  const removeAll = async () => {
    if (!window.confirm(translateText(`Delete all ${formatNumber(totalEntries)} stored entries and all history? This cannot be undone.`, locale))) return;
    try {
      await deleteAllData();
      await refresh();
      setNotice("All generated data and history were deleted.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete stored data.");
    }
  };

  const exportableSessions = useMemo(() => sessions.filter((session) => session.generated > 0), [sessions]);
  const content = () => {
    if (loading) return <div className="loading-state"><LoaderCircle className="spin" size={22} /> Loading your local workspace…</div>;
    switch (section) {
      case "Dashboard":
        return <Dashboard
          totalEntries={totalEntries}
          sessions={sessions}
          storage={storage}
          active={active}
          latestSession={latestSession}
          onNavigate={setSection}
        />;
      case "Generate":
        return <Generate
          settings={settings}
          updateSettings={updateSettings}
          active={active}
          progress={{ ...progress, speed }}
          percentComplete={percentComplete}
          start={startGeneration}
          pause={pauseGeneration}
          resume={resumeGeneration}
          cancel={cancelGeneration}
        />;
      case "History":
        return <HistoryPage sessions={sessions} onExport={downloadSession} onDelete={removeSession} exporting={exporting} />;
      case "Export":
        return <ExportPage
          sessions={exportableSessions}
          selectedId={selectedExportId}
          setSelectedId={setSelectedExportId}
          format={exportFormat}
          setFormat={setExportFormat}
          onExport={downloadSession}
          exporting={exporting}
          exportProgress={exportProgress}
        />;
      case "Settings":
        return <SettingsPage settings={settings} updateSettings={updateSettings} onDeleteAll={removeAll} totalEntries={totalEntries} />;
    }
  };

  return (
    <LocaleContext.Provider value={locale}>
    <TranslateTree>
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">N<span>.</span></div>
          <div><strong>Numero</strong><small>ITALIAN GENERATOR</small></div>
        </div>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navigation.map(({ name, icon: Icon }) => (
            <button key={name} className={`nav-item ${section === name ? "selected" : ""}`} onClick={() => setSection(name)}>
              <Icon size={18} strokeWidth={1.8} /><span>{name}</span>
              {name === "History" && sessions.length > 0 && <span className="nav-count">{sessions.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="privacy-card"><ShieldCheck size={18} /><div><strong>Private by design</strong><small>Your data stays on this device.</small></div></div>
          <div className="sidebar-foot">ITALY · LOCAL STORAGE</div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand"><div className="brand-mark">N<span>.</span></div><strong>Numero</strong></div>
          <div className="breadcrumb"><span>Workspace</span><span className="crumb-slash">/</span><strong>{section}</strong></div>
          <div className="topbar-actions">
            <label className="language-select-wrap">
              <span className="sr-only">Select language</span>
              <select className="language-select" aria-label="Select language" value={locale} onChange={(event) => {
                const nextLocale = event.target.value as Locale;
                document.documentElement.lang = formatLocale(nextLocale);
                localStorage.setItem("numero-locale", nextLocale);
                setLocale(nextLocale);
              }}>
                <option value="it">Italiano</option>
                <option value="en">English</option>
              </select>
            </label>
            <button
              className="theme-toggle"
              type="button"
              title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            <div className="top-status"><span className="status-dot" /> Local database <ChevronDown size={14} /></div>
          </div>
        </header>
        <main className="main-content">
          <div className="page-heading">
            <div><p className="eyebrow">YOUR LOCAL WORKSPACE</p><h1>{section}</h1></div>
            <div className="heading-date"><Clock3 size={15} />{new Intl.DateTimeFormat(formatLocale(locale), { dateStyle: "medium" }).format(new Date())}</div>
          </div>
          {error && <div role="alert" className="message error-message"><TriangleAlert size={18} /><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError("")}><X size={16} /></button></div>}
          {notice && <div role="status" className="message success-message"><Check size={18} /><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice("")}><X size={16} /></button></div>}
          {content()}
        </main>
        <footer className="footer-note"><ShieldCheck size={14} /> Data is stored locally in this browser and never sent to a server.</footer>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map(({ name, icon: Icon }) => (
          <button key={name} className={section === name ? "selected" : ""} onClick={() => setSection(name)} aria-label={name}>
            <Icon size={19} /><span>{name}</span>
          </button>
        ))}
      </nav>
      {exporting && <div className="export-toast"><LoaderCircle className="spin" size={16} /> Preparing export <span>{exportProgress}%</span></div>}
    </div>
    </TranslateTree>
    </LocaleContext.Provider>
  );
}

function TranslateTree({ children }: { children: ReactNode }) {
  const locale = useContext(LocaleContext);
  if (locale === "en") return <>{children}</>;
  const translateNode = (node: ReactNode): ReactNode => {
    if (typeof node === "string") return translateText(node, locale);
    if (Array.isArray(node)) return node.map(translateNode);
    if (!isValidElement<Record<string, unknown>>(node)) return node;
    const props = { ...node.props };
    for (const attribute of ["aria-label", "title", "placeholder", "data-label"]) {
      const value = props[attribute];
      if (typeof value === "string") props[attribute] = translateText(value, locale);
    }
    if ("children" in props) props.children = Children.map(props.children as ReactNode, translateNode);
    return cloneElement(node, props);
  };
  return <>{translateNode(children)}</>;
}

function Dashboard({
  totalEntries, sessions, storage, active, latestSession, onNavigate
}: {
  totalEntries: number;
  sessions: GenerationSession[];
  storage: { usage?: number; quota?: number };
  active: ActiveGeneration | null;
  latestSession?: GenerationSession;
  onNavigate: (section: Section) => void;
}) {
  const progress = active ? Math.min(100, Math.round((active.session.generated / active.session.requested) * 100)) : 0;
  return (
    <TranslateTree>
    <>
      <section className="welcome-card">
        <div className="welcome-copy">
          <div className="welcome-chip"><span className="status-dot" /> DEVICE-ONLY GENERATION</div>
          <h2>Numbers, made<br /><em>effortlessly.</em></h2>
          <p>Generate Italian-format test data in seconds. Private, organized, and always on your device.</p>
          <button className="primary-button" onClick={() => onNavigate("Generate")}><Plus size={17} /> Start generating <span>→</span></button>
        </div>
        <div className="welcome-visual" aria-hidden="true">
          <div className="orb orb-one" /><div className="orb orb-two" />
          <div className="phone-card"><div className="phone-top"><span /><span /></div>          <div className="phone-number">+39 3XX XXX XXXX</div><div className="phone-line" /><div className="phone-label">GENERATED LOCALLY</div><div className="phone-badge"><Check size={13} /> Ready to use</div></div>
          <div className="visual-spark spark-a">✳</div><div className="visual-spark spark-b">✳</div>
        </div>
      </section>

      <div className="section-title-row"><div><p className="eyebrow">AT A GLANCE</p><h2 className="section-title">Your overview</h2></div><div className="live-tag"><span className="status-dot" /> LIVE</div></div>
      <section className="metric-grid">
        <MetricCard icon={Database} label="TOTAL GENERATED" value={formatNumber(totalEntries)} detail="Across all sessions" tone="lime" />
        <MetricCard icon={History} label="GENERATION SESSIONS" value={formatNumber(sessions.length)} detail="Stored in this browser" tone="violet" />
        <MetricCard icon={Activity} label="LAST GENERATION" value={latestSession ? formatDate(latestSession.createdAt).split(",")[0] : "—"} detail={latestSession ? `${formatNumber(latestSession.generated)} entries created` : "Ready for your first batch"} tone="orange" />
        <MetricCard icon={HardDrive} label="LOCAL STORAGE USED" value={formatBytes(storage.usage)} detail={storage.quota ? `of ${formatBytes(storage.quota)} available` : "Browser estimate"} tone="blue" />
      </section>

      <section className="lower-grid">
        <div className="panel activity-panel">
          <div className="panel-header"><div><p className="eyebrow">ACTIVITY</p><h3>Recent sessions</h3></div><button className="text-button" onClick={() => onNavigate("History")}>View history <span>→</span></button></div>
          {sessions.length === 0 ? <EmptyState icon={BarChart3} title="Nothing here yet" detail="Your completed generations will show up here." /> :
            <div className="session-list">{sessions.slice(0, 4).map((session) => <SessionRow key={session.id} session={session} />)}</div>}
        </div>
        <div className="panel status-panel">
          <div className="panel-header"><div><p className="eyebrow">GENERATOR</p><h3>Current status</h3></div><span className={`status-pill ${active ? "is-running" : ""}`}><span className="status-dot" />{active ? "RUNNING" : "IDLE"}</span></div>
          {active ? <div className="current-progress"><div className="progress-caption"><span>{formatNumber(active.session.generated)} / {formatNumber(active.session.requested)}</span><strong>{progress}%</strong></div><ProgressBar value={progress} /><p>Processing batch of {formatNumber(active.session.batchSize)} · {active.session.countryCode} prefix</p></div> :
            <div className="idle-state"><div className="idle-icon"><Radio size={20} /></div><strong>All quiet for now</strong><p>Your generator is ready when you are.</p><button className="secondary-button" onClick={() => onNavigate("Generate")}>Configure a batch <span>→</span></button></div>}
          <div className="privacy-inline"><ShieldCheck size={16} /><span>No server connection required</span></div>
        </div>
      </section>
    </>
    </TranslateTree>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone }: {
  icon: typeof Home; label: string; value: string; detail: string; tone: string;
}) {
  return <TranslateTree><article className="metric-card"><div className={`metric-icon ${tone}`}><Icon size={18} /></div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-detail">{detail}</div></article></TranslateTree>;
}

function Generate({ settings, updateSettings, active, progress, percentComplete, start, pause, resume, cancel }: {
  settings: GeneratorSettings;
  updateSettings: (patch: Partial<GeneratorSettings>) => void;
  active: ActiveGeneration | null;
  progress: { done: number; speed: number; paused: boolean };
  percentComplete: number;
  start: () => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
}) {
  return (
    <TranslateTree>
    <div className="generate-layout">
      <section className="panel generator-form">
        <div className="panel-header"><div><p className="eyebrow">CONFIGURE YOUR BATCH</p><h3>Generation settings</h3></div><div className="setting-icon"><SettingsIcon size={17} /></div></div>
        <div className="form-grid">
          <label className="field-label">Country code<span className="field-hint">Prefix without the + sign</span><div className="input-prefix"><span>+</span><input inputMode="numeric" value={settings.countryCode} maxLength={4} disabled={!!active} onChange={(event) => updateSettings({ countryCode: event.target.value.replace(/\D/g, "") })} /><span className="flag-chip">IT</span></div></label>
          <label className="field-label">Number of entries<span className="field-hint">Up to 2 million per session</span><input type="number" min={1} max={2_000_000} value={settings.quantity} disabled={!!active} onChange={(event) => updateSettings({ quantity: Number(event.target.value) })} /></label>
          <label className="field-label">Batch size<span className="field-hint">Smaller batches use less memory</span><select value={settings.batchSize} disabled={!!active} onChange={(event) => updateSettings({ batchSize: Number(event.target.value) })}><option value={100}>{formatNumber(100)} entries</option><option value={250}>{formatNumber(250)} entries</option><option value={500}>{formatNumber(500)} entries</option><option value={1000}>{formatNumber(1000)} entries</option><option value={2500}>{formatNumber(2500)} entries</option><option value={5000}>{formatNumber(5000)} entries</option></select></label>
          <label className="field-label">Export format<span className="field-hint">Default for quick exports</span><select value={settings.exportFormat} disabled={!!active} onChange={(event) => updateSettings({ exportFormat: event.target.value as "TXT" | "CSV" })}><option value="TXT">TXT — one number per line</option><option value="CSV">CSV — spreadsheet ready</option></select></label>
        </div>
        <label className="toggle-row"><div className="toggle-copy"><strong>Avoid duplicates</strong><span>Skip numbers already stored on this device.</span></div><input type="checkbox" checked={settings.avoidDuplicates} disabled={!!active} onChange={(event) => updateSettings({ avoidDuplicates: event.target.checked })} /><span className="toggle-control" /></label>
        <div className="format-note"><CircleHelp size={15} /><span>Synthetic format only; a generated value may match a real number. Do not call or message these entries.</span></div>
        {active ? <div className="active-controls">
          <div className="progress-header"><span>{progress.paused ? "Generation paused" : "Generating your numbers"}</span><strong>{percentComplete}%</strong></div>
          <ProgressBar value={percentComplete} />
          <div className="progress-stats"><span><strong>{formatNumber(progress.done)}</strong> / {formatNumber(active.session.requested)} entries</span><span>{formatNumber(progress.speed)} / sec</span></div>
          <div className="control-buttons">
            {progress.paused ? <button className="secondary-button" onClick={resume}><Play size={16} /> Resume</button> : <button className="secondary-button" onClick={pause}><Pause size={16} /> Pause</button>}
            <button className="danger-outline" onClick={cancel}><X size={16} /> Cancel generation</button>
          </div>
        </div> : <button className="primary-button full-button" onClick={start}><Plus size={17} /> Generate {formatNumber(settings.quantity || 0)} numbers <span>→</span></button>}
        <div className="local-note"><ShieldCheck size={17} /><div><strong>Everything stays local</strong><span>Your numbers never leave this browser or device.</span></div></div>
      </section>
      <aside className="generate-aside">
        <div className="panel quick-tip"><div className="tip-icon"><Smartphone size={19} /></div><p className="eyebrow">BUILT FOR YOUR PHONE</p><h3>Works beautifully on iPhone.</h3><p>Install this app from Safari to keep your number workspace one tap away—even offline.</p><div className="tip-footer"><span>HOME SCREEN READY</span><ArrowDownToLine size={15} /></div></div>
        <div className="panel generation-facts"><p className="eyebrow">BATCH DETAILS</p><div className="fact-row"><span>Country code</span><strong>+{settings.countryCode || "—"}</strong></div><div className="fact-row"><span>Requested volume</span><strong>{formatNumber(settings.quantity || 0)}</strong></div><div className="fact-row"><span>Duplicate check</span><strong>{settings.avoidDuplicates ? "On" : "Off"}</strong></div></div>
      </aside>
    </div>
    </TranslateTree>
  );
}

function HistoryPage({ sessions, onExport, onDelete, exporting }: {
  sessions: GenerationSession[];
  onExport: (session: GenerationSession, format: "TXT" | "CSV") => void;
  onDelete: (session: GenerationSession) => void;
  exporting: boolean;
}) {
  return <TranslateTree><section className="panel history-panel"><div className="panel-header"><div><p className="eyebrow">YOUR LOCAL ARCHIVE</p><h3>Generation history</h3></div><span className="history-count">{sessions.length} {sessions.length === 1 ? "SESSION" : "SESSIONS"}</span></div>
    {sessions.length === 0 ? <EmptyState icon={History} title="No generation history" detail="Once you generate your first batch, it will be saved here." /> :
      <div className="history-table-wrap"><table className="history-table"><thead><tr><th>SESSION</th><th>ENTRIES</th><th>SETTINGS</th><th>STATUS</th><th>EXPORT</th><th /></tr></thead><tbody>
        {sessions.map((session) => <tr key={session.id}>
          <td data-label="Session"><strong>{formatDate(session.createdAt)}</strong><small>{session.id.slice(0, 8)}</small></td>
          <td data-label="Entries"><strong>{formatNumber(session.generated)}</strong><small>of {formatNumber(session.requested)} requested</small></td>
          <td data-label="Settings"><strong>+{session.countryCode} · {session.batchSize}/batch</strong><small>Deduplication {session.avoidDuplicates ? "on" : "off"}</small></td>
          <td data-label="Status"><span className={`table-status ${session.status}`}><i />{statusLabel[session.status]}</span></td>
          <td data-label="Export"><span className="export-status">{session.exportedAt ? `Exported ${formatDate(session.exportedAt)}` : "Not exported"}</span></td>
          <td data-label="Actions"><div className="table-actions">{session.generated > 0 && <button className="icon-button" disabled={exporting} onClick={() => onExport(session, session.exportFormat)} aria-label={`Export ${session.id}`} title="Export session"><Download size={16} /></button>}<button className="icon-button delete-action" onClick={() => onDelete(session)} aria-label={`Delete ${session.id}`} title="Delete session"><Trash2 size={16} /></button></div></td>
        </tr>)}
      </tbody></table></div>}
  </section></TranslateTree>;
}

function ExportPage({ sessions, selectedId, setSelectedId, format, setFormat, onExport, exporting, exportProgress }: {
  sessions: GenerationSession[];
  selectedId: string;
  setSelectedId: (id: string) => void;
  format: "TXT" | "CSV";
  setFormat: (format: "TXT" | "CSV") => void;
  onExport: (session: GenerationSession, format: "TXT" | "CSV") => void;
  exporting: boolean;
  exportProgress: number;
}) {
  const selected = sessions.find((session) => session.id === selectedId) ?? sessions[0];
  useEffect(() => {
    if (!selectedId && sessions[0]) setSelectedId(sessions[0].id);
  }, [selectedId, sessions, setSelectedId]);
  return <TranslateTree><div className="export-layout"><section className="panel export-panel"><div className="panel-header"><div><p className="eyebrow">TAKE YOUR DATA WITH YOU</p><h3>Export a session</h3></div><div className="setting-icon"><Download size={17} /></div></div>
    {sessions.length === 0 ? <EmptyState icon={FileText} title="Nothing to export yet" detail="Generate a session first and you can download it here." /> : <>
      <label className="field-label">Choose a generation session<span className="field-hint">Select which saved batch to export</span><select value={selected?.id ?? ""} onChange={(event) => setSelectedId(event.target.value)}>{sessions.map((session) => <option key={session.id} value={session.id}>{formatDate(session.createdAt)} · {formatNumber(session.generated)} entries</option>)}</select></label>
      <div className="export-format-options"><button className={`format-choice ${format === "TXT" ? "active" : ""}`} onClick={() => setFormat("TXT")}><div className="file-type-icon txt">TXT</div><div><strong>Plain text</strong><small>One number per line</small></div><span className="radio-dot" /></button><button className={`format-choice ${format === "CSV" ? "active" : ""}`} onClick={() => setFormat("CSV")}><div className="file-type-icon csv">CSV</div><div><strong>Comma-separated</strong><small>Ready for spreadsheets</small></div><span className="radio-dot" /></button></div>
      <div className="export-summary"><div className="summary-icon"><Database size={18} /></div><div><strong>{formatNumber(selected?.generated ?? 0)} entries</strong><span>+{selected?.countryCode} prefix preserved · Stored locally</span></div><span className="summary-format">.{format.toLowerCase()}</span></div>
      {exporting && <div className="export-progress"><div><span>Preparing file…</span><strong>{exportProgress}%</strong></div><ProgressBar value={exportProgress} /></div>}
      <button className="primary-button full-button export-button" disabled={!selected || exporting} onClick={() => selected && onExport(selected, format)}>{exporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />} Download {format} <span>→</span></button>
      <p className="export-footnote"><ShieldCheck size={15} /> Large exports are written in batches; supported browsers stream directly to a file.</p>
    </>}
  </section><aside className="panel export-guide"><div className="guide-badge"><FileText size={20} /></div><p className="eyebrow">FORMATS, SIMPLIFIED</p><h3>Made for wherever your work takes you.</h3><div className="guide-item"><span className="guide-bullet">01</span><div><strong>TXT</strong><p>Simple, lightweight, and easy to share. One phone number on each line.</p></div></div><div className="guide-item"><span className="guide-bullet">02</span><div><strong>CSV</strong><p>Opens cleanly in Excel, Numbers, and Google Sheets with a phone_number column.</p></div></div><div className="privacy-inline"><ShieldCheck size={16} /><span>Exports are created on your device</span></div></aside></div></TranslateTree>;
}

function SettingsPage({ settings, updateSettings, onDeleteAll, totalEntries }: {
  settings: GeneratorSettings;
  updateSettings: (patch: Partial<GeneratorSettings>) => void;
  onDeleteAll: () => void;
  totalEntries: number;
}) {
  return <TranslateTree><div className="settings-layout"><section className="panel settings-panel"><div className="panel-header"><div><p className="eyebrow">PERSONALIZE YOUR WORKSPACE</p><h3>Generation defaults</h3></div><div className="setting-icon"><SettingsIcon size={17} /></div></div>
    <label className="settings-row"><div><strong>Default country code</strong><span>Used as the prefix for every generated number.</span></div><div className="compact-input"><span>+</span><input inputMode="numeric" maxLength={4} value={settings.countryCode} onChange={(event) => updateSettings({ countryCode: event.target.value.replace(/\D/g, "") })} /></div></label>
    <label className="settings-row"><div><strong>Default batch quantity</strong><span>Number of entries created in a generation session.</span></div><input className="small-number" type="number" min={1} max={2_000_000} value={settings.quantity} onChange={(event) => updateSettings({ quantity: Number(event.target.value) })} /></label>
    <label className="settings-row"><div><strong>Default batch size</strong><span>Records processed per worker cycle.</span></div><select className="small-select" value={settings.batchSize} onChange={(event) => updateSettings({ batchSize: Number(event.target.value) })}><option value={100}>{formatNumber(100)}</option><option value={250}>{formatNumber(250)}</option><option value={500}>{formatNumber(500)}</option><option value={1000}>{formatNumber(1000)}</option><option value={2500}>{formatNumber(2500)}</option><option value={5000}>{formatNumber(5000)}</option></select></label>
    <label className="settings-row"><div><strong>Avoid duplicate numbers</strong><span>Check existing stored data before saving.</span></div><input type="checkbox" checked={settings.avoidDuplicates} onChange={(event) => updateSettings({ avoidDuplicates: event.target.checked })} /><span className="toggle-control" /></label>
    <label className="settings-row"><div><strong>Default export format</strong><span>Choose your preferred download format.</span></div><select className="small-select" value={settings.exportFormat} onChange={(event) => updateSettings({ exportFormat: event.target.value as "TXT" | "CSV" })}><option value="TXT">TXT</option><option value="CSV">CSV</option></select></label>
  </section><section className="panel data-panel"><div className="panel-header"><div><p className="eyebrow">DEVICE STORAGE</p><h3>Your data, your choice</h3></div><div className="setting-icon green"><ShieldCheck size={17} /></div></div><div className="data-summary"><Database size={18} /><div><strong>{formatNumber(totalEntries)} entries</strong><span>Saved in this browser's IndexedDB</span></div></div><div className="danger-zone"><div><strong>Delete all generated data</strong><span>Remove every entry and clear your session history.</span></div><button className="danger-button" onClick={onDeleteAll}><Trash2 size={15} /> Delete all</button></div><div className="data-policy"><ShieldCheck size={17} /><p><strong>Local-first by default</strong><br />No analytics, accounts, or network uploads. Your generated data stays on this device.</p></div></section></div></TranslateTree>;
}

function SessionRow({ session }: { session: GenerationSession }) {
  return <TranslateTree><div className="session-row"><div className="session-avatar"><Smartphone size={16} /></div><div className="session-description"><strong>{formatNumber(session.generated)} numbers generated</strong><span>{formatDate(session.createdAt)} · +{session.countryCode}</span></div><span className={`table-status ${session.status}`}><i />{statusLabel[session.status]}</span></div></TranslateTree>;
}

function EmptyState({ icon: Icon, title, detail }: { icon: typeof Home; title: string; detail: string }) {
  return <TranslateTree><div className="empty-state"><div className="empty-icon"><Icon size={21} /></div><strong>{title}</strong><p>{detail}</p></div></TranslateTree>;
}

function ProgressBar({ value }: { value: number }) {
  return <div className="progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${value}%` }} /></div>;
}

export default App;
