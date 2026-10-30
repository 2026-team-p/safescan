/**
 * SafeScan 모듈 계약 (Module Contract)
 *
 * 모든 검사 모듈은 이 파일에 정의된 형태만 지키면 프레임워크(CLI · 로컬 UI · AI 파이프라인)와
 * 자동으로 연결됩니다. 이 파일이 바뀌면 모든 모듈에 영향이 가므로, 수정은 코어 PR 로만 합니다.
 */

// ───────────────────────────── 공통 열거형 ─────────────────────────────

/** 파이프라인 4단계. 순서대로 실행됩니다. */
export type Stage = 'preprocess' | 'tool' | 'postprocess' | 'verify';

/** UI 배지와 1:1로 대응하는 위험도 4단계 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Category =
  | 'sast'        // 소스 코드 정적 분석
  | 'dast'        // 실행 중인 앱 동적 분석
  | 'dependency'  // 의존성(공급망) 취약점
  | 'secrets'     // 비밀 값 노출
  | 'config'      // 보안 설정 누락
  | 'iac'         // 인프라 코드
  | 'container'   // 컨테이너 이미지
  | 'other';

/** 모듈이 AI 를 쓰는 정도. required 인데 AI 가 설정되지 않았으면 모듈은 건너뜁니다. */
export type AiUsage = 'none' | 'optional' | 'required';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

// ───────────────────────────── 매니페스트 (module.json) ─────────────────────────────

/**
 * modules/<id>/module.json 의 형태.
 * 코드를 실행하지 않고도 UI 목록 · AI 추천 · 적용 여부 판단에 쓰이는 정적 정보입니다.
 */
export interface ModuleManifest {
  /** kebab-case. 폴더 이름과 같아야 합니다. 예: "npm-audit" */
  id: string;
  /** UI 에 보일 이름 */
  name: string;
  /** semver. 검사 결과 · 벤치 기록에 함께 저장되어 버전 간 정확도 비교에 쓰입니다. */
  version: string;
  /** 무엇을 찾는지 한두 문장. AI 자동 추천의 근거로도 쓰입니다. */
  description: string;
  category: Category;
  /** OWASP Top 10:2025 분류. 예: ["A03:2025"] */
  owasp?: string[];
  /** 대표 CWE. 예: ["CWE-1395"] */
  cwe?: string[];
  status?: 'experimental' | 'stable';
  /** 툴 단계의 핵심 도구 — 공개되고 검증된 도구여야 합니다. */
  tool: { name: string; homepage: string; license?: string };
  /** 실행에 필요한 외부 바이너리. 없으면 모듈은 설치 안내와 함께 건너뜁니다. */
  requires?: Requirement[];
  /** 프로젝트에 이 파일들 중 하나라도 있으면 적용 대상. "*.py" 처럼 확장자도 됩니다. 생략하면 항상 적용. */
  appliesWhen?: { files?: string[] };
  ai?: AiUsage;
  /** UI 에서 사용자가 바꿀 수 있는 옵션 */
  options?: Record<string, OptionSpec>;
  /** 모듈 전체 제한 시간(초). 기본 300 */
  timeoutSec?: number;
  /** 이 모듈의 수치 검증 기준. 화면의 모듈 상세에 "기준 대비 실제"로 표시됩니다. */
  criteria?: ModuleCriteria;
  /** 화면 언어별 번역. 없으면 기본(한국어) name · description 을 씁니다. 예: { "en": { "name": "...", "description": "..." } } */
  i18n?: Record<string, { name?: string; description?: string; criteria?: string[] }>;
}

export interface ModuleCriteria {
  /** 신뢰도 구간과 뜻. min 이상이면 그 구간입니다 (높은 순서로 적기). */
  confidence?: { min: number; label: string; description?: string }[];
  /** safescan bench 정확도 목표 (0~1). 최근 벤치 결과와 비교해 화면에 통과 · 미달을 보여 줍니다. */
  accuracy?: { precision?: number; recall?: number };
}

export interface Requirement {
  /** PATH 에서 찾을 실행 파일 이름 */
  bin: string;
  /** 버전 확인 인자. 기본 ["--version"]. 결과는 검증 기록에 남습니다. */
  versionArgs?: string[];
  /** 설치 안내 (사람이 읽는 문장 또는 명령) */
  install: string;
}

