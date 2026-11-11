const app = require('./app');
const { db } = require('./db');
const { hashPassword } = require('./auth');

// Lần chạy đầu: tạo tài khoản quản trị
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  const pw = process.env.ADMIN_PASSWORD || 'admin123';
  db.prepare("INSERT INTO users (username,name,password_hash,role) VALUES ('admin','Chủ shop',?,'admin')").run(hashPassword(pw));
  console.log(`Đã tạo tài khoản quản trị: admin / ${pw}  (đổi mật khẩu ngay sau khi đăng nhập)`);
}
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`App bán hàng Facebook chạy tại http://localhost:${port}`));
