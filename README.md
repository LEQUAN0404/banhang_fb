# App quản lý bán hàng Facebook — Bản 1

Lập trình theo "Quy trình bán hàng Facebook chuẩn" (06/11/2026). Web app responsive + PWA, nhiều Page, nhiều người dùng.

## Chạy thử
```
npm install
npm run seed     # (tuỳ chọn) dữ liệu mẫu: Page "Linh bra tokyo"
npm start        # http://localhost:3000
npm test         # kiểm thử quy trình đơn qua API
```
Tài khoản mẫu: `admin/admin123` (Quản trị) · `banhang/123456` (Bán hàng) · `kho/123456` (Kho – đóng gói).
Không chạy seed thì lần đầu khởi động tự tạo `admin` / `admin123` (hoặc `ADMIN_PASSWORD`). Yêu cầu Node ≥ 22.5 (dùng SQLite tích hợp `node:sqlite`).

Biến môi trường: `PORT`, `DB_PATH` (mặc định `data/banhang.db`), `ADMIN_PASSWORD`, `HTTPS=1` (cookie Secure khi chạy sau HTTPS).

## Ánh xạ quy trình → app
| Quy trình | Trong app |
|---|---|
| Nguyên tắc 2 + mục 4 — trạng thái chuẩn | `server/domain.js` `TRANSITIONS`: chỉ cho chuyển đúng bước, theo vai trò; mọi lần chuyển ghi lịch sử |
| Nguyên tắc 3 — truy vết | `order_events` (lịch sử đơn), `stock_moves` (nhập–xuất), `activity_log` (nhật ký thao tác) |
| Nguyên tắc 4 — tồn kho | Trừ kho khi Xác nhận (đơn đặt trước: khi Đóng gói); thiếu hàng thì không xác nhận được; Hủy/Hoàn tự nhập lại kho |
| Nguyên tắc 5 — đối soát | Màn Đối soát: số đơn · tiền thu · hàng xuất kho, cảnh báo lệch, chốt sổ có giải trình |
| GĐ1 | Nguồn khách, mã nội dung, mã chiến dịch trên hội thoại và đơn |
| GĐ2–3 | Hội thoại: kênh, khách mới/cũ (nhận diện theo SĐT), nhãn, câu trả lời nhanh, kịch bản 5 bước, bắt buộc lý do khi không chốt |
| GĐ4 | Tạo đơn từ hội thoại, mã `FB-YYYYMMDD-NNN`, bắt buộc họ tên/SĐT/địa chỉ, tin nhắn xác nhận tự điền, đơn treo > 24h → nhắc 1 lần → hủy |
| GĐ5 | COD / CK / cọc; CK phải có mã giao dịch và phải đủ tiền mới gửi hàng; cọc phải đủ mới gửi; COD ghi thực thu + lý do chênh lệch |
| GĐ6 | Bắt buộc tick kiểm chéo lần 2 + hãng + mã vận đơn; in phiếu giao (có tiền COD); giao thất bại (tối đa 2 lần hẹn lại); hoàn hàng về kho có lý do |
| GĐ7 | Việc "chăm sóc sau 1 ngày" trên Tổng quan, ghi hài lòng/chưa hài lòng (+ nguyên nhân), đơn đổi gắn đơn gốc, Hoàn thành sau thời hạn đổi trả |
| GĐ8 | Báo cáo: đủ các chỉ số chuẩn, theo nguồn/mã nội dung/nhân viên, chi phí ads ÷ đơn, sổ họp tuần (vấn đề → hành động → kết quả) |
| Mục 8 | Đa Page (dữ liệu tách theo Page), tài khoản + vai trò + giao Page, PWA, địa chỉ VN, hãng vận chuyển VN |

## Cấu trúc
- `server/db.js` — lược đồ CSDL (mục 5)
- `server/domain.js` — trạng thái, tồn kho, mã đơn, cài đặt mặc định
- `server/app.js` — API (đăng nhập, phân quyền, theo Page)
- `public/` — giao diện (SPA thuần JS, không cần build), `sw.js` + `manifest.webmanifest` cho PWA

## Việc tiếp theo
- Đưa lên mạng: xem [DEPLOY.md](DEPLOY.md) (Railway + ổ lưu dữ liệu).
- Bản 2: tích hợp Meta Graph API (gom inbox/bình luận, cửa sổ 24h) sau khi được duyệt quyền.
- Kết nối API hãng vận chuyển (tạo vận đơn, tra trạng thái tự động).