export interface OptionSpec {
  type: 'string' | 'number' | 'boolean' | 'enum';
  label: string;
  description?: string;
  default?: string | number | boolean;
  /** type 이 enum 일 때 선택지 */
  choices?: string[];
}

// ───────────────────────────── 결과 형식 (Finding) ─────────────────────────────

/** 후처리 단계가 돌려주는 취약점 1건 */
export interface Finding {
  /** 도구의 규칙 ID. 예: "GHSA-35jh-r3h4-6jhm", "javascript.express.security.xss" */
  ruleId: string;
  title: string;
  severity: Severity;
  /** 0~1. 이 결과가 실제 취약점일 가능성에 대한 모듈의 판단 */
  confidence: number;
  description?: string;
  location?: Location;
  /** 의존성 취약점일 때 */
  dependency?: { name: string; version?: string; fixedIn?: string };
  owasp?: string[];
  cwe?: string[];
  /** 사람이 읽는 조치 방법 */
  remediation?: string;
  references?: string[];
  /**
   * 같은 문제를 재검사 사이에서 같은 것으로 알아보는 키.
   * 생략하면 프레임워크가 moduleId · ruleId · 파일 · (의존성 이름 | 코드 조각 | 줄 번호)로 만듭니다.
   */
  fingerprint?: string;
  /**
   * 같은 조치로 함께 해결되는 결과를 하나의 이슈(스레드)로 묶는 키. 모듈 안에서만 의미가 있습니다.
   * 생략하면 의존성 결과는 "파일 + 패키지 이름"(한 번 올리면 같이 해결), 나머지는 fingerprint 하나당 이슈 하나입니다.
   */
  group?: string;
  /** 도구 원본 레코드 (디버깅용). 너무 크면 잘라서 넣으세요. */
  raw?: unknown;
}

export interface Location {
  /** 프로젝트 루트 기준 상대 경로, 슬래시(/) 구분 */
  file: string;
  startLine?: number;
  endLine?: number;
  snippet?: string;
}

/** 프레임워크가 검사 · 기본값 채우기를 마친 Finding */
export interface NormalizedFinding extends Finding {
  moduleId: string;
  fingerprint: string;
  group: string;
  owasp: string[];
  cwe: string[];
}

// ───────────────────────────── 모듈 정의 (index.js) ─────────────────────────────

/**
 * modules/<id>/index.js 의 default export.
 * `defineModule({...})` 로 감싸면 형태 검사와 에디터 자동완성을 받을 수 있습니다.
 *
 *   preprocess  : 소스에서 도구에 넣을 정보를 모은다         → Input
 *   tool        : 공개 · 검증된 도구를 실행한다              → Raw
 *   postprocess : 도구 결과를 Finding[] 으로 정리한다
 *   verify      : (선택) 결과를 스스로 점검한다. 비용 · 시간 · 토큰 기록은 프레임워크가 자동으로 합니다.
 */
export interface ModuleDefinition<Input = unknown, Raw = unknown> {
  preprocess(ctx: ModuleContext): Promise<Input> | Input;
  tool(ctx: ModuleContext, input: Input): Promise<Raw> | Raw;
  postprocess(ctx: ModuleContext, raw: Raw, input: Input): Promise<Finding[]> | Finding[];
  verify?(ctx: ModuleContext, result: VerifyInput<Input, Raw>): Promise<VerifyReport> | VerifyReport;
}

export interface VerifyInput<Input = unknown, Raw = unknown> {
  input: Input;
  raw: Raw;
  findings: NormalizedFinding[];
}

export interface VerifyReport {
  /** 0~1. 모듈 전체 결과의 신뢰도. 생략하면 Finding confidence 평균을 씁니다. */
  confidence?: number;
  checks?: { name: string; passed: boolean; detail?: string }[];
  notes?: string[];
}

// ───────────────────────────── 실행 컨텍스트 (ctx) ─────────────────────────────

