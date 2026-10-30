// CLI 를 실제 프로세스로 실행해 명령이 동작하는지 확인합니다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PACKAGE_ROOT } from '../src/core/registry.js';

const BIN = join(PACKAGE_ROOT, 'bin', 'safescan.js');
const PROJECT = fileURLToPath(new URL('./fixtures/project/', import.meta.url));

function cli(args, { untilLine } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: PACKAGE_ROOT, env: { ...process.env, NO_COLOR: '1' } });
    let out = '';
    const onData = (chunk) => {
      out += chunk;
      if (untilLine && untilLine.test(out)) child.kill();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => resolve({ code, out }));
  });
}

test('help · list · check 가 정상 종료한다', async () => {
  const help = await cli(['help']);
  assert.equal(help.code, 0, help.out);
  assert.match(help.out, /safescan run/);
  const list = await cli(['list']);
  assert.equal(list.code, 0, list.out);
  assert.match(list.out, /npm-audit/);
  const check = await cli(['check', 'npm-audit']);
  assert.equal(check.code, 0, check.out);
});

test('알 수 없는 명령은 1 로 끝난다', async () => {
  const { code, out } = await cli(['nope']);
  assert.equal(code, 1);
  assert.match(out, /알 수 없는 명령/);
});

test('run 은 로고와 접속 주소를 보여 주고 서버를 띄운다', async () => {
  const child = spawn(process.execPath, [BIN, 'run', PROJECT, '-p', '0'], { cwd: PACKAGE_ROOT, env: { ...process.env, NO_COLOR: '1' } });
  try {
    let out = '';
    const [, url, token] = await new Promise((resolve, reject) => {
      const onData = (chunk) => {
        out += chunk;
        const m = /(http:\/\/localhost:\d+)\/\?token=([0-9a-f]{32})/.exec(out);
        if (m) resolve(m);
      };
      child.stdout.on('data', onData);
      child.stderr.on('data', onData);
      child.on('close', () => reject(new Error(`run 이 종료되었습니다:\n${out}`)));
    });
    assert.match(out, /╔═╗/);
    assert.equal((await fetch(`${url}/api/state`)).status, 401, '토큰 없이는 API 를 쓸 수 없다');
    const state = await fetch(`${url}/api/state?token=${token}`).then((r) => r.json());
    assert.equal(state.projectRoot.replace(/[\\/]$/, ''), PROJECT.replace(/[\\/]$/, ''));
  } finally {
    child.kill();
  }
});
