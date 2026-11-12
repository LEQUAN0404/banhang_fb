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

## Giai đoạn 3: tự gửi, ghi đơn, trừ kho, vận đơn GHTK

### Chế độ "Tự gửi"
- Bản trả lời đã qua mọi kiểm tra và **không có cờ** thì được gửi ngay cho khách.
- Bản có cờ thì luôn giữ lại làm nháp.
- Nếu Messenger từ chối gửi (ví dụ đã quá 24 giờ kể từ tin cuối của khách), bản trả lời ở lại làm nháp và hội thoại được gắn cờ **Tự gửi tin thất bại**.

### Chốt đơn trong chat (quy tắc i)
**Khi nào được coi là khách đã xác nhận:** shop đã gửi bản tóm tắt đơn, sau đó khách trả lời bất kỳ — bổ sung tên, đồng ý, hay thêm thông tin còn thiếu.

**Điều kiện để ghi đơn:** phải có đủ mặt hàng, size, số lượng, số điện thoại hợp lệ, tỉnh/thành, phường/xã và số nhà – đường.
- Khách chưa cho tên người nhận thì app dùng **tên Facebook** của khách.
- AI hỏi lại tên đúng một lần, câu hỏi đặt ngay trước câu cảm ơn cuối tin.
- Nếu sau đó khách cho tên khác, đơn đang mở được cập nhật tên người nhận. Nếu đơn đã có vận đơn, app ghi chú vào đơn và gắn cờ để chủ shop sửa tên trên GHTK.

**Thứ tự xử lý:** chỉ sau khi tin xác nhận **đã gửi thành công**, app mới:
1. tạo đơn với người tạo là tài khoản hệ thống **"AI (tự động)"**. Tài khoản này bị khoá đăng nhập;
2. chọn thanh toán **COD**;
3. chuyển đơn ngay sang **Đã xác nhận**. Tồn kho được trừ ở bước này, bằng cơ chế sẵn có của app, đúng một lần;
4. nếu GHTK đã cấu hình, tạo vận đơn ngay (xem bên dưới).

Ở chế độ nháp, các bước trên chạy khi nhân viên bấm **Gửi bản này**.

**Chống ghi trùng:** mỗi đơn gắn với mã (mid) của tin nhắn chốt đơn, mã này là duy nhất. Ngoài ra, cùng hội thoại, cùng số điện thoại và cùng hàng trong 6 giờ thì không ghi thêm đơn.

### Chủ shop tự chốt đơn trong Page inbox (quy tắc j)
Mỗi tin chủ shop gõ trong Page inbox (Business Suite) được AI đọc để xác định có phải tin chốt đơn không. App không gửi thêm tin nào cho khách.

| Kết quả | App làm gì |
|---|---|
| Đủ mặt hàng, size, số lượng, **tên**, số điện thoại, địa chỉ | Ghi đơn như đơn AI chốt: Đã xác nhận, trừ kho một lần, tạo vận đơn nếu GHTK đã cấu hình |
| Gần đủ nhưng còn thiếu | Không ghi đơn, gắn cờ 🚩 **Chốt đơn còn thiếu thông tin** kèm danh sách phần thiếu |
| Không phải tin chốt đơn | Không làm gì |

### GHTK
Cấu hình riêng cho từng Page tại **Cài đặt Page → 🚚 Kết nối GHTK**, gồm:
- API token. Token được mã hoá khi lưu và không bao giờ trả ra giao diện;
- X-Client-Source, nếu GHTK cấp;
- môi trường thật hoặc thử nghiệm;
- tên, SĐT và địa chỉ lấy hàng.

**Khi chưa cấu hình** (trạng thái "chờ cấu hình"):
- AI nói với khách "shop đang kiểm tra phí ship" và không đoán số;
- đơn vẫn được ghi, với phí ship = 0 và ghi chú "phí ship chờ tra GHTK";
- sau khi cấu hình, bấm **🚚 Tạo vận đơn GHTK** trong đơn để tạo vận đơn và cập nhật phí ship thật.

**Khi đã cấu hình:**
- Công cụ `ghtk_quote` của AI gọi `GET /services/shipment/fee` để lấy phí ship thật, và `GET /services/shipment/deliver-time` để lấy thời gian giao. Nếu không lấy được thời gian giao, AI nói shop đang kiểm tra thời gian.
- Khối lượng gói hàng tính theo **khối lượng từng sản phẩm** (trường mới trong Sản phẩm, mặc định 300 g) nhân số lượng.
- Sau khi ghi đơn, app gọi `POST /services/shipment/order/?ver=1.5`, rồi ghi **mã vận đơn**, **phí ship thật** và **tổng tiền = tiền hàng + ship** vào đơn.
- Thu hộ (`pick_money`) bằng số tiền còn phải thu của người nhận; `is_freeship=1`, tức shop trả phí cho GHTK và thu lại của khách trong tiền COD.
- Chỉ tạo vận đơn cho đơn **chưa có mã vận đơn**. Tạo lỗi thì ghi vào lịch sử đơn và gắn cờ **Tạo vận đơn GHTK lỗi**.
- Đơn vẫn ở trạng thái **Đã xác nhận** để kho đóng gói. Khi bấm **Gửi hàng**, mã vận đơn đã được điền sẵn.

> Phần GHTK được viết theo tài liệu api.ghtk.vn và mới chỉ được kiểm thử với máy chủ giả lập. Khi có token thật, nên thử ở môi trường **staging** trước để đối chiếu tên trường trả về, nhất là trường thời gian giao.