/** 각 단계 함수가 받는 ctx. 모듈은 외부 세계와 오직 ctx 를 통해서만 만납니다. */
export interface ModuleContext {
  readonly runId: string;
  readonly stage: Stage;
  readonly module: { id: string; dir: string; manifest: ModuleManifest };
  readonly project: ProjectApi;
  /** manifest.options 기본값 위에 사용자 값이 덮인 결과 */
  readonly options: Record<string, string | number | boolean>;
  /** 이 모듈 전용 임시 폴더 (실행 후 삭제됨) */
  readonly tmpDir: string;
  /** 제한 시간 초과 · 사용자 취소 시 abort 됩니다. */
  readonly signal: AbortSignal;
  /** 투명성 콘솔로 흘러가는 로그 */
  readonly log: Logger;
  /** 외부 도구 실행. stdout/stderr 가 실시간으로 콘솔에 흐르고 시간이 기록됩니다. */
  exec(cmd: string, args?: string[], opts?: ExecOptions): Promise<ExecResult>;
  /** 계측되는 AI 클라이언트. 토큰 · 비용 · 시간이 자동으로 기록됩니다. */
  readonly ai: AiClient;
  /** 이 모듈을 '건너뜀' 상태로 끝냅니다. 예: 검사할 파일이 없음 */
  skip(reason: string): never;
}

export interface ProjectApi {
  /** 검사 대상 프로젝트의 절대 경로 */
  readonly root: string;
  readonly profile: ProjectProfile;
  /** 상대 경로 → 절대 경로. 프로젝트 밖으로 나가면 에러 */
  resolve(relPath: string): string;
  exists(relPath: string): Promise<boolean>;
  readText(relPath: string): Promise<string>;
  /** node_modules · .git 등과 .safescanignore 에 맞는 경로를 제외하고 파일을 찾습니다. 상대 경로를 돌려줍니다. */
  findFiles(query?: FindFilesQuery): Promise<string[]>;
  /**
   * findFiles 가 빼는 경로인지 알려 줍니다. 도구가 폴더를 스스로 훑는 경우(gitleaks dir 등)
   * 후처리에서 이 함수로 결과를 걸러 사용자 제외 규칙을 지킵니다.
   */
  isIgnored(relPath: string): boolean;
}

export interface FindFilesQuery {
  /** 정확한 파일 이름. 예: ["package-lock.json"] */
  names?: string[];
  /** 확장자. 예: [".js", ".ts"] */
  exts?: string[];
  /** 기본 8 */
  maxDepth?: number;
  /** 기본 5000 */
  limit?: number;
}

