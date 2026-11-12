# Kết nối Facebook Page (Messenger) với app

App đọc và trả lời tin nhắn Messenger của Page qua **API chính thức của Meta** (Graph API + Webhook), chạy 24/7 trên Railway.
Không dùng đăng nhập trình duyệt hay Business Suite.

Địa chỉ dưới đây lấy theo app đang chạy: `https://banhangfb-production.up.railway.app`. Nếu đổi tên miền, thay cho đúng.
Trong app, trang **Tài khoản & Page → Kết nối Facebook** luôn hiện đúng 3 địa chỉ cần dán vào Meta, kèm nút **Chép**.

| Dùng cho | Địa chỉ |
|---|---|
| Callback URL (Webhook) | `https://banhangfb-production.up.railway.app/webhooks/meta` |
| Valid OAuth Redirect URI | `https://banhangfb-production.up.railway.app/api/meta/oauth/callback` |
| Privacy Policy URL | `https://banhangfb-production.up.railway.app/privacy.html` |

---

## Phần A — Chủ shop tự làm trên tài khoản Meta (Claude không làm thay)

### A1. Tạo Meta app
1. Đăng nhập https://developers.facebook.com bằng tài khoản Facebook **đang quản trị Page Japanbikini_fashion**. Lần đầu sẽ phải đăng ký tài khoản nhà phát triển.
2. Bấm **My Apps → Create App**.
3. Ở bước chọn trường hợp sử dụng (use case), chọn mục về **Messenger / tương tác với khách hàng trên Messenger**. Nếu được hỏi loại app, chọn **Business**.
4. Đặt tên app, ví dụ `Banhang FB`, nhập email liên hệ, rồi gắn với **Business portfolio** của shop (nếu có).

### A2. Lấy App ID và App Secret
**App settings → Basic**:
- Chép **App ID** và **App Secret** (bấm Show). Hai giá trị này dùng ở Phần B.
- **Privacy Policy URL**: dán địa chỉ Privacy Policy ở bảng trên.
- **App domains**: `banhangfb-production.up.railway.app`.
- **Category**: chọn Shopping hoặc Business. Bấm **Save changes**.

Đọc phiên bản Graph API ở góc trên trang Dashboard của app (ví dụ `v23.0`) để điền `META_GRAPH_VERSION`.

### A3. Cấu hình đăng nhập Facebook
1. Thêm sản phẩm **Facebook Login for Business**. Nếu menu chỉ có **Facebook Login** thì dùng cái đó.
2. **Settings → Valid OAuth Redirect URIs**: dán địa chỉ Redirect URI ở bảng trên, rồi Save.
3. Chỉ với Facebook Login for Business:
   1. Vào **Configurations → Create configuration**.
   2. Chọn loại token **System-user** hoặc **User access token**, tuỳ những gì Meta cho chọn. Chọn tài sản **Pages**.
   3. Chọn các quyền: `pages_show_list`, `pages_messaging`, `pages_manage_metadata`.
   4. Lưu, rồi chép **Configuration ID** để điền `META_LOGIN_CONFIG_ID`.

### A4. Đặt webhook Messenger
**Messenger → Messenger API Settings** (hoặc **Webhooks**, chọn đối tượng **Page**):
1. **Callback URL**: dán địa chỉ Webhook ở bảng trên.
2. **Verify token**: chuỗi bí mật bạn tự nghĩ ra, ví dụ `jb-2026-xyz`. Chuỗi này phải **trùng** với `META_WEBHOOK_VERIFY_TOKEN` ở Phần B.
3. Bấm **Verify and save**. Làm Phần B trước để server có biến môi trường thì bước verify mới thành công.
4. Đăng ký các trường (fields): `messages`, `message_echoes`, `messaging_postbacks`.

App tự đăng ký từng Page vào webhook khi bạn bấm Kết nối ở Phần C. Bạn không cần bấm **Add subscriptions** cho từng Page.

### A5. Chế độ Development: dùng ngay, chưa cần App Review
Khi app Meta còn ở chế độ **Development**:
- Chỉ người có vai trò **Admin, Developer hoặc Tester** trong app Meta mới kết nối được Page (Page họ quản lý).
- Webhook chỉ gửi về tin nhắn **từ những người có vai trò đó**. Khách thật nhắn vào Page sẽ **chưa** về app.

Để thử, thêm tài khoản Facebook cá nhân dùng để nhắn thử vào **App roles → Roles → Testers**. Người đó phải bấm chấp nhận lời mời.

### A6. Nộp App Review: nhận tin của mọi khách
Vào **App Review → Permissions and Features**, xin **Advanced Access** cho các quyền dưới đây.
Trước đó cần hoàn tất **Business Verification** (xác minh doanh nghiệp) trong Business Settings.

| Quyền | Mô tả dùng để làm gì (dán vào ô giải thích) |
|---|---|
| `pages_show_list` | Sau khi chủ shop đăng nhập, app liệt kê các Page họ quản lý để chọn đúng Page bán hàng cần kết nối vào hệ thống quản lý đơn. |
| `pages_messaging` | App hiển thị hội thoại Messenger của Page cho nhân viên bán hàng, cho họ trả lời khách (hỏi giá, size, tồn kho, phí ship) và xác nhận đơn ngay trong app. Ở giai đoạn sau, app soạn câu trả lời gợi ý dựa trên dữ liệu sản phẩm và tồn kho của shop. |
| `pages_manage_metadata` | App đăng ký webhook cho Page (`/{page-id}/subscribed_apps`) để nhận tin nhắn mới theo thời gian thực, giúp shop không bỏ sót khách. |

