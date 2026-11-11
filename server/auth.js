const crypto = require('crypto');
const { db } = require('./db');

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const h = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(h, Buffer.from(hash, 'hex'));
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const exp = new Date(Date.now() + 30 * 86400000).toISOString();
  db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').run(token, userId, exp);
  return token;
}
function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('='); if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function userFromReq(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s || s.expires_at < new Date().toISOString()) return null;
  const u = db.prepare('SELECT id,username,name,role,active FROM users WHERE id=?').get(s.user_id);
  if (!u || !u.active) return null;
  u.token = token;
  u.pageIds = u.role === 'admin'
    ? db.prepare('SELECT id FROM pages').all().map(r => r.id)
    : db.prepare('SELECT page_id FROM user_pages WHERE user_id=?').all(u.id).map(r => r.page_id);
  return u;
}
module.exports = { hashPassword, verifyPassword, createSession, userFromReq };
