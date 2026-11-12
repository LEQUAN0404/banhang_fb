# AI trả lời tin nhắn Messenger

App dùng **Claude API (Anthropic)** để soạn trả lời cho khách nhắn vào Page.
AI tuân theo bộ quy tắc của shop, viết trong `server/ai.js` (hằng `RULES`).

## Bật AI
1. Tạo API key tại https://console.anthropic.com → **API Keys**. Việc này do chủ shop tự làm và có tính phí theo lượng dùng.
2. Trên Railway, vào **Variables** và thêm `ANTHROPIC_API_KEY` = key vừa tạo.
3. Trong app, vào **Cài đặt Page → 🤖 Trả lời tin nhắn bằng AI** và chọn chế độ cho từng Page.

Khi chưa có key, AI ở trạng thái **chờ cấu hình**. Mọi phần khác của app chạy bình thường.

| Biến | Bắt buộc | Ý nghĩa |
|---|---|---|
| `ANTHROPIC_API_KEY` | có | API key của Anthropic |
| `ANTHROPIC_MODEL` | không | mặc định `claude-opus-5-5` |
| `AI_DEBOUNCE_MS` | không | thời gian chờ để gom các tin khách gửi liên tiếp, mặc định `8000` (8 giây) |
| `AI_FALLBACKS` | không | đặt `0` để tắt tính năng tự chuyển sang model dự phòng khi model chính từ chối trả lời |

## Các chế độ (mỗi Page một chế độ)
| Chế độ | Hành vi |
|---|---|
| Tắt | AI không chạy. Vẫn có thể bấm **Nhờ AI soạn trả lời** trong từng hội thoại |
| Soạn nháp chờ duyệt | AI soạn sẵn tin. Nhân viên đọc, sửa nếu cần, rồi bấm **Gửi bản này** |
| Tự gửi | AI gửi luôn cho khách (xem giai đoạn 3 bên dưới) |

## Cách AI làm việc
1. Tin mới của khách về qua webhook. App chờ thêm vài giây để gom các tin khách gửi liên tiếp.
2. AI nhận đủ ngữ cảnh: quy tắc của shop, danh sách sản phẩm của **chính Page đó** (giá, size, tồn kho), các đơn đã ghi cho khách này, và tối đa 40 tin gần nhất trong hội thoại.
3. Khi đã có địa chỉ khách, AI có thể gọi công cụ `ghtk_quote` để tra phí ship và thời gian giao từ GHTK. Nếu chưa kết nối GHTK, công cụ trả về "chưa tra được" và AI nói với khách rằng shop đang kiểm tra phí ship.
4. AI trả về kết quả dạng JSON gồm: nội dung tin trả lời, ngôn ngữ, ý định của khách, cờ báo chủ shop, và thông tin đơn đang thu thập.

## Kiểm tra tự động trước khi gửi
App không tin hoàn toàn vào AI. Mỗi bản trả lời được kiểm tra các điểm sau:

- **Câu cảm ơn:** tin phải có đúng **một** câu cảm ơn, và câu đó phải là **câu cuối cùng**. App kiểm tra được với tiếng Việt, Anh, Nhật, Hàn, Trung, Pháp, Thái, Tây Ban Nha, Đức và Indonesia. Tin bằng ngôn ngữ khác luôn được giữ lại làm nháp để người duyệt.
- **Số tiền:** mọi số tiền trong tin, ví dụ `130.000đ` hay `130k`, phải khớp với giá sản phẩm, thành tiền, phí ship GHTK đã tra hoặc tổng tiền đơn.
- **Sản phẩm trong đơn:** mã sản phẩm và size phải có thật, và tồn kho phải đủ.

Nếu bản trả lời sai, AI được soạn lại **một lần**. Lần thứ hai vẫn sai thì bản nháp được gắn cờ **🚩 Bản nháp chưa qua kiểm tra tự động** và không bao giờ tự gửi.

## Các trường hợp luôn chỉ soạn nháp và gắn cờ 🚩
- Khách khiếu nại hoặc đang giận.
- Khách mặc cả giá.
- Khách hỏi ngoài phạm vi bán hàng.
- Khách hỏi thông tin cá nhân của chủ shop.
- AI từ chối trả lời, hoặc gặp lỗi khi gọi API.

Hội thoại có cờ hiện ở tab **🚩 Cần chủ shop** và được nhắc trên trang Tổng quan.
Bấm **Gỡ cờ** sau khi xử lý xong.

Nếu chủ shop tự trả lời khách trong Page inbox, bản nháp AI đang chờ duyệt sẽ tự bị thay thế.
