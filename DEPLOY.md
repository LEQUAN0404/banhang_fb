# Đưa app lên mạng với Railway

Railway lấy code trực tiếp từ GitHub. Mỗi lần có code mới trên nhánh `main`, Railway tự cập nhật app.
Chi phí: gói Hobby khoảng 5 USD/tháng (đã gồm 5 USD tiền dùng). Giá có thể thay đổi, xem tại https://railway.com/pricing.

## Bước 1 — Tạo tài khoản
Vào https://railway.com và bấm **Login → Login with GitHub** (dùng chính tài khoản GitHub chứa repo `banhang_fb`).
Nâng cấp lên gói **Hobby** (cần thẻ Visa/Mastercard).

## Bước 2 — Tạo dự án từ GitHub
1. Bấm **New Project → Deploy from GitHub repo**.
2. Cho phép Railway truy cập repo `LEQUAN0404/banhang_fb` rồi chọn repo đó.
3. Railway tự nhận diện app Node.js và bắt đầu build. Lần đầu có thể báo lỗi hoặc chạy chưa đúng vì chưa có ổ lưu dữ liệu. Làm tiếp bước 3.

## Bước 3 — Gắn ổ lưu dữ liệu (BẮT BUỘC)
Không có bước này, **mọi đơn hàng sẽ mất mỗi lần app khởi động lại**.
1. Trong dự án, chuột phải vào service `banhang_fb` (hoặc bấm **+ Create → Volume**).
2. Chọn gắn vào service `banhang_fb`, **Mount path** điền: `/data`

## Bước 4 — Biến môi trường
Mở service → tab **Variables** → thêm:

| Tên | Giá trị |
|---|---|
| `DB_PATH` | `/data/banhang.db` |
| `ADMIN_PASSWORD` | một mật khẩu mạnh do bạn tự đặt (dùng cho tài khoản `admin` lần đầu) |
| `HTTPS` | `1` |

Lưu lại và Railway tự deploy lại.

## Bước 5 — Lấy địa chỉ web
Service → tab **Settings → Networking → Generate Domain**. Bạn sẽ có địa chỉ dạng `https://banhang-fb-production.up.railway.app`.
(Nếu có tên miền riêng, bấm **Custom Domain** và làm theo hướng dẫn trỏ DNS.)

## Bước 6 — Dùng thử
1. Mở địa chỉ web và đăng nhập `admin` + mật khẩu đã đặt ở `ADMIN_PASSWORD`.
2. Vào **🔑 Tài khoản → Đổi mật khẩu** ngay.
3. Vào **Tài khoản & Page** → thêm Page (ví dụ "Linh bra tokyo") → thêm tài khoản cho nhân viên và giao Page.
4. Trên điện thoại: mở địa chỉ web, chọn **Thêm vào màn hình chính** (iPhone: nút Chia sẻ trong Safari; Android: menu ⋮ trong Chrome).

## Sao lưu dữ liệu
Tài khoản quản trị: **Tài khoản & Page → ⬇ Tải bản sao lưu dữ liệu**. Nên tải mỗi tuần và cất vào Google Drive.

## Kiểm tra app còn sống
Mở `https://<địa-chỉ-của-bạn>/healthz`. Nếu thấy `{"ok":true}` là app đang chạy bình thường.
