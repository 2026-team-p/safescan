import { useEffect, useState } from 'react';
import { Spinner } from './ui.jsx';

export const CHAT_REQUEST = 'SafeScan 요청 처리해 줘';
const OPEN = new Set(['queued', 'working']);

export const isOpenJob = (job) => Boolean(job) && OPEN.has(job.status);

/** 화면 위쪽에 보여 줄 AI 연결 상태 */
export function assistantLabel(assistant) {
  if (assistant.mode === 'claude') return assistant.autoDelivery ? 'Claude 연결됨 · 자동' : 'Claude 연결됨';
  if (assistant.mode === 'api') return `API · ${assistant.model}`;
  return 'AI 꺼짐';
}

/** AI 작업을 기다리는 동안: 누가 처리하는지 · 걸린 시간 · 채팅 요청 안내 · 취소 */
export function JobWaiting({ job, assistant, onCancel, what }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - Date.parse(job.createdAt)) / 1000));
  const claude = job.via === 'claude';
  const text = !claude ? `AI 가 ${what} 만드는 중…`
    : job.status === 'queued' ? `Claude 에게 보냈습니다 (#${job.id})`
      : `Claude 가 ${what} 만드는 중…`;
  // 채널로 자동 전달된 적이 없으면 금방, 있으면 조금 기다렸다가 채팅 요청 방법을 알려 줍니다.
  const showHint = claude && job.status === 'queued' && seconds >= (assistant.autoDelivery ? 20 : 5);

  return (
    <div className="job" role="status">
      <div className="job-line">
        <Spinner size={14} />
        <span>{text}</span>
        <span className="muted">{seconds}초</span>
        <button type="button" className="btn-link" onClick={onCancel}>취소</button>
      </div>
      {showHint && <ChatHint />}
    </div>
  );
}

function ChatHint() {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(CHAT_REQUEST);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 복사가 막혀 있으면 직접 입력 */ }
  }
  return (
    <div className="chat-hint">
      <p>자동으로 시작되지 않으면 Claude 채팅에 이렇게 입력하세요</p>
      <div className="chat-hint-row">
        <code>{CHAT_REQUEST}</code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{copied ? '복사됨' : '복사'}</button>
      </div>
      <p className="muted">터미널에서 <code>claude --dangerously-load-development-channels server:safescan</code> 로 시작하면 버튼만으로 바로 전달됩니다.</p>
    </div>
  );
}
