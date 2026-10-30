// 실행되지 않는 예제입니다. 일부러 취약하게 작성했습니다.
const fs = require('fs');

function loadConfig(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {}
  return {};
}

function onError(err, req, res) {
  res.status(500).send(err.stack);
}

function verifyToken(token) {
  try {
    return decode(token).valid;
  } catch (e) {
    return true;
  }
}

// ── 안전한 코드 (오탐이 없어야 함) ──
function loadConfigSafe(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (e) {
    console.error('설정 읽기 실패', e.message);
    return {};
  }
}

function onErrorSafe(err, req, res) {
  console.error(err.stack);
  res.status(500).send('서버 오류가 발생했습니다');
}

function verifyTokenSafe(token) {
  try {
    return decode(token).valid;
  } catch (e) {
    return false;
  }
}
