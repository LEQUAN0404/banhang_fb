// Mã hoá token Page (AES-256-GCM) trước khi lưu vào CSDL.
// Khoá lấy từ TOKEN_ENCRYPTION_KEY; nếu chưa đặt thì dùng META_APP_SECRET (đổi App Secret sẽ phải kết nối lại Page).
const crypto = require('crypto');

function key() {
  const k = process.env.TOKEN_ENCRYPTION_KEY || process.env.META_APP_SECRET;
  if (!k) throw Object.assign(new Error('Chưa cấu hình TOKEN_ENCRYPTION_KEY hoặc META_APP_SECRET trên server'), { status: 500 });
  return crypto.createHash('sha256').update('banhang-fb:' + k).digest();
}
function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
}
function decrypt(blob) {
  const [v, iv, tag, enc] = String(blob).split(':');
  if (v !== 'v1') throw new Error('Định dạng token không hợp lệ');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
module.exports = { encrypt, decrypt };
