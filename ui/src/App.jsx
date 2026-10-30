import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api, subscribeApp } from './api.js';
import { HistoryView } from './components/HistoryView.jsx';
import { IssueBoard } from './components/IssueBoard.jsx';
import { IssuePanel } from './components/IssuePanel.jsx';
import { Onboarding } from './components/Onboarding.jsx';
import { RunView } from './components/RunView.jsx';
import { ScanSetup } from './components/ScanSetup.jsx';
import { TopBar } from './components/TopBar.jsx';
import { Toasts } from './components/ui.jsx';
import { localizeModule } from './i18n.js';
import { compact, effectiveOptions } from './lib/options.js';
import { telemetryOf, useRun } from './lib/useRun.js';

const MIN_ONBOARDING_MS = 900;
const SAVE_DELAY_MS = 500;
const selectionKey = (root) => `safescan:selection:${root}`;
const JOB_RANK = { queued: 0, working: 1 };
const rankOf = (job) => JOB_RANK[job.status] ?? 2;
// 같은 단계의 작업 갱신(예: 수정안 적용 표시)은 새 것을 받도록 나중 이벤트를 우선합니다.
const newer = (a, b) => rankOf(b) > rankOf(a) || (rankOf(b) === rankOf(a) && (b.result?.patch?.consumed || !a.result?.patch?.consumed));

function loadSelection(root) {
  try {
    return new Set(JSON.parse(localStorage.getItem(selectionKey(root)) ?? '[]'));
  } catch {
    return new Set();
  }
}

