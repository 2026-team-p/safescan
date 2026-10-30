import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from './ui.jsx';

const OPEN = new Set(['queued', 'working']);
export const isOpenJob = (job) => Boolean(job) && OPEN.has(job.status);

/** AI 작업을 기다리는 동안: 누가 처리하는지 · 걸린 시간 · 채팅 요청 안내 · 취소 */
export function JobWaiting({ job, assistant, onCancel }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.round((now - Date.parse(job.createdAt)) / 1000));
  const claude = job.via === 'claude';
  const kind = job.kind === 'patch' ? 'Patch' : 'Recommend';
  const text = !claude ? t(`job.ai${kind}`) : job.status === 'queued' ? t('job.sent', { id: job.id }) : t(`job.claude${kind}`);
  // 채널로 자동 전달된 적이 없으면 금방, 있으면 조금 기다렸다가 채팅 요청 방법을 알려 줍니다.
  const showHint = claude && job.status === 'queued' && seconds >= (assistant.autoDelivery ? 20 : 5);

  return (
    <div className="job" role="status">
      <div className="job-line">
        <Spinner size={14} />
        <span>{text}</span>
        <span className="muted">{t('job.seconds', { count: seconds })}</span>
        <button type="button" className="btn-link" onClick={onCancel}>{t('job.cancel')}</button>
      </div>
      {showHint && <ChatHint />}
    </div>
  );
}

function ChatHint() {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const request = t('job.request');
  async function copy() {
    try {
      await navigator.clipboard.writeText(request);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* 복사가 막혀 있으면 직접 입력 */ }
  }
  const cmd = 'claude --dangerously-load-development-channels server:safescan';
  const [before, after] = t('job.hintCli', { cmd: '\u0000' }).split('\u0000');
  return (
    <div className="chat-hint">
      <p>{t('job.hintTitle')}</p>
      <div className="chat-hint-row">
        <code>{request}</code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>{copied ? t('job.copied') : t('job.copy')}</button>
      </div>
      <p className="muted">{before}<code>{cmd}</code>{after}</p>
    </div>
  );
}
