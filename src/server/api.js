// 로컬 UI 가 쓰는 API (/api/*) 와, MCP 도구가 쓰는 bridge.
// AI 일(모듈 추천 · 수정안)은 작업(job)으로 만들고, 연결된 Claude 세션 → API 키 → 규칙 순서로 처리합니다.
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createAiProvider } from '../core/ai.js';
import { CommandNotFoundError, runCommand } from '../core/exec.js';
import { addThreadEntry, findIssue, loadIssues, setIssueStatus, withIssues } from '../core/issues.js';
import { appliesTo, createProjectApi, scanProject } from '../core/project.js';
import { discoverModules } from '../core/registry.js';
import {
  applyEdits, finalizeProposal, optionInstructions, PATCH_OPTIONS, prepareFile, proposePatch, recommendModules,
} from './ai-tasks.js';
import { JobManager } from './jobs.js';
import { HttpError, RunManager } from './runs.js';

/**
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} [opts.modulesDir]
 * @param {import('../core/ai.js').AiProvider} [opts.aiProvider]  모듈 실행 · API 키 방식에 씀
 * @param {{ notify: (job: import('./jobs.js').Job) => void } | null} [opts.claude]  Claude 세션에 연결됐을 때 (safescan mcp)
 */
export function createApi({ projectRoot, modulesDir, aiProvider = createAiProvider(), claude = null }) {
  const storeDir = join(projectRoot, '.safescan');
  const project = createProjectApi(projectRoot, /** @type {any} */ ({}));
  const runs = new RunManager({ projectRoot, aiProvider });
  const jobs = new JobManager();
  const patches = new Map();
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  let toolCache = null;
  let uiUrl = null;

  /** @type {{ mode: 'claude' | 'api' | 'rules', client: { name: string, version: string } | null, autoDelivery: boolean }} */
  const assistant = {
    mode: claude ? 'claude' : aiProvider.available ? 'api' : 'rules',
    client: null,
    autoDelivery: false,
  };
  const assistantInfo = () => ({
    mode: assistant.mode,
    model: assistant.mode === 'api' ? aiProvider.model : null,
    client: assistant.client,
    autoDelivery: assistant.autoDelivery,
    canPatch: assistant.mode !== 'rules',
  });

  const publish = (event) => bus.emit('event', event);
  const issuesChanged = () => publish({ type: 'issues' });
  jobs.on('update', (job) => publish({ type: 'job', job }));

  const entries = () => discoverModules(modulesDir);

  async function entryById(id) {
    const entry = (await entries()).find((e) => e.id === id && !e.errors.length);
    if (!entry) throw new HttpError(404, `모듈을 찾을 수 없습니다: ${id}`);
    return entry;
  }

  /** 모듈마다 필요한 도구가 설치되어 있는지 확인합니다 (서버가 켜져 있는 동안 캐시). */
  async function toolStatus(list, refresh) {
    if (toolCache && !refresh) return toolCache;
    const bins = new Map();
    for (const e of list) for (const r of e.manifest.requires ?? []) bins.set(r.bin, r);
    /** @type {Array<[string, { ok: boolean, version?: string, error?: string }]>} */
    const results = await Promise.all([...bins.values()].map(async (r) => {
      try {
        const out = await runCommand(r.bin, r.versionArgs ?? ['--version'], { timeoutMs: 20_000 });
        return /** @type {[string, { ok: boolean, version: string }]} */ ([r.bin, { ok: true, version: (out.stdout || out.stderr).trim().split('\n')[0].slice(0, 60) }]);
      } catch (err) {
        return /** @type {[string, { ok: boolean, error: string }]} */ ([r.bin, { ok: false, error: err instanceof CommandNotFoundError ? '설치되어 있지 않음' : err.message }]);
      }
    }));
    toolCache = new Map(results);
    return toolCache;
  }

  /** 프로젝트 분석 + 모듈별 준비 상태 */
  async function buildState(refresh) {
    const [{ profile, index }, list] = await Promise.all([scanProject(projectRoot), entries()]);
    const tools = await toolStatus(list, refresh);
    const modules = list.map((e) => {
      const m = e.manifest;
      const missing = (m.requires ?? []).filter((r) => !tools.get(r.bin)?.ok).map((r) => ({ bin: r.bin, install: r.install }));
      const aiBlocked = m.ai === 'required' && !aiProvider.available;
      return {
        id: e.id,
        name: m.name ?? e.id,
        description: m.description ?? '',
        category: m.category,
        owasp: m.owasp ?? [],
        tool: m.tool,
        ai: m.ai ?? 'none',
        status: m.status ?? 'experimental',
        options: m.options ?? {},
        errors: e.errors,
        applies: e.errors.length ? { applies: false, matched: [] } : appliesTo(m, index),
        toolVersions: Object.fromEntries((m.requires ?? []).filter((r) => tools.get(r.bin)?.ok).map((r) => [r.bin, tools.get(r.bin).version])),
        missing,
        ready: !e.errors.length && !missing.length && !aiBlocked,
        blockedReason: e.errors.length ? 'module.json 오류' : missing.length ? `${missing[0].bin} 미설치` : aiBlocked ? 'AI 설정 필요' : null,
      };
    });
    return { profile, modules };
  }

  async function issueOr404(store, id) {
    const issue = findIssue(store, id);
    if (!issue) throw new HttpError(404, `이슈를 찾을 수 없습니다: ${id}`);
    return issue;
  }

  function startScan(modules, options) {
    return runs.start({ modules, options, afterRun: async () => issuesChanged() });
  }

  // ───────── 작업: 모듈 추천 ─────────

  async function createRecommendJob() {
    if (assistant.mode === 'claude') {
      const job = jobs.create({ kind: 'recommend', via: 'claude' });
      claude.notify(job);
      return job;
    }
    const job = jobs.create({ kind: 'recommend', via: assistant.mode === 'api' ? 'api' : 'rules' });
    (async () => {
      jobs.start(job.id);
      const { profile, modules } = await buildState(false);
      const aiCalls = [];
      const result = await recommendModules({ profile, modules, aiProvider, onAiCall: (r) => aiCalls.push(r) });
      jobs.finish(job.id, result, { aiCalls });
    })().catch((err) => jobs.fail(job.id, err.message));
    return job;
  }

  // ───────── 작업: 수정안 ─────────

  async function createPatchJob(issueId, optionKeys) {
    if (assistant.mode === 'rules') {
      throw new HttpError(400, 'AI 가 연결되어 있지 않습니다. Claude Code 에 SafeScan 을 연결하거나 ANTHROPIC_API_KEY 를 설정하세요');
    }
    const store = await loadIssues(storeDir);
    const issue = await issueOr404(store, issueId);
    const finding = issue.findings[0];
    if (finding.dependency) throw new HttpError(400, '의존성 이슈는 패키지 매니저로 해결하세요 (예: npm audit fix)');
    if (!finding.location?.file) throw new HttpError(400, '파일 위치가 없는 이슈는 AI 수정을 요청할 수 없습니다');
    const options = (Array.isArray(optionKeys) ? optionKeys : []).filter((k) => k in PATCH_OPTIONS);
    const labels = options.map((k) => PATCH_OPTIONS[k].label);

    const original = await readFile(project.resolve(finding.location.file), 'utf8');
    const entry = await entryById(issue.moduleId);
    // 비밀 값 모듈이면 같은 파일에서 발견된 모든 줄을 가립니다 (다른 이슈의 비밀 값도 AI 에게 보이지 않음)
    const secretLines = entry.manifest.category === 'secrets'
      ? store.issues.filter((i) => i.moduleId === issue.moduleId).flatMap((i) => i.findings)
        .filter((f) => f.location?.file === finding.location.file && f.location.startLine)
        .flatMap((f) => range(f.location.startLine, f.location.endLine ?? f.location.startLine))
      : [];
    let prepared;
    try {
      prepared = prepareFile(finding.location.file, original, secretLines);
    } catch (err) {
      throw new HttpError(400, err.message);
    }

    const via = assistant.mode;
    const job = jobs.create({ kind: 'patch', via, issueId: issue.id, options: labels, internal: { prepared, options, issueId: issue.id } });
    await withIssues(storeDir, async (s) => {
      addThreadEntry(await issueOr404(s, issue.id), {
        type: 'patch_requested', actor: 'user',
        message: `${via === 'claude' ? 'Claude' : 'AI'} 에게 수정안을 요청했습니다${labels.length ? ` (${labels.join(', ')})` : ''}`,
        data: { options: labels, jobId: job.id },
      });
    });
    issuesChanged();

    if (via === 'claude') {
      claude.notify(job);
    } else {
      (async () => {
        jobs.start(job.id);
        const aiCalls = [];
        try {
          const r = await proposePatch({ issue, prepared, options, aiProvider, onAiCall: (c) => aiCalls.push(c) });
          await recordProposal(job, r.proposed, r.explanation, { model: r.model, costUsd: r.costUsd }, aiCalls);
        } catch (err) {
          await recordFailure(job, err.message, 'safescan', aiCalls);
        }
      })();
    }
    return job;
  }

  async function recordProposal(job, proposed, explanation, data = {}, aiCalls) {
    const { prepared } = jobs.internal(job.id);
    const patchId = randomBytes(6).toString('hex');
    patches.set(patchId, { issueId: job.issueId, file: prepared.file, original: prepared.original, proposed, explanation });
    await withIssues(storeDir, async (s) => {
      addThreadEntry(await issueOr404(s, job.issueId), {
        type: 'patch_proposed', actor: 'ai', message: explanation,
        data: { patchId, file: prepared.file, via: job.via, durationMs: Date.now() - Date.parse(job.createdAt), maskedSecrets: prepared.masks.size, ...data },
      });
    });
    jobs.finish(job.id, {
      patch: { id: patchId, file: prepared.file, original: prepared.original, proposed, explanation, maskedSecrets: prepared.masks.size },
    }, aiCalls ? { aiCalls } : {});
    issuesChanged();
  }

  async function recordFailure(job, reason, actor, aiCalls) {
    jobs.fail(job.id, reason, aiCalls ? { aiCalls } : {});
    if (job.kind !== 'patch') return;
    await withIssues(storeDir, async (s) => {
      const target = findIssue(s, job.issueId);
      if (target) addThreadEntry(target, { type: 'patch_failed', actor, message: `수정안을 만들지 못했습니다: ${reason}`, data: { jobId: job.id } });
    });
    issuesChanged();
  }

  // ───────── MCP 도구가 쓰는 기능 ─────────

  function claudeJob(id) {
    const job = jobs.get(id);
    if (job.via !== 'claude') throw new HttpError(400, `작업 #${id} 은 Claude 가 처리하는 작업이 아닙니다`);
    return job;
  }

  /** Claude 에게 줄 작업 내용. 이슈 · 파일 내용은 MCP 쪽에서 '데이터' 로 감싸 전달합니다. */
  async function jobDetail(job) {
    if (job.kind === 'recommend') {
      const { profile, modules } = await buildState(false);
      return {
        job,
        context: {
          project: { languages: profile.languages, frameworks: profile.frameworks, packageManagers: profile.packageManagers, markers: profile.markers },
          modules: modules.map((m) => ({
            id: m.id, name: m.name, description: m.description, category: m.category, owasp: m.owasp,
            ready: m.ready, blockedReason: m.blockedReason, appliesToProject: m.applies.applies,
          })),
        },
      };
    }
    const { prepared, options, issueId } = jobs.internal(job.id);
    const issue = await issueOr404(await loadIssues(storeDir), issueId);
    return {
      job,
      prepared,
      instructions: optionInstructions(options),
      issue: {
        id: issue.id, title: issue.title, severity: issue.severity, module: issue.moduleId,
        findings: issue.findings.map((f) => ({
          ruleId: f.ruleId, title: f.title, location: f.location, description: f.description, remediation: f.remediation,
        })),
      },
    };
  }

  const bridge = {
    get projectRoot() {
      return projectRoot;
    },
    get uiUrl() {
      return uiUrl;
    },
    setClient(info) {
      assistant.client = info ? { name: info.name, version: info.version } : null;
      publish({ type: 'assistant', assistant: assistantInfo() });
    },
    buildState: () => buildState(false),
    openJobs: () => jobs.queued(),

    /** 채팅에서 "SafeScan 요청 처리해 줘" → 가장 오래 기다린 작업 */
    async nextJob() {
      const job = jobs.next();
      if (!job) return null;
      jobs.start(job.id, 'chat');
      return jobDetail(job);
    },

    /** 채널 알림에 들어 있는 job_id 로 작업을 가져갑니다 */
    async getJob(id) {
      const job = claudeJob(id);
      jobs.assertOpen(job);
      if (job.status === 'queued') {
        jobs.start(id, 'channel');
        if (!assistant.autoDelivery) {
          assistant.autoDelivery = true;
          publish({ type: 'assistant', assistant: assistantInfo() });
        }
      }
      return jobDetail(job);
    },

    async submitRecommendation(id, selected, reasoning) {
      const job = claudeJob(id);
      if (job.kind !== 'recommend') throw new HttpError(400, `작업 #${id} 은 모듈 추천이 아닙니다`);
      jobs.assertOpen(job);
      const { modules } = await buildState(false);
      const ready = new Set(modules.filter((m) => m.ready).map((m) => m.id));
      const unknown = (selected ?? []).filter((m) => !ready.has(m));
      if (!Array.isArray(selected) || !selected.length) throw new HttpError(400, 'selected 에 모듈 id 를 하나 이상 넣으세요');
      if (unknown.length) throw new HttpError(400, `실행할 수 없는 모듈입니다: ${unknown.join(', ')} (실행 가능: ${[...ready].join(', ')})`);
      if (typeof reasoning !== 'string' || !reasoning.trim()) throw new HttpError(400, 'reasoning 이 필요합니다');
      jobs.finish(id, { source: 'claude', selected, reasoning: reasoning.trim() });
      return jobs.get(id);
    },

    async submitPatch(id, edits, explanation) {
      const job = claudeJob(id);
      if (job.kind !== 'patch') throw new HttpError(400, `작업 #${id} 은 수정안 작업이 아닙니다`);
      jobs.assertOpen(job);
      if (typeof explanation !== 'string' || !explanation.trim()) throw new HttpError(400, 'explanation 이 필요합니다');
      if (job.status === 'queued') jobs.start(id, 'chat');
      const { prepared } = jobs.internal(id);
      let proposed;
      try {
        proposed = finalizeProposal(prepared, applyEdits(prepared.text, edits));
      } catch (err) {
        throw new HttpError(400, err.message); // 작업은 열어 둔 채로 다시 제출하게 합니다
      }
      await recordProposal(job, proposed, explanation.trim(), { model: assistant.client?.name ?? 'claude' });
      return jobs.get(id);
    },

    async failJob(id, reason) {
      const job = claudeJob(id);
      jobs.assertOpen(job);
      await recordFailure(job, reason || '이유 없음', 'ai');
      return jobs.get(id);
    },

    async listIssues(status) {
      const { issues } = await loadIssues(storeDir);
      return status ? issues.filter((i) => i.status === status) : issues.filter((i) => i.status !== 'resolved');
    },

    async getIssue(id) {
      return issueOr404(await loadIssues(storeDir), id);
    },

    /** 검사를 돌리고 끝날 때까지 기다립니다. 모듈을 안 주면 프로젝트에 맞는 모듈을 고릅니다. */
    async runScanAndWait(moduleIds) {
      let list;
      if (moduleIds?.length) list = await Promise.all(moduleIds.map(entryById));
      else {
        const { modules } = await buildState(false);
        const ids = modules.filter((m) => m.ready && m.applies.applies).map((m) => m.id);
        list = await Promise.all(ids.map(entryById));
      }
      const runId = startScan(list, {});
      return new Promise((resolve, reject) => {
        let result = null;
        runs.subscribe(runId, 0, (event) => {
          if (!event) return result ? resolve(result) : reject(new Error('검사가 끝나지 않았습니다'));
          if (event.type === 'run:end') result = event.result;
          if (event.type === 'run:error') reject(new Error(event.message));
        });
      });
    },
  };

  // ───────── HTTP 핸들러 ─────────

  const api = {
    async state(_req, url) {
      const { profile, modules } = await buildState(url.searchParams.has('refresh'));
      return {
        projectRoot,
        profile,
        modules,
        assistant: assistantInfo(),
        patchOptions: Object.fromEntries(Object.entries(PATCH_OPTIONS).map(([k, v]) => [k, v.label])),
        activeRun: runs.active,
        jobs: jobs.queued(),
      };
    },

    /** 화면 전체가 듣는 이벤트: 작업 진행 · 이슈 변경 · Claude 연결 상태 */
    stream(req, _url, _body, _params, res) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      const send = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      send({ type: 'hello', assistant: assistantInfo(), jobs: jobs.queued() });
      bus.on('event', send);
      const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        bus.off('event', send);
        clearInterval(keepAlive);
      });
      return undefined;
    },

    async recommend() {
      return { job: await createRecommendJob() };
    },

    async job(_req, _url, _body, params) {
      return { job: jobs.get(params.id) };
    },

    async cancelJob(_req, _url, _body, params) {
      const job = jobs.get(params.id);
      const open = job.status === 'queued' || job.status === 'working';
      jobs.cancel(params.id);
      if (open && job.kind === 'patch') {
        await withIssues(storeDir, async (s) => {
          const target = findIssue(s, job.issueId);
          if (target) addThreadEntry(target, { type: 'patch_rejected', actor: 'user', message: '수정안 요청을 취소했습니다', data: { jobId: job.id } });
        });
        issuesChanged();
      }
      return { job };
    },

    async startRun(_req, _url, body) {
      const ids = Array.isArray(body?.modules) ? body.modules : [];
      const list = await Promise.all(ids.map(entryById));
      return { runId: startScan(list, body?.options ?? {}) };
    },

    /** Server-Sent Events. 이벤트마다 id 를 붙여 재접속 시 이어서 받습니다. */
    events(req, _url, _body, params, res) {
      const from = Number(req.headers['last-event-id'] ?? -1) + 1;
      let unsubscribe = () => {};
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      unsubscribe = runs.subscribe(params.id, from, (event, id) => {
        if (event) res.write(`id: ${id}\ndata: ${JSON.stringify(event)}\n\n`);
        else res.end();
      });
      req.on('close', () => unsubscribe());
      return undefined;
    },

    async issues() {
      return loadIssues(storeDir);
    },

    async setStatus(_req, _url, body, params) {
      const out = await withIssues(storeDir, async (store) => {
        const issue = await issueOr404(store, params.id);
        setIssueStatus(issue, body?.status, 'user');
        return { issue };
      });
      issuesChanged();
      return out;
    },

    /** 수정안 요청 → 작업. 결과는 /api/stream 의 job 이벤트로 옵니다. */
    async requestPatch(_req, _url, body, params) {
      return { job: await createPatchJob(params.id, body?.options) };
    },

    /** 수정안 적용 → 해결 중으로 이동 → 해당 모듈만 다시 검사해 해결됐는지 확인 */
    async acceptPatch(_req, _url, _body, params) {
      const patch = patches.get(params.patchId);
      if (!patch || !params.id || !patch.issueId.startsWith(params.id)) throw new HttpError(404, '수정안을 찾을 수 없습니다. 다시 요청하세요');
      if (runs.active) throw new HttpError(409, '검사가 끝난 뒤에 적용할 수 있습니다');

      const path = project.resolve(patch.file);
      if ((await readFile(path, 'utf8')) !== patch.original) {
        patches.delete(params.patchId);
        throw new HttpError(409, '그 사이 파일이 바뀌었습니다. 수정안을 다시 요청하세요');
      }
      await writeFile(path, patch.proposed);
      patches.delete(params.patchId);

      const issue = await withIssues(storeDir, async (store) => {
        const target = await issueOr404(store, patch.issueId);
        addThreadEntry(target, { type: 'patch_accepted', actor: 'user', message: `수정안을 ${patch.file} 에 적용했습니다. 다시 검사합니다` });
        setIssueStatus(target, 'in_progress', 'user');
        return target;
      });
      issuesChanged();

      const runId = runs.start({
        modules: [await entryById(issue.moduleId)],
        afterRun: async (result) => {
          const mod = result.modules[0];
          await withIssues(storeDir, async (store) => {
            const target = findIssue(store, patch.issueId);
            if (!target || target.status === 'resolved') return;
            const reason = mod.status === 'ok' ? '수정 후 재검사에서도 여전히 발견됩니다' : `재검사를 마치지 못했습니다 (${mod.reason ?? mod.status})`;
            addThreadEntry(target, { type: 'verify_failed', actor: 'safescan', runId: result.runId, message: reason });
          });
          issuesChanged();
        },
      });
      return { runId, issue };
    },

    async rejectPatch(_req, _url, _body, params) {
      const patch = patches.get(params.patchId);
      patches.delete(params.patchId);
      if (!patch) return { ok: true };
      const issue = await withIssues(storeDir, async (store) => {
        const target = await issueOr404(store, patch.issueId);
        addThreadEntry(target, { type: 'patch_rejected', actor: 'user', message: '수정안을 적용하지 않았습니다' });
        return target;
      });
      issuesChanged();
      return { issue };
    },
  };

  return {
    runs,
    jobs,
    bridge,
    setUiUrl: (url) => {
      uiUrl = url;
    },
    /** @type {Array<[string, RegExp, (req: any, url: URL, body: any, params: Record<string, string>, res: any) => any]>} */
    routes: [
      ['GET', /^\/api\/state$/, api.state],
      ['GET', /^\/api\/stream$/, api.stream],
      ['POST', /^\/api\/recommend$/, api.recommend],
      ['GET', /^\/api\/jobs\/(?<id>[0-9a-f]+)$/, api.job],
      ['POST', /^\/api\/jobs\/(?<id>[0-9a-f]+)\/cancel$/, api.cancelJob],
      ['POST', /^\/api\/runs$/, api.startRun],
      ['GET', /^\/api\/runs\/(?<id>[\w-]+)\/events$/, api.events],
      ['GET', /^\/api\/issues$/, api.issues],
      ['POST', /^\/api\/issues\/(?<id>[0-9a-f]+)\/status$/, api.setStatus],
      ['POST', /^\/api\/issues\/(?<id>[0-9a-f]+)\/patch$/, api.requestPatch],
      ['POST', /^\/api\/issues\/(?<id>[0-9a-f]+)\/patch\/(?<patchId>[0-9a-f]+)\/accept$/, api.acceptPatch],
      ['POST', /^\/api\/issues\/(?<id>[0-9a-f]+)\/patch\/(?<patchId>[0-9a-f]+)\/reject$/, api.rejectPatch],
    ],
  };
}

function range(from, to) {
  return Array.from({ length: Math.max(1, to - from + 1) }, (_, i) => from + i);
}
