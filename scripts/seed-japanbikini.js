// Dữ liệu sản phẩm mẫu của Page "Japanbikini_fashion" (FB page_id 117228986319268) để phát triển/kiểm thử Messenger + AI.
// Chạy được nhiều lần: chỉ thêm Page/sản phẩm còn thiếu, không đụng dữ liệu đã có.
//   npm run seed:japanbikini            (CSDL mặc định data/banhang.db, hoặc theo DB_PATH)
// Tồn kho đề bài cho theo từng mã; ở đây chia đều cho 3 size S/M/L (phần dư dồn vào S).
process.env.DB_PATH = process.env.DB_PATH || require('path').join(__dirname, '..', 'data', 'banhang.db');
const { db, tx } = require('../server/db');
const D = require('../server/domain');

const PAGE_NAME = 'Japanbikini_fashion';
const PRODUCTS = [
  ['QOX01', 'Quần ống xuông', 130000, 45], ['QD01', 'Quần đùi', 123000, 44], ['QK01', 'Quần kaki', 100000, 40],
  ['ASM01', 'Áo sơ mi', 14000, 23], ['ACT01', 'Áo cộc tay', 13000, 43], ['AL01', 'Áo len', 12000, 43],
];
const SIZES = ['S', 'M', 'L'];

function seedJapanbikini() {
  return tx(() => {
    let page = db.prepare('SELECT * FROM pages WHERE name=?').get(PAGE_NAME);
    if (!page) {
      const id = Number(db.prepare("INSERT INTO pages (name,fb_url,order_prefix) VALUES (?,?,'JB')").run(PAGE_NAME, 'https://facebook.com/117228986319268').lastInsertRowid);
      page = { id };
    }
    let added = 0;
    for (const [code, name, price, total] of PRODUCTS) {
      if (db.prepare('SELECT 1 FROM products WHERE page_id=? AND code=?').get(page.id, code)) continue;
      const pidp = Number(db.prepare('INSERT INTO products (page_id,code,name,price,cost,low_threshold) VALUES (?,?,?,?,0,3)').run(page.id, code, name, price).lastInsertRowid);
      SIZES.forEach((s, i) => {
        const vid = Number(db.prepare('INSERT INTO variants (product_id,size,color,stock) VALUES (?,?,\'\',0)').run(pidp, s).lastInsertRowid);
        const qty = Math.floor(total / 3) + (i === 0 ? total % 3 : 0);
        if (qty) D.stockMove(vid, qty, 'nhap', null, 'Tồn đầu kỳ (dữ liệu mẫu)', null);
      });
      added++;
    }
    return { page_id: page.id, added };
  });
}
module.exports = { seedJapanbikini };
if (require.main === module) { const r = seedJapanbikini(); console.log(`Page ${PAGE_NAME} (id ${r.page_id}): thêm ${r.added} sản phẩm.`); }
