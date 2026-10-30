// 브라우저 코드 예제 (실행되지 않음)
export function render(name) {
  document.getElementById('greet').innerHTML = `<b>${name}</b>`;
}

export function renderSafe(name) {
  document.getElementById('greet').textContent = name;
}