export interface ProjectProfile {
  root: string;
  /** 발견된 대표 파일. 예: ["package.json", "package-lock.json"] */
  markers: string[];
  languages: string[];
  frameworks: string[];
  packageManagers: string[];
  /** 프로젝트 루트의 .safescanignore 에 적힌 제외 패턴 */
  ignore: string[];
}

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ExecOptions {
  /** 기본: 프로젝트 루트 */
  cwd?: string;
  env?: Record<string, string>;
  /** 기본: 모듈 남은 시간 */
  timeoutMs?: number;
  /** 정상으로 볼 종료 코드. 기본 [0]. 그 밖이면 에러를 던집니다. */
  okExitCodes?: number[];
  /** stdin 으로 보낼 내용 */
  input?: string;
  /** true 면 stdout 을 콘솔로 흘리지 않습니다 (큰 JSON 출력 등) */
  quiet?: boolean;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface AiClient {
  readonly available: boolean;
  readonly provider: string;
  readonly model: string | null;
  complete(request: AiRequest): Promise<AiResponse>;
}

export interface AiRequest {
  prompt: string;
  system?: string;
  maxTokens?: number;
  effort?: Effort;
  /** true 면 JSON 으로만 답하게 하고 파싱한 값을 response.json 에 담습니다. */
  json?: boolean;
  /** 기록용 짧은 설명. 예: "엔트리포인트 추출" */
  purpose?: string;
}

export interface AiResponse {
  text: string;
  json?: unknown;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  costUsd: number;
  durationMs: number;
}

// ───────────────────────────── 실행 기록 · 이벤트 ─────────────────────────────

export interface AiCallRecord {
  stage: Stage;
  provider: string;
  model: string;
  purpose?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface ExecCallRecord {
  stage: Stage;
  command: string;
  code: number | null;
  durationMs: number;
}

export interface StageRecord {
  stage: Stage;
  status: 'ok' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
}

export type ModuleStatus = 'ok' | 'failed' | 'skipped' | 'timeout';

/** 검증 단계가 남기는 효율 지표. 벤치 기록에서 버전 · 모델 간 비교에 쓰입니다. */
export interface ModuleMetrics {
  durationMs: number;
  aiCalls: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiCostUsd: number;
  findingCount: number;
  bySeverity: Record<Severity, number>;
  /** 모듈 전체 신뢰도 (0~1) */
  confidence: number | null;
}

export interface ModuleRunResult {
  moduleId: string;
  moduleVersion: string;
  status: ModuleStatus;
  reason?: string;
  /** requires 로 확인한 도구 버전. 예: { npm: "11.6.2" } */
  toolVersions: Record<string, string>;
  stages: StageRecord[];
  findings: NormalizedFinding[];
  verify: VerifyReport;
  metrics: ModuleMetrics;
  aiCalls: AiCallRecord[];
  execCalls: ExecCallRecord[];
}

export interface RunResult {
  runId: string;
  projectRoot: string;
  startedAt: string;
  finishedAt: string;
  profile: ProjectProfile;
  modules: ModuleRunResult[];
  /** 결과를 저장한 실행이면 이슈 저장소 반영 결과 */
  issues?: IssueSyncSummary;
}

// ───────────────────────────── 이슈 아이템 ─────────────────────────────

/** 칸반 열: 발견됨 → 해결 중 → 조치 완료 */
export type IssueStatus = 'discovered' | 'in_progress' | 'resolved';

/**
 * 칸반 카드 하나 = 이슈 하나. 같은 group 의 결과를 묶고, 재검사를 거치며 하나의 스레드로 이어집니다.
 * <프로젝트>/.safescan/issues.json 에 저장됩니다.
 */
export interface Issue {
  /** moduleId + group 으로 만든 고정 ID */
  id: string;
  moduleId: string;
  group: string;
  title: string;
  /** 묶인 결과 중 가장 높은 위험도 */
  severity: Severity;
  status: IssueStatus;
  /** 가장 최근 검사에서 이 이슈에 속한 결과 (해결된 이슈는 마지막으로 본 결과) */
  findings: NormalizedFinding[];
  createdAt: string;
  updatedAt: string;
  lastSeenRunId: string;
  /** 시간순 타임라인. 앞으로 AI 수정 제안 · 사용자 옵션 변경도 여기에 쌓입니다. */
  thread: ThreadEntry[];
}

export interface ThreadEntry {
  at: string;
  type:
    | 'detected' | 'changed' | 'resolved' | 'reopened'   // 검사 결과 반영 (safescan)
    | 'status'                                           // 칸반 열 이동
    | 'patch_requested' | 'patch_proposed'               // AI 수정 요청 · 제안
    | 'patch_failed'                                     // AI 가 수정안을 만들지 못함
    | 'patch_accepted' | 'patch_rejected' | 'patch_cancelled'   // 사용자의 수락 · 거절 · 요청 취소
    | 'verify_failed';                                   // 수정 후 재검사에서 여전히 발견
  actor: 'safescan' | 'user' | 'ai';
  runId?: string;
  message: string;
  /** 요청 옵션 · AI 설명 등 기록별 추가 정보 */
  data?: Record<string, unknown>;
}

export interface IssueSyncSummary {
  created: number;
  changed: number;
  reopened: number;
  resolved: number;
  /** 반영 후 열려 있는(조치 완료가 아닌) 이슈 수 */
  open: number;
}

/**
 * 러너가 내보내는 이벤트. CLI 출력 · 로컬 UI(스텝퍼, 투명성 콘솔, 텔레메트리)가 모두 이 이벤트를 구독합니다.
 * 모든 이벤트에는 runId 와 at(ISO 시각)이 붙습니다.
 */
export type RunEvent = { runId: string; at: string } & (
  | { type: 'run:start'; projectRoot: string; modules: string[]; profile: ProjectProfile }
  | { type: 'module:start'; moduleId: string }
  | { type: 'stage:start'; moduleId: string; stage: Stage }
  | { type: 'stage:end'; moduleId: string; stage: Stage; status: StageRecord['status']; durationMs: number; error?: string }
  | { type: 'log'; moduleId: string; stage: Stage | null; level: keyof Logger; message: string }
  | ({ type: 'ai:call'; moduleId: string } & AiCallRecord)
  | { type: 'finding'; moduleId: string; finding: NormalizedFinding }
  | { type: 'module:end'; moduleId: string; status: ModuleStatus; reason?: string; metrics: ModuleMetrics }
  | { type: 'run:end'; result: RunResult }
);