Mỗi quyền cần **một video quay màn hình** khoảng 1–3 phút, quay theo thứ tự:
1. Đăng nhập app.
2. Mở Kết nối Facebook, đăng nhập Facebook và chọn Page.
3. Nhắn tin thử vào Page từ một tài khoản khác. Tin hiện ở mục Hội thoại với nhãn **Chưa trả lời**.
4. Trả lời từ app, rồi cho thấy khách nhận được tin trên Messenger.

Cung cấp cho người duyệt một tài khoản đăng nhập app để thử, ví dụ một tài khoản vai trò Bán hàng chỉ được giao Page thử nghiệm.

Duyệt xong, chuyển app sang chế độ **Live**: bật công tắc App Mode ở đầu trang.

Nếu sau này muốn mở rộng sang bình luận, cần xin thêm `pages_manage_engagement` và `pages_read_user_content`. Bản này chưa dùng hai quyền đó.

---

## Phần B — Khai báo biến môi trường trên Railway
Mở service → **Variables**, thêm các biến sau. Railway tự deploy lại sau khi lưu.

| Biến | Giá trị |
|---|---|
| `META_APP_ID` | App ID ở bước A2 |
| `META_APP_SECRET` | App Secret ở bước A2. Dùng để kiểm tra chữ ký `X-Hub-Signature-256` của mọi webhook |
| `META_WEBHOOK_VERIFY_TOKEN` | chuỗi bạn tự đặt ở bước A4 |
| `META_GRAPH_VERSION` | ví dụ `v23.0`. Lấy theo phiên bản ở Dashboard app Meta |
| `TOKEN_ENCRYPTION_KEY` | *(nên có)* một chuỗi ngẫu nhiên dài, dùng để mã hoá Page Access Token trong CSDL |
| `META_LOGIN_CONFIG_ID` | *(chỉ khi dùng Facebook Login for Business)* Configuration ID ở bước A3 |
| `TZ` | *(nên có)* `Asia/Ho_Chi_Minh`, để giờ trong app là giờ Việt Nam |

**Lưu ý về `TOKEN_ENCRYPTION_KEY`:**
- Không đặt biến này thì app dùng `META_APP_SECRET` làm khoá mã hoá.
- Đặt `TOKEN_ENCRYPTION_KEY` thì sau này đổi App Secret không ảnh hưởng.
- Nếu đổi khoá đang dùng, phải bấm **Kết nối** lại từng Page.

Token của Page lưu trong CSDL, tức trong volume `/data`, ở dạng đã mã hoá.

## Phần C — Kết nối Page trong app
1. Đăng nhập app bằng tài khoản quản trị, vào **Tài khoản & Page → Kết nối Facebook**. Mục **Cấu hình server** phải hiện ✅ cho 3 biến `META_*` bắt buộc.
2. Bấm **🔗 Kết nối Facebook Page**, đăng nhập Facebook, tích chọn Page **Japanbikini_fashion** và đồng ý cấp quyền.
3. Quay lại app, bấm **Kết nối** cạnh Page.
4. Chọn Page trong app để gắn vào (ví dụ `Japanbikini_fashion`), hoặc để trống để app tạo Page mới.

App sẽ làm tiếp:
- đăng ký webhook cho Page;
- đồng bộ 50 hội thoại gần nhất;
- từ đó, mọi tin nhắn mới tự về mục **Hội thoại**.

**Cách khác:** bấm **Dán Page Access Token (thử nghiệm)**, rồi dán token lấy từ https://developers.facebook.com/tools/explorer:
1. Chọn app của bạn.
2. Ở **User or Page**, chọn Page.
3. Cấp quyền `pages_messaging` và `pages_manage_metadata`.

Token dán tay thường hết hạn sau khoảng 1–2 giờ. Chỉ dùng cách này để thử nhanh. Để dùng lâu dài, hãy dùng nút **Kết nối Facebook Page**.

## Phần D — Kiểm tra
1. Dùng một tài khoản là Tester (xem A5) nhắn vào Page.
2. Trong vòng vài giây, tin hiện ở **Hội thoại** với nhãn đỏ **Chưa trả lời**. Trang Tổng quan báo số hội thoại chưa trả lời.
3. Mở hội thoại, gõ trả lời và bấm **Gửi**. Khách nhận được tin trên Messenger, hội thoại chuyển sang **Đã trả lời**.
4. Trả lời trong Page inbox (Business Suite) cũng được ghi lại, với ghi chú "gửi từ Page inbox".
5. Mục **Sự kiện webhook gần đây** ở trang Kết nối Facebook cho thấy từng sự kiện nhận được.

## Xử lý sự cố
| Hiện tượng | Nguyên nhân thường gặp |
|---|---|
| Meta báo không verify được Callback URL | `META_WEBHOOK_VERIFY_TOKEN` trên Railway khác chuỗi đã nhập ở Meta, hoặc Railway chưa deploy xong |
| Nhắn vào Page nhưng app không thấy tin | App Meta đang ở Development mà người nhắn không phải Tester; hoặc chưa đăng ký field `messages` ở A4 |
| Sự kiện webhook ghi `unknown_page` | Page đó chưa được kết nối trong app |
| Gửi trả lời báo quá 24 giờ | Quy định của Messenger: Page chỉ được trả lời trong 24 giờ kể từ tin cuối của khách. Hãy trả lời trong Page inbox |
| Trạng thái Page báo lỗi token (Invalid OAuth / code 190) | Token bị thu hồi, do đổi mật khẩu Facebook hoặc mất quyền quản trị Page. Bấm **Kết nối Facebook Page** lại |
