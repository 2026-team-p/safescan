import { useMemo } from 'react';
import { collapse, sideBySide } from '../lib/diff.js';

/** 왼쪽 기존 코드 · 오른쪽 AI 제안 코드 */
export function DiffView({ file, before, after }) {
  const rows = useMemo(() => collapse(sideBySide(before, after)), [before, after]);
  const changed = rows.filter((r) => r.type === 'change').length;

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="diff-file">{file}</span>
        <span className="muted">{changed}줄 변경</span>
      </div>
      <div className="diff-cols diff-labels">
        <span>기존 코드</span>
        <span>AI 제안 코드</span>
      </div>
      <div className="diff-body">
        {rows.map((r, i) => (r.type === 'gap' ? (
          <div key={i} className="diff-gap">… 같은 줄 {r.count}개 …</div>
        ) : (
          <div key={i} className="diff-cols">
            <Cell side={r.left} kind={r.type === 'change' ? 'del' : 'same'} />
            <Cell side={r.right} kind={r.type === 'change' ? 'add' : 'same'} />
          </div>
        )))}
      </div>
    </div>
  );
}

function Cell({ side, kind }) {
  if (!side) return <div className="diff-cell diff-empty" />;
  return (
    <div className={`diff-cell diff-${kind}`}>
      <span className="diff-no">{side.no}</span>
      <code>{side.text || ' '}</code>
    </div>
  );
}
