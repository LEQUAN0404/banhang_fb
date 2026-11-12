// Tạo dữ liệu mẫu: Page "Linh bra tokyo", 3 tài khoản, sản phẩm, khách, hội thoại, đơn ở nhiều trạng thái.
process.env.DB_PATH = process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'banhang.db');
const { db } = require('../server/db');
const { hashPassword } = require('../server/auth');
const D = require('../server/domain');

if (db.prepare('SELECT 1 FROM pages LIMIT 1').get()) { console.log('CSDL đã có dữ liệu — bỏ qua seed.'); process.exit(0); }
const mkUser = (u, n, r) => db.prepare('INSERT OR IGNORE INTO users (username,name,password_hash,role) VALUES (?,?,?,?)').run(u, n, hashPassword('123456'), r);
if (!db.prepare("SELECT 1 FROM users WHERE username='admin'").get()) mkUser('admin', 'Chủ shop', 'admin');
db.prepare("UPDATE users SET password_hash=? WHERE username='admin'").run(hashPassword('admin123'));
mkUser('banhang', 'Nhân viên bán hàng', 'sales'); mkUser('kho', 'Nhân viên kho', 'warehouse');
const pid = Number(db.prepare("INSERT INTO pages (name,fb_url,order_prefix) VALUES ('Linh bra tokyo','https://facebook.com/linhbratokyo','FB')").run().lastInsertRowid);
db.prepare("INSERT INTO pages (name,order_prefix) VALUES ('Page thử nghiệm 2','P2')").run();
for (const u of ['banhang', 'kho']) db.prepare('INSERT INTO user_pages SELECT id, ? FROM users WHERE username=?').run(pid, u);
const admin = db.prepare("SELECT * FROM users WHERE username='admin'").get();
const sales = db.prepare("SELECT * FROM users WHERE username='banhang'").get();
const kho = db.prepare("SELECT * FROM users WHERE username='kho'").get();

const products = [
  ['BR01', 'Áo bra ren Tokyo', 289000, 120000, ['70B', '75B', '80B'], ['Đen', 'Da']],
  ['BR02', 'Áo bra su không gọng', 199000, 80000, ['S', 'M', 'L'], ['Trắng', 'Hồng']],
  ['QL01', 'Quần lót cotton Nhật', 59000, 22000, ['M', 'L'], ['Mix']],
  ['SET01', 'Set đồ ngủ lụa', 459000, 210000, ['M', 'L'], ['Xanh', 'Be']],
];
for (const [code, name, price, cost, sizes, colors] of products) {
  const id = Number(db.prepare('INSERT INTO products (page_id,code,name,price,cost,low_threshold) VALUES (?,?,?,?,?,3)').run(pid, code, name, price, cost).lastInsertRowid);
  for (const s of sizes) for (const c of colors) {
    const vid = Number(db.prepare('INSERT INTO variants (product_id,size,color,stock) VALUES (?,?,?,0)').run(id, s, c).lastInsertRowid);
    D.stockMove(vid, 2 + Math.floor(Math.random() * 12), 'nhap', null, 'Tồn đầu kỳ', admin.id);
  }
}
const V = (code, size, color) => db.prepare('SELECT v.id FROM variants v JOIN products p ON p.id=v.product_id WHERE p.code=? AND v.size=? AND v.color=?').get(code, size, color).id;
const conv = (name, phone, src, interest, outcome, reason) => Number(db.prepare(`INSERT INTO conversations (page_id,customer_name,phone,channel,source,content_code,interest,summary,outcome,lost_reason,user_id,tags)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(pid, name, phone, 'inbox', src, src === 'Reels' ? 'R-1105-A' : null, interest, 'Hỏi size, đã gợi ý 2 mẫu kèm ảnh', outcome, reason, sales.id, 'hỏi size').lastInsertRowid);
conv('Ngọc Anh', '0912345001', 'Reels', 'Áo bra ren', 'dang_tu_van');
conv('Thu Hà', null, 'Bài đăng', 'Set đồ ngủ', 'khong_chot', 'Giá cao');
conv('Mai Phương', null, 'Quảng cáo (ads)', 'Bra su', 'khong_chot', 'Hết size/màu');
const addr = { province: 'Hà Nội', ward: 'Phường Cầu Giấy', street: '12 Trần Thái Tông' };
const mk = (name, phone, items, extra = {}) => {
  const c = conv(name, phone, extra.source || 'Reels', items[0][0], 'dang_tu_van');
  return D.createOrder(pid, sales, { ship_name: name, ship_phone: phone, ...addr, ...extra, conversation_id: c,
    items: items.map(([code, s, col, qty]) => ({ variant_id: V(code, s, col), qty })) });
};
const o1 = mk('Lan Phạm', '0987000111', [['BR01', '75B', 'Đen', 1], ['QL01', 'M', 'Mix', 3]]);
const o2 = mk('Hương Trần', '0987000222', [['SET01', 'M', 'Xanh', 1]], { pay_method: 'ck', province: 'TP. Hồ Chí Minh' });
const o3 = mk('Minh Thư', '0987000333', [['BR02', 'S', 'Hồng', 2]]);
const o4 = mk('Bảo Ngọc', '0987000444', [['BR01', '70B', 'Da', 1]], { source: 'Quảng cáo (ads)', campaign_code: 'ADS-T11' });
const o5 = mk('Thanh Vân', '0987000555', [['BR02', 'M', 'Trắng', 1]]);
D.changeStatus(o3, pid, sales, 'da_xac_nhan');
D.changeStatus(o3, pid, kho, 'dang_dong_goi');
D.changeStatus(o4, pid, sales, 'da_xac_nhan'); D.changeStatus(o4, pid, kho, 'dang_dong_goi');
D.changeStatus(o4, pid, kho, 'da_gui', { carrier: 'GHTK', tracking_code: 'S123456789', checked: true });
D.changeStatus(o5, pid, sales, 'da_xac_nhan'); D.changeStatus(o5, pid, kho, 'dang_dong_goi');
D.changeStatus(o5, pid, kho, 'da_gui', { carrier: 'GHN', tracking_code: 'GHN987654', checked: true });
D.changeStatus(o5, pid, kho, 'giao_thanh_cong', { ship_cost_actual: 22000 });
db.prepare("UPDATE orders SET delivered_at=datetime('now','localtime','-2 days') WHERE id=?").run(o5);
db.prepare("UPDATE orders SET created_at=datetime('now','localtime','-30 hours') WHERE id=?").run(o1);
db.prepare("INSERT INTO ad_spend (page_id,day,campaign_code,amount) VALUES (?,date('now','localtime'),'ADS-T11',150000)").run(pid);
require('./seed-japanbikini').seedJapanbikini();
console.log('Đã tạo dữ liệu mẫu. Tài khoản: admin/admin123 · banhang/123456 · kho/123456');
