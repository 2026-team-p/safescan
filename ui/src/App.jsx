import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, subscribeApp } from './api.js';
import { IssueBoard } from './components/IssueBoard.jsx';
import { IssuePanel } from './components/IssuePanel.jsx';
import { Onboarding } from './components/Onboarding.jsx';
import { RunView } from './components/RunView.jsx';
import { ScanSetup } from './components/ScanSetup.jsx';
import { TopBar } from './components/TopBar.jsx';
import { Toasts } from './components/ui.jsx';
import { telemetryOf, useRun } from './lib/useRun.js';

const MIN_ONBOARDING_MS = 900;
const selectionKey = (root) => `safescan:selection:${root}`;
const JOB_RANK = { queued: 0, working: 1 };
const rankOf = (job) => JOB_RANK[job.status] ?? 2;

function loadSelection(root) {
  try {
    return new Set(JSON.parse(localStorage.getItem(selectionKey(root)) ?? '[]'));
  } catch {
    return new Set();
  }
}

export default function App() {
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('scan');
  const [selected, setSelected] = useState(new Set());
  const [issues, setIssues] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [scanRunId, setScanRunId] = useState(null);
  const [verifyRunId, setVerifyRunId] = useState(null);
  const [lastRun, setLastRun] = useState('scan');
  const [starting, setStarting] = useState(false);
  const [aiSpend, setAiSpend] = useState(0);
  const [assistant, setAssistant] = useState(null);
  const [jobs, setJobs] = useState({});
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(Date.now());
  const toastSeq = useRef(0);
  const countedJobs = useRef(new Set());

  const toast = useCallback((message, kind = 'error') => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  // 작업은 응답과 /api/stream 양쪽으로 올 수 있어, 더 진행된 상태를 남깁니다. API 비용은 작업마다 한 번만 더합니다.
  const mergeJob = useCallback((job) => {
    setJobs((map) => (map[job.id] && rankOf(map[job.id]) > rankOf(job) ? map : { ...map, [job.id]: job }));
    if (rankOf(job) === 2 && job.aiCalls?.length && !countedJobs.current.has(job.id)) {
      countedJobs.current.add(job.id);
      setAiSpend((v) => v + job.aiCalls.reduce((sum, c) => sum + (c.costUsd ?? 0), 0));
    }
  }, []);

  const refreshIssues = useCallback(async () => {
    try {
      setIssues((await api.issues()).issues);
    } catch (err) {
      toast(err.message);
    }
  }, [toast]);

  const load = useCallback(async () => {
    setLoadError(null);
    const started = Date.now();
    try {
      const [s, i] = await Promise.all([api.state(), api.issues()]);
      await new Promise((r) => setTimeout(r, Math.max(0, MIN_ONBOARDING_MS - (Date.now() - started))));
      setState(s);
      setAssistant(s.assistant);
      setIssues(i.issues);
      setSelected(loadSelection(s.projectRoot));
      s.jobs.forEach(mergeJob);
      if (s.activeRun) setScanRunId(s.activeRun);
    } catch (err) {
      setLoadError(err.status === 401
        ? '접속 토큰이 없거나 바뀌었습니다. 터미널에 표시된 주소로 다시 열거나, Claude 에게 "SafeScan 열어 줘" 라고 하세요.'
        : err.message);
    }
  }, [mergeJob]);

  useEffect(() => {
    load();
  }, [load]);

  // 화면 전체 이벤트: 작업 진행 · 이슈 변경 · Claude 연결 상태
  const loaded = Boolean(state);
  useEffect(() => {
    if (!loaded) return undefined;
    return subscribeApp((event) => {
      if (event.type === 'hello') {
        setAssistant(event.assistant);
        event.jobs.forEach(mergeJob);
      } else if (event.type === 'assistant') setAssistant(event.assistant);
      else if (event.type === 'job') mergeJob(event.job);
      else if (event.type === 'issues') refreshIssues();
    });
  }, [loaded, mergeJob, refreshIssues]);

  // 검사 이벤트: AI 비용은 텔레메트리에 더하고, 끝나면 이슈를 다시 읽습니다.
  const onRunEvent = useCallback((event) => {
    if (event.type === 'ai:call') setAiSpend((v) => v + event.costUsd);
    if (event.type === 'run:closed') refreshIssues();
  }, [refreshIssues]);
  const scanRun = useRun(scanRunId, onRunEvent);
  const verifyRun = useRun(verifyRunId, onRunEvent);

  const running = (scanRunId && !scanRun.closed) || (verifyRunId && !verifyRun.closed);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);

  const select = (next) => {
    setSelected(next);
    try {
      localStorage.setItem(selectionKey(state.projectRoot), JSON.stringify([...next]));
    } catch { /* 저장 못 해도 동작에는 문제없음 */ }
  };

  async function startScan() {
    setStarting(true);
    try {
      const ids = [...selected].filter((id) => state.modules.some((m) => m.id === id && m.ready));
      const { runId } = await api.startRun(ids);
      setScanRunId(runId);
      setLastRun('scan');
    } catch (err) {
      toast(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function moveIssue(id, status) {
    const current = issues.find((i) => i.id === id);
    if (!current || current.status === status) return;
    try {
      const { issue } = await api.setStatus(id, status);
      updateIssue(issue);
    } catch (err) {
      toast(err.message);
    }
  }

  const updateIssue = (issue) => setIssues((list) => list.map((i) => (i.id === issue.id ? issue : i)));

  const moduleById = useMemo(() => Object.fromEntries((state?.modules ?? []).map((m) => [m.id, m])), [state]);
  const moduleNames = useMemo(() => Object.fromEntries(Object.values(moduleById).map((m) => [m.id, m.name])), [moduleById]);

  if (!state) return <Onboarding error={loadError} onRetry={load} />;

  const telemetryRun = lastRun === 'verify' && verifyRunId ? verifyRun : scanRun;
  const telemetry = { aiCost: aiSpend, ...telemetryOf(telemetryRun, now), live: Boolean(running) };
  const openIssue = issues.find((i) => i.id === openId);
  const showRun = Boolean(scanRunId) && scanRun.runId === scanRunId;

  return (
    <div className={`app ${openIssue && tab === 'issues' ? 'app-panel-open' : ''}`}>
      <TopBar
        state={state}
        assistant={assistant}
        tab={tab}
        onTab={setTab}
        openIssues={issues.filter((i) => i.status !== 'resolved').length}
        telemetry={telemetry}
      />

      {tab === 'scan' && (showRun ? (
        <RunView
          run={scanRun}
          modules={state.modules}
          onShowIssues={() => setTab('issues')}
          onNewScan={() => setScanRunId(null)}
        />
      ) : (
        <ScanSetup
          state={state}
          assistant={assistant}
          jobs={jobs}
          onJob={mergeJob}
          selected={selected}
          onSelect={select}
          onStart={startScan}
          starting={starting || Boolean(running)}
          onError={toast}
        />
      ))}

      {tab === 'issues' && (
        <IssueBoard
          issues={issues}
          moduleNames={moduleNames}
          openId={openId}
          onOpen={setOpenId}
          onMove={moveIssue}
          onGoScan={() => setTab('scan')}
        />
      )}

      {tab === 'issues' && openIssue && (
        <IssuePanel
          issue={openIssue}
          module={moduleById[openIssue.moduleId]}
          state={state}
          assistant={assistant}
          jobs={jobs}
          verifyRun={verifyRun}
          onClose={() => setOpenId(null)}
          onMove={moveIssue}
          onIssue={updateIssue}
          onJob={mergeJob}
          onVerify={(runId) => {
            setVerifyRunId(runId);
            setLastRun('verify');
          }}
          onError={toast}
        />
      )}

      <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