export default function App() {
  const { i18n } = useTranslation();
  const [state, setState] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState('scan');
  const [selected, setSelected] = useState(new Set());
  const [issues, setIssues] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [scanRunId, setScanRunId] = useState(null);
  const [verifyRunId, setVerifyRunId] = useState(null);
  const [telemetryRunId, setTelemetryRunId] = useState(null);
  const [starting, setStarting] = useState(false);
  const [aiSpend, setAiSpend] = useState(0);
  const [assistant, setAssistant] = useState(null);
  const [jobs, setJobs] = useState({});
  const [toasts, setToasts] = useState([]);
  const [now, setNow] = useState(Date.now());
  // 모듈 옵션: 기본값과 다른 값만 { 모듈 id: { 옵션: 값 } }. 바꾸면 잠시 뒤 프로젝트 설정에 저장합니다.
  const [moduleOptions, setModuleOptions] = useState({});
  const [scanBench, setScanBench] = useState(null);
  const toastSeq = useRef(0);
  const countedJobs = useRef(new Set());
  const saveTimers = useRef({});

  const toast = useCallback((message, kind = 'error') => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  // 작업은 응답과 /api/stream 양쪽으로 올 수 있어, 더 진행된 상태를 남깁니다. API 비용은 작업마다 한 번만 더합니다.
  const mergeJob = useCallback((job) => {
    setJobs((map) => (map[job.id] && !newer(map[job.id], job) ? map : { ...map, [job.id]: job }));
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
      setModuleOptions(s.settings?.options ?? {});
      s.jobs.forEach(mergeJob);
      if (s.activeRun) {
        setScanRunId(s.activeRun);
        setTelemetryRunId(s.activeRun);
      }
    } catch (err) {
      setLoadError(err.status === 401 ? 'token' : err.message);
    }
  }, [mergeJob]);

  useEffect(() => {
    load();
  }, [load]);

  // 화면 전체 이벤트: 작업 진행 · 이슈 변경 · Claude 연결 상태 · (어디서 시작했든) 검사 시작
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
      else if (event.type === 'run') setTelemetryRunId(event.runId);
    });
  }, [loaded, mergeJob, refreshIssues]);

  // 텔레메트리는 가장 최근 검사 하나를 따라가고, AI 비용도 여기서만 셉니다 (중복 없이).
  const onTelemetryEvent = useCallback((event) => {
    if (event.type === 'ai:call') setAiSpend((v) => v + event.costUsd);
  }, []);
  const telemetryRun = useRun(telemetryRunId, onTelemetryEvent);
  const scanRun = useRun(scanRunId);
  const verifyRun = useRun(verifyRunId);

  const running = Boolean(telemetryRunId) && !telemetryRun.closed;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [running]);

  const select = useCallback((next) => {
    setSelected(next);
    try {
      localStorage.setItem(selectionKey(state.projectRoot), JSON.stringify([...next]));
    } catch { /* 저장 못 해도 동작에는 문제없음 */ }
  }, [state]);

  const saveOptions = useCallback((module, values) => {
    clearTimeout(saveTimers.current[module.id]);
    saveTimers.current[module.id] = setTimeout(() => {
      api.saveOptions(module.id, compact(module, values)).catch((err) => toast(err.message));
    }, SAVE_DELAY_MS);
  }, [toast]);

  const setOption = useCallback((module, key, value) => {
    setModuleOptions((all) => {
      const mine = { ...(all[module.id] ?? {}) };
      if (value === undefined) delete mine[key];
      else mine[key] = value;
      saveOptions(module, effectiveOptions(module, mine));
      return { ...all, [module.id]: mine };
    });
  }, [saveOptions]);

  const resetOptions = useCallback((module) => {
    setModuleOptions((all) => ({ ...all, [module.id]: {} }));
    saveOptions(module, {});
  }, [saveOptions]);

  async function startScan(ids) {
    setStarting(true);
    try {
      // 저장이 아직 안 끝났어도 지금 화면의 옵션으로 검사합니다.
      const options = Object.fromEntries(ids.map((id) => [id, compact(moduleById[id], effectiveOptions(moduleById[id], moduleOptions[id]))]));
      const { runId } = await api.startRun(ids, options);
      setScanBench(null);
      setScanRunId(runId);
      setTelemetryRunId(runId);
      return runId;
    } catch (err) {
      toast(err.message);
      return null;
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
  const moduleNames = useMemo(
    () => Object.fromEntries(Object.values(moduleById).map((m) => [m.id, localizeModule(m, i18n.language).name])),
    [moduleById, i18n.language],
  );

  if (!state || !assistant) return <Onboarding error={loadError} onRetry={load} />;

  const telemetry = { aiCost: aiSpend, ...telemetryOf(telemetryRun, now), live: running };
  const openIssue = issues.find((i) => i.id === openId);
  const showRun = Boolean(scanRunId) && scanRun.runId === scanRunId;
  const waitingJobs = Object.values(jobs).filter((j) => j.via === 'claude' && j.status === 'queued').length;
  // 기록 화면은 검사가 끝나거나 AI 작업이 끝날 때 다시 읽습니다.
  const historyKey = `${telemetryRunId ?? ''}:${telemetryRun.closed}:${Object.values(jobs).filter((j) => rankOf(j) === 2).length}:${issues.length}`;
  // 이슈 화면의 "다시 검사": 열린 이슈를 낸 모듈 중 지금 실행할 수 있는 것
  const rescanIds = [...new Set(issues.filter((i) => i.status !== 'resolved').map((i) => i.moduleId))].filter((id) => moduleById[id]?.ready);

  return (
    <div className={`app ${openIssue && tab === 'issues' ? 'app-panel-open' : ''}`}>
      <TopBar
        state={state}
        assistant={assistant}
        waitingJobs={waitingJobs}
        tab={tab}
        onTab={setTab}
        openIssues={issues.filter((i) => i.status !== 'resolved').length}
        telemetry={telemetry}
      />

      {tab === 'scan' && (showRun ? (
        <RunView
          run={scanRun}
          modules={state.modules}
          bench={scanBench}
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
          onStart={() => startScan([...selected].filter((id) => moduleById[id]?.ready))}
          starting={starting || running}
          onError={toast}
          moduleOptions={moduleOptions}
          onOption={setOption}
          onResetOptions={resetOptions}
        />
      ))}

      {tab === 'history' && (
        <HistoryView
          modules={state.modules}
          refreshKey={historyKey}
          onError={toast}
          onOpenRun={(runId, bench) => {
            setScanBench(bench ?? null);
            setScanRunId(runId);
            setTab('scan');
          }}
        />
      )}

      {tab === 'issues' && (
        <IssueBoard
          issues={issues}
          moduleNames={moduleNames}
          openId={openId}
          onOpen={setOpenId}
          onMove={moveIssue}
          onGoScan={() => setTab('scan')}
          rescanModules={rescanIds.map((id) => moduleNames[id] ?? id)}
          busy={starting || running}
          onRescan={async () => {
            if (await startScan(rescanIds)) setTab('scan');
          }}
        />
      )}

      {tab === 'issues' && openIssue && (
        <IssuePanel
          issue={openIssue}
          module={moduleById[openIssue.moduleId]}
          moduleNames={moduleNames}
          assistant={assistant}
          jobs={jobs}
          verifyRun={verifyRun}
          onClose={() => setOpenId(null)}
          onMove={moveIssue}
          onIssue={updateIssue}
          onJob={mergeJob}
          onVerify={(runId) => {
            setVerifyRunId(runId);
            setTelemetryRunId(runId);
          }}
          onError={toast}
        />
      )}

      <Toasts items={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  );
}
