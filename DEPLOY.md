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
| `TZ` | `Asia/Ho_Chi_Minh` (để giờ trong app là giờ Việt Nam) |

Nếu kết nối Messenger (tin nhắn Facebook Page), thêm cả các biến dưới đây. Cách lấy từng giá trị xem ở [docs/META_SETUP.md](docs/META_SETUP.md).

| Tên | Giá trị |
|---|---|
| `META_APP_ID` | App ID của Meta app |
| `META_APP_SECRET` | App Secret của Meta app |
| `META_WEBHOOK_VERIFY_TOKEN` | chuỗi bí mật tự đặt, trùng với Verify token khai báo ở Meta |
| `META_GRAPH_VERSION` | ví dụ `v23.0` |
| `TOKEN_ENCRYPTION_KEY` | (nên có) chuỗi ngẫu nhiên dài để mã hoá token Page |
| `META_LOGIN_CONFIG_ID` | (tuỳ chọn) Configuration ID nếu dùng Facebook Login for Business |

Nếu muốn AI trả lời tin nhắn, thêm biến dưới đây. Chi tiết xem [docs/AI.md](docs/AI.md). Token GHTK không đặt ở đây mà nhập trong app: **Cài đặt Page → 🚚 Kết nối GHTK**.

| Tên | Giá trị |
|---|---|
| `ANTHROPIC_API_KEY` | API key tạo tại console.anthropic.com |
| `SEED_JAPANBIKINI` | (tuỳ chọn) `1` để nạp 6 sản phẩm mẫu của Page Japanbikini_fashion khi app khởi động. Chạy nhiều lần không bị trùng; nạp xong có thể xoá biến này |

Lưu lại và Railway tự deploy lại.

## Bước 5 — Lấy địa chỉ web
Service → tab **Settings → Networking → Generate Domain**. Bạn sẽ có địa chỉ dạng `https://banhang-fb-production.up.railway.app`.
(Nếu có tên miền riêng, bấm **Custom Domain** và làm theo hướng dẫn trỏ DNS.)

## Bước 6 — Dùng thử
1. Mở địa chỉ web và đăng nhập `admin` + mật khẩu đã đặt ở `ADMIN_PASSWORD`.
2. Vào **🔑 Tài khoản → Đổi mật khẩu** ngay.
3. Vào **Tài khoản & Page** → thêm Page (ví dụ "Linh bra tokyo") → thêm tài khoản cho nhân viên và giao Page.
4. Trên điện thoại: mở địa chỉ web, chọn **Thêm vào màn hình chính** (iPhone: nút Chia sẻ trong Safari; Android: menu ⋮ trong Chrome).

## Kết nối tin nhắn Facebook Page (Messenger)
Làm theo [docs/META_SETUP.md](docs/META_SETUP.md): tạo Meta app, đặt webhook, khai báo biến môi trường, rồi bấm **Tài khoản & Page → Kết nối Facebook** trong app.

## Sao lưu dữ liệu
Tài khoản quản trị: **Tài khoản & Page → ⬇ Tải bản sao lưu dữ liệu**. Nên tải mỗi tuần và cất vào Google Drive.

## Kiểm tra app còn sống
Mở `https://<địa-chỉ-của-bạn>/healthz`. Nếu thấy `{"ok":true}` là app đang chạy bình thường.
