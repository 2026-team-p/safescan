// 줄 단위 비교 (LCS). 좌우 나란히 보기용 행 목록을 만듭니다.
const MAX_CELLS = 4_000_000;

/**
 * @returns {Array<{ type: 'same' | 'change', left: { no: number, text: string } | null, right: { no: number, text: string } | null }>}
 */
export function sideBySide(before, after) {
  const a = before.replaceAll('\r\n', '\n').split('\n');
  const b = after.replaceAll('\r\n', '\n').split('\n');

  // 앞뒤의 같은 부분은 미리 떼어 내 계산량을 줄입니다.
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tailA = a.length;
  let tailB = b.length;
  while (tailA > head && tailB > head && a[tailA - 1] === b[tailB - 1]) {
    tailA -= 1;
    tailB -= 1;
  }

  const ops = [];
  for (let i = 0; i < head; i += 1) ops.push({ op: 'same', i, j: i });
  ops.push(...middleOps(a, b, head, tailA, tailB));
  for (let k = 0; k < a.length - tailA; k += 1) ops.push({ op: 'same', i: tailA + k, j: tailB + k });

  // 연속된 삭제 · 추가 묶음을 좌우로 짝짓습니다.
  const rows = [];
  let dels = [];
  let adds = [];
  const flush = () => {
    for (let k = 0; k < Math.max(dels.length, adds.length); k += 1) {
      rows.push({
        type: 'change',
        left: dels[k] === undefined ? null : { no: dels[k] + 1, text: a[dels[k]] },
        right: adds[k] === undefined ? null : { no: adds[k] + 1, text: b[adds[k]] },
      });
    }
    dels = [];
    adds = [];
  };
  for (const o of ops) {
    if (o.op === 'del') dels.push(o.i);
    else if (o.op === 'add') adds.push(o.j);
    else {
      flush();
      rows.push({ type: 'same', left: { no: o.i + 1, text: a[o.i] }, right: { no: o.j + 1, text: b[o.j] } });
    }
  }
  flush();
  return rows;
}

function middleOps(a, b, head, tailA, tailB) {
  const n = tailA - head;
  const m = tailB - head;
  const ops = [];
  if (n * m > MAX_CELLS) {
    for (let i = head; i < tailA; i += 1) ops.push({ op: 'del', i });
    for (let j = head; j < tailB; j += 1) ops.push({ op: 'add', j });
    return ops;
  }
  const w = m + 1;
  const dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * w + j] = a[head + i] === b[head + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[head + i] === b[head + j]) {
      ops.push({ op: 'same', i: head + i, j: head + j });
      i += 1;
      j += 1;
    } else if (j < m && (i === n || dp[i * w + j + 1] >= dp[(i + 1) * w + j])) {
      ops.push({ op: 'add', j: head + j });
      j += 1;
    } else {
      ops.push({ op: 'del', i: head + i });
      i += 1;
    }
  }
  return ops;
}

/** 바뀐 곳 주변만 남기고 긴 같은 구간은 접습니다. */
export function collapse(rows, context = 3) {
  const keep = rows.map((r) => r.type === 'change');
  rows.forEach((r, idx) => {
    if (r.type !== 'change') return;
    for (let k = Math.max(0, idx - context); k <= Math.min(rows.length - 1, idx + context); k += 1) keep[k] = true;
  });
  const out = [];
  let hidden = 0;
  rows.forEach((r, idx) => {
    if (keep[idx]) {
      if (hidden) out.push({ type: 'gap', count: hidden });
      hidden = 0;
      out.push(r);
    } else hidden += 1;
  });
  if (hidden) out.push({ type: 'gap', count: hidden });
  return out;
}
