// 실행되지 않는 예제입니다. 일부러 취약하게 작성했습니다.
const express = require('express');
const { exec } = require('child_process');
const db = require('./db');
const app = express();

app.get('/user', (req, res) => {
  db.query(`SELECT * FROM users WHERE id = ${req.query.id}`, (err, rows) => res.json(rows));
});

app.get('/ping', (req, res) => {
  exec('ping -c 1 ' + req.query.host, (err, out) => res.send('done'));
});

app.get('/hello', (req, res) => {
  res.send('<h1>Hello ' + req.query.name + '</h1>');
});

app.post('/calc', (req, res) => {
  res.json({ result: eval(req.body.expr) });
});

// ── 안전한 코드 (오탐이 없어야 함) ──
app.get('/safe-user', (req, res) => {
  db.query('SELECT * FROM users WHERE id = ?', [req.query.id], (err, rows) => res.json(rows));
});

app.get('/safe-hello', (req, res) => {
  res.send('<h1>Hello ' + escapeHtml(req.query.name) + '</h1>');
});

app.get('/health', (req, res) => {
  exec('uptime', (err, out) => res.send(out));
});
