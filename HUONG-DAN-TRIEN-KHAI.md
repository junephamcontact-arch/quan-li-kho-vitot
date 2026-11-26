# HƯỚNG DẪN TRIỂN KHAI — Quản lí kho Vitot (bản standalone v24.261126)

Bản này chạy độc lập hoàn toàn: chỉ cần **Node.js ≥ 20**, **không cần `npm install`** (không dùng thư viện ngoài). **Database chính là Google Sheet "QUẢN LÍ KHO HÀNG VITOT"** — app không lưu dữ liệu trên ổ đĩa máy chủ, nên đưa lên hosting nào cũng không lo mất dữ liệu khi app khởi động lại/deploy lại.

Ánh xạ dữ liệu trong Sheet:

| Dữ liệu | Nơi lưu |
|---|---|
| Tồn kho (POS đổ về) | Tab `TỒN_KHO_POS` — app chỉ đọc, nạp vào bộ nhớ đệm để tra cứu nhanh |
| Nhân viên, mã PIN, vai trò | Tab `CẤU_HÌNH` (tên ở cột B, PIN ở cột E, vai trò ở cột F) — app đọc và ghi ngược khi ADMIN sửa |
| Phiếu nhập / xuất / kiểm kho / chế biến / đối soát | Ghi thêm dòng vào đúng tab `NHẬP_HÀNG` / `XUẤT_HÀNG` / `KIỂM_KHO` / `CHẾ_BIẾN_SƠ_CHẾ` / `ĐỐI_SOÁT_ĐƠN`, đúng định dạng cột sẵn có của từng tab. **Phiếu tạo xong là ghi thẳng xuống Sheet, KHÔNG còn bước quản lí xác nhận** |
| Hàng về dự kiến trên Lịch | Tự suy ra từ phiếu nhập có điền "Ngày về dự kiến" (cột E tab `NHẬP_HÀNG`) — không lưu riêng |
| Sự kiện trên Lịch (kiểu Google Calendar) | Tab `APP_CAI_DAT`, khoá `calendar_events` |
| Cài đặt của app (khoá IP, chức vụ tuỳ chỉnh, phân loại xuất kho, Sheet đang dùng, kho mặc định, tên miền, phiếu chưa ghi được xuống Sheet) | Tab `APP_CAI_DAT` — **app tự tạo tab này** lần đầu chạy có quyền ghi; đừng xoá/đổi tên tab này |

> **Đăng nhập:** dùng chính mã PIN của nhân viên trong tab `CẤU_HÌNH` của Sheet (cột E). Không còn tài khoản mặc định riêng của app — ai có PIN trong Sheet thì đăng nhập được, ADMIN sửa PIN/nhân viên trong Cài đặt là app ghi ngược về `CẤU_HÌNH` ngay.

---

## 1. Chạy thử trên máy của bạn

```bash
cd quan-li-kho-vitot-standalone
node server.js
```

Mở trình duyệt: `http://localhost:3000` → nhập PIN của một nhân viên trong Sheet.

- Chưa cấu hình tài khoản dịch vụ (mục 2): app chạy **chế độ chỉ đọc** — đăng nhập và tra cứu tồn kho hoạt động (đọc Sheet qua kênh công khai, Sheet cần bật chia sẻ "Bất kỳ ai có liên kết đều xem được"), nhưng **chưa tạo được phiếu**. Khi bấm tạo phiếu, app hiện rõ thông báo *"Chưa cấu hình tài khoản dịch vụ Google — app đang ở chế độ chỉ đọc"*.
- Đổi cổng: `PORT=8080 node server.js`.
- Mặc định app dùng Sheet có ID `1xx0vdFCCHpUUbMs5cq-fZ2tSqHLMbq-nfz2h7oaUybk`. Muốn dùng Sheet khác: đặt biến môi trường `SHEET_ID=<id>` hoặc ADMIN vào **Cài đặt → Kết nối Google Sheet** dán link Sheet mới.

---

## 2. Cài đặt tài khoản dịch vụ Google (để app GHI được vào Sheet) — làm 1 lần

Tài khoản dịch vụ (service account) là một "tài khoản robot" của Google: app dùng nó để đọc/ghi Sheet qua Google Sheets API, không cần đăng nhập tài khoản Google cá nhân nào trên máy chủ.

1. Vào [console.cloud.google.com](https://console.cloud.google.com) bằng tài khoản Google của công ty → bấm **New Project** (dự án mới) → đặt tên ví dụ `vitot-kho` → **Create**.
2. Chọn đúng dự án vừa tạo → vào **APIs & Services → Library** → tìm **"Google Sheets API"** → bấm **Enable**.
3. Vào **APIs & Services → Credentials** → **Create Credentials → Service account** → đặt tên ví dụ `kho-app` → **Create and Continue** → (bỏ qua các bước cấp role, bấm **Done**).
4. Trong danh sách Service accounts, bấm vào tài khoản vừa tạo → tab **Keys** → **Add Key → Create new key** → chọn **JSON** → **Create**. Trình duyệt tải về 1 file `.json` — **đây là chìa khoá của app, giữ bí mật như mật khẩu**, không gửi cho người ngoài, không đăng lên mạng.
5. Mở file JSON đó, tìm dòng `"client_email"` — đó là email của tài khoản dịch vụ (dạng `kho-app@vitot-kho.iam.gserviceaccount.com`). Mở Google Sheet "QUẢN LÍ KHO HÀNG VITOT" → **Chia sẻ (Share)** → dán email này vào → cấp quyền **Editor (Người chỉnh sửa)** → **Gửi**. (Không cần bật "báo cho người dùng" — đó là tài khoản robot, không có hộp thư.)
6. Khai báo chìa khoá cho app trên hosting (mục 4), bằng 1 trong 2 cách:
   - **Cách A (khuyên dùng trên Render/Railway):** biến môi trường `GOOGLE_SERVICE_ACCOUNT_JSON` = **toàn bộ nội dung file JSON** (copy nguyên văn cả file, gồm cả dấu ngoặc).
   - **Cách B (VPS/máy riêng):** chép file JSON lên máy chủ (ví dụ `/etc/vitot/sa.json`, đặt quyền đọc chỉ cho user chạy app) và đặt biến môi trường `GOOGLE_APPLICATION_CREDENTIALS=/etc/vitot/sa.json`.
7. Khởi động lại app. Đăng nhập ADMIN → **Cài đặt → Kết nối Google Sheet** sẽ hiện dòng *"✅ Chế độ ĐỌC + GHI — tài khoản dịch vụ: …"*. Lần chạy đầu, app tự tạo tab `APP_CAI_DAT` trong Sheet — đó là tab của app, đừng xoá.

**Giới hạn của Google Sheets API (nói đơn giản):** mỗi phút Google cho phép khoảng 300 lượt đọc và 300 lượt ghi cho mỗi dự án — một đội kho vài người tạo vài chục phiếu/ngày thì không bao giờ chạm tới. App cũng đã nạp dữ liệu vào bộ nhớ đệm nên thao tác hằng ngày (tra cứu, xem lịch sử) không tốn lượt gọi Google; chỉ khi tạo phiếu/sửa nhân viên/sửa cài đặt mới ghi xuống Sheet. Nếu một lần ghi phiếu gặp lỗi (mất mạng, hết quota…), phiếu vẫn được giữ trong app với trạng thái **"Ghi lỗi"** ở Lịch sử phiếu — bấm **"Ghi lại"** để ghi tiếp, không mất dữ liệu.

---

## 3. Dữ liệu & sao lưu

- **Toàn bộ dữ liệu nằm trong Google Sheet** — máy chủ app không giữ file dữ liệu nào. App có thể khởi động lại, deploy lại, thậm chí chuyển hosting, dữ liệu vẫn nguyên vẹn trong Sheet.
- **Sao lưu:** dùng chính tính năng của Google Sheet — **File → Lịch sử phiên bản** để khôi phục khi sửa nhầm, và định kỳ **File → Tạo bản sao** để có bản dự phòng. Tab `APP_CAI_DAT` cũng nằm trong Sheet nên được sao lưu cùng.
- Phiên đăng nhập của nhân viên giữ trong bộ nhớ máy chủ: app khởi động lại thì mọi người đăng nhập lại bằng PIN (không mất dữ liệu).

---

## 4. Đưa lên internet + gắn tên miền riêng `kho.xelientinh247.com`

> **Bối cảnh tên miền của Vitot:** tên miền `xelientinh247.com` đăng ký tại **TenTen** (tenten.vn), nhưng **DNS được quản lí tại Cloudflare** (gói Free). TenTen chỉ còn giữ vai trò **nơi đăng ký + trỏ nameserver** — từ nay mọi bản ghi DNS đều thêm/sửa ở **Cloudflare**, KHÔNG sửa DNS ở TenTen nữa. Ví dụ xuyên suốt mục này: app chạy trên Render tại `quan-li-kho-vitot.onrender.com`, tên miền riêng là **`kho.xelientinh247.com`**.

Trên mọi nền tảng bên dưới, nhớ khai báo biến môi trường của tài khoản dịch vụ (mục 2, bước 6) — đặt xong phải khởi động lại/redeploy app mới có hiệu lực.

### 4a. Render.com (đơn giản nhất, có gói miễn phí)

1. Đẩy thư mục này lên một repo GitHub (trong thư mục đã có sẵn file **`render.yaml`** — Render Blueprint).
2. Vào [render.com](https://render.com) → **New → Blueprint** → chọn repo → Render tự tạo Web Service theo `render.yaml` (Runtime Node, Start Command `node server.js`, không cần build). Nếu tạo thủ công bằng **New → Web Service**: **Build Command** để `echo ok`, **Start Command** `node server.js`.
3. Vào **Environment** → điền các biến (khớp với `render.yaml`):
   - `GOOGLE_SERVICE_ACCOUNT_JSON` = toàn bộ nội dung file JSON của tài khoản dịch vụ (**bắt buộc** để ghi được Sheet).
   - `SHEET_ID` = ID Sheet kho (tuỳ chọn — bỏ trống thì dùng ID mặc định hoặc đổi trong app).
   - `HOST_TARGET` = `quan-li-kho-vitot.onrender.com` (địa chỉ Render của chính service này — app dùng để hướng dẫn/kiểm tra DNS trong mục Kết nối tên miền).
   - `DISABLE_IP_LOCK` = `0` (chỉ đổi thành `1` khi cần lối thoát khẩn cấp của khoá IP — xem mục 6).
   
   (Không cần Persistent Disk — dữ liệu nằm trong Sheet.)
4. Bấm **Create / Deploy**. Render cấp sẵn tên miền dạng `https://quan-li-kho-vitot.onrender.com` kèm HTTPS tự động.
5. **Thêm tên miền riêng trong Render:** service → **Settings → Custom Domains → Add Custom Domain** → nhập `kho.xelientinh247.com` → Render sẽ hiển thị địa chỉ đích cần trỏ DNS (chính là `quan-li-kho-vitot.onrender.com`).
6. **Cấu hình DNS tại Cloudflare** — làm theo mục 4b ngay dưới đây.
7. Chờ DNS cập nhật (thường 5–30 phút): Render tự xác thực tên miền và cấp HTTPS cho `kho.xelientinh247.com`. Kiểm tra lại ngay trong app: **Cài đặt → Kết nối tên miền → Kiểm tra kết nối** phải báo **"Đã kết nối"**.
8. Lưu ý gói miễn phí: app **ngủ sau ~15 phút không có người dùng**, lần mở đầu chờ ~30–60 giây (dữ liệu không mất). Muốn chạy 24/7 thì nâng gói Starter.

### 4b. Cấu hình DNS tại Cloudflare cho `kho.xelientinh247.com`

**Bước 0 — hoàn tất việc thêm tên miền vào Cloudflare (làm 1 lần):** Cloudflare đang ở trạng thái **"Finish setup"** nghĩa là còn thiếu bước trỏ nameserver. Vào **TenTen** → quản trị tên miền `xelientinh247.com` → mục **Nameserver** → đổi sang đúng **2 nameserver Cloudflare cấp** (Cloudflare hiển thị trong màn hình Finish setup) → lưu. Đợi Cloudflare báo tên miền **Active** (vài phút đến vài giờ). Từ thời điểm này, DNS của tên miền do Cloudflare quản lí hoàn toàn.

**Bước 1 — thêm bản ghi CNAME:**

1. Vào [dash.cloudflare.com](https://dash.cloudflare.com) → chọn tên miền **`xelientinh247.com`** → menu **DNS → Records** → bấm **Add record**.
2. Điền:
   - **Type:** `CNAME`
   - **Name:** `kho` (tức là `kho.xelientinh247.com`)
   - **Target:** `quan-li-kho-vitot.onrender.com` (địa chỉ Render của app — thay bằng địa chỉ thật của service nếu khác; trong app, mục Cài đặt → Kết nối tên miền cũng hiển thị đúng giá trị này)
   - **Proxy status:** chọn **DNS only** (tắt biểu tượng đám mây màu cam thành màu xám) — xem ghi chú proxy bên dưới
   - **TTL:** `Auto` (mặc định)
3. Bấm **Save**.

**Bước 2 — những điều KHÔNG được làm:**

- **Không sửa/xoá các bản ghi có sẵn khác** (MX, TXT, A, CNAME của dịch vụ khác…) — xoá nhầm bản ghi MX là mất email theo tên miền.
- Không tạo thêm bản ghi A/AAAA cho cùng tên `kho` song song với CNAME (xung đột bản ghi).

**Ghi chú về Proxy status (đám mây cam):**

- **Lần đầu bắt buộc để DNS only** để Render xác thực quyền sở hữu tên miền và cấp chứng chỉ HTTPS suôn sẻ. Nếu để đám mây cam (Proxied) ngay từ đầu, Render thường không xác thực được và HTTPS không lên.
- Sau khi HTTPS đã chạy ổn: **Render khuyến nghị vẫn giữ DNS only**. Bật proxy nghĩa là Cloudflare đứng giữa người dùng và Render — Cloudflare tự cấp 1 lớp HTTPS riêng, còn chứng chỉ phía Render có thể không được tự gia hạn đúng cách, dễ phát sinh lỗi "quá nhiều chuyển hướng" hoặc lỗi chứng chỉ về lâu dài. Chỉ bật Proxied khi thật sự cần CDN/chống tấn công của Cloudflare và chấp nhận theo dõi chặt sau khi bật.
- Muốn dùng luôn **tên miền gốc `xelientinh247.com`** (không có `kho.`): Cloudflare hỗ trợ **CNAME Flattening** sẵn — tạo bản ghi **CNAME** với **Name = `@`** và **Target** như trên (vẫn để DNS only), Cloudflare sẽ tự làm phẳng thành bản ghi A ở gốc. Đồng thời phải thêm cả `xelientinh247.com` trong Render → Custom Domains. Khuyến nghị vẫn dùng `kho.xelientinh247.com` cho rõ ràng, tên miền gốc để làm trang giới thiệu/chuyển hướng sau.

**Bước 3 — kiểm tra:** đợi vài phút → mở app bằng tài khoản ADMIN → **Cài đặt → Kết nối tên miền** (đã khai báo sẵn `kho.xelientinh247.com`) → bấm **Kiểm tra kết nối**: app tra DNS thật qua DNS-over-HTTPS và báo 1 trong 3 trạng thái — **Đã kết nối** / **Chưa trỏ đúng** (kèm giá trị DNS hiện tại đọc được để đối chiếu) / **Chưa cấu hình**. Cũng có thể kiểm tra nhanh bằng cách mở thẳng `https://kho.xelientinh247.com` trên điện thoại.

### 4c. Railway

1. Vào [railway.app](https://railway.app) → **New Project → Deploy from GitHub repo** → chọn repo.
2. Railway tự nhận diện Node: **Start Command** đặt `node server.js` (Settings → Deploy). Cổng: app tự đọc biến `PORT` Railway cấp.
3. Vào **Variables** → thêm `GOOGLE_SERVICE_ACCOUNT_JSON` = toàn bộ nội dung file JSON. (Không cần Volume nữa — dữ liệu nằm trong Sheet.)
4. **Gắn tên miền riêng:** service → **Settings → Networking → Custom Domain** → nhập `kho.xelientinh247.com` → tại DNS thêm bản ghi Railway yêu cầu:
   - **CNAME** — Tên/Host: `kho` → Giá trị: giá trị Railway cung cấp (dạng `xxxx.up.railway.app`).
   
   HTTPS được cấp tự động sau khi DNS trỏ đúng.

### 4d. VPS (chủ động nhất, chạy 24/7)

Yêu cầu: VPS Linux (Ubuntu) đã cài **Node.js ≥ 20**, có tên miền trỏ về.

```bash
# 1) Cài PM2
npm install -g pm2

# 2) Copy mã nguồn + file JSON tài khoản dịch vụ lên VPS, rồi chạy:
cd quan-li-kho-vitot-standalone
GOOGLE_APPLICATION_CREDENTIALS=/etc/vitot/sa.json PORT=3000 pm2 start server.js --name kho-vitot
pm2 save
pm2 startup   # làm theo dòng lệnh in ra để app tự chạy khi VPS reboot
```

Nginx reverse proxy (file `/etc/nginx/sites-available/kho`):

```nginx
server {
    listen 80;
    server_name kho.xelientinh247.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/kho /etc/nginx/sites-enabled/kho
nginx -t && systemctl reload nginx
```

**DNS:** thêm bản ghi **A** — Tên/Host: `kho` → Giá trị: **IP công cộng của VPS**.

**HTTPS miễn phí (Let's Encrypt):**

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d kho.xelientinh247.com
```

---

## 5. Vận hành hằng ngày (tóm tắt)

| Việc | Ai làm | Ở đâu |
|---|---|---|
| Đổi PIN, sửa tên của mình | Mọi người | Cài đặt → Tài khoản của tôi (app ghi ngược về tab `CẤU_HÌNH`) |
| Thêm nhân viên / cấp PIN / tạo chức vụ & phân quyền | ADMIN | Cài đặt → Nhân sự & mã PIN / Chức vụ & phân quyền (nhân viên ghi về `CẤU_HÌNH`, chức vụ lưu ở `APP_CAI_DAT`) |
| Đặt kho mặc định (chọn sẵn cho mọi form Nhập/Xuất/Kiểm/Chế biến/Đối soát + Tra cứu tồn kho) | ADMIN | Cài đặt → Kho mặc định (lưu ở `APP_CAI_DAT`, khoá `default_warehouse`; lần đầu mặc định "Hà Nội - 263 Hoàng Văn Thái, Thanh Xuân") |
| Đồng bộ lại dữ liệu từ Sheet (sau khi POS đổ dữ liệu mới hoặc có sửa tay trong Sheet) | ADMIN | Cài đặt → Kết nối Google Sheet → Đồng bộ lại, hoặc nút "Làm mới từ Sheet" ở màn Tra cứu tồn kho. Đồng bộ xong app **bật thông báo** kèm số sản phẩm + giờ hoàn tất (lỗi thì báo rõ lý do) |
| Tạo phiếu nhập / xuất / kiểm kho / chế biến / đối soát | Mọi người (theo phân quyền) | Các màn tương ứng trong app — phiếu tạo xong **ghi thẳng xuống Sheet, không cần quản lí xác nhận**. Nếu ghi lỗi, phiếu hiện trạng thái "Ghi lỗi" ở Lịch sử phiếu, bấm **Ghi lại** để thử lại |
| Lọc & đối chiếu phiếu | Mọi người (theo phân quyền) | Lịch sử phiếu: lọc kết hợp **Loại phiếu + Thời gian + Trạng thái ghi Sheet**, có nút Xoá bộ lọc |
| Sửa danh sách phân loại xuất kho | ADMIN | Cài đặt → Phân loại xuất kho (thêm / đổi tên / xoá) — phiếu đã lưu giữ nguyên nhãn cũ |
| Xem Dashboard theo kỳ | ADMIN | Dashboard: bộ lọc **Hôm nay / Hôm qua / 7 ngày / 30 ngày / Tháng này / Tuỳ chọn**, gồm thẻ Đơn đã đối soát, Đơn quét trùng và panel Hiệu suất chế biến (Bán được / Hỏng-Hủy / Hao hụt) |
| Theo dõi hàng về + sự kiện | Mọi người | Màn **Lịch**: phiếu nhập có "Ngày về dự kiến" tự hiện (nhãn Hàng về); bấm vào ngày hoặc nút ở panel ngày để thêm **sự kiện** — chỉ người tạo sự kiện hoặc ADMIN sửa/xoá được |
| Khai báo / kiểm tra tên miền `kho.xelientinh247.com` | ADMIN | Cài đặt → Kết nối tên miền (hướng dẫn DNS Cloudflare ngay trong mục; DNS sửa ở Cloudflare, không sửa ở TenTen) |
| Sao lưu dữ liệu | ADMIN | Trong Google Sheet: File → Tạo bản sao / Lịch sử phiên bản |

Mọi phiếu đều tự ghi **ngày giờ máy chủ (giờ Việt Nam)** và **tên người tạo theo tài khoản đăng nhập** — nhân viên không sửa được 2 thông tin này. Phiếu Kiểm kho là **kiểm mù**: nhân viên chỉ thấy tên sản phẩm và nhập số đếm thực tế; tồn hệ thống và chênh lệch chỉ ADMIN mới xem được trong Lịch sử phiếu (dữ liệu chênh lệch vẫn được ghi đầy đủ vào tab `KIỂM_KHO` trên Sheet).

---

## 6. Tuỳ chọn: chỉ cho phép dùng app trong mạng công ty (khoá IP)

Tính năng **tuỳ chọn, mặc định TẮT**. Khi bật, app chỉ truy cập được từ các địa chỉ IP công cộng nằm trong danh sách cho phép (thường là IP mạng internet tại công ty). Người ở ngoài nhận trang thông báo "Ứng dụng chỉ hoạt động trong mạng công ty" (HTTP 403) — không thấy form đăng nhập, không lộ dữ liệu. Kiểm tra IP do **máy chủ** thực hiện trên mọi request. Cài đặt khoá IP được lưu trong tab `APP_CAI_DAT` của Sheet nên không mất khi app khởi động lại/chuyển hosting.

**Cách bật (làm ngay tại công ty):**

1. Đăng nhập ADMIN tại công ty → **Cài đặt → Mạng công ty (tuỳ chọn)**.
2. Bấm **"Dùng IP hiện tại của tôi"** để thêm đúng IP công cộng mà máy chủ nhìn thấy (có thể thêm nhiều IP/dải CIDR, ví dụ `113.190.10.0/24`).
3. Tích **"Chỉ cho phép dùng app trong mạng công ty"** → **Lưu cài đặt mạng**.

Để chống tự khoá chính mình, app **từ chối bật** nếu IP hiện tại của ADMIN chưa có trong danh sách.

**Lưu ý IP động:** IP công cộng của công ty **có thể thay đổi** khi modem/router khởi động lại. Khuyến nghị đăng ký **IP tĩnh** với nhà mạng; nếu bị khoá ngoài sau khi mất điện, dùng lối thoát khẩn cấp bên dưới rồi cập nhật lại danh sách IP.

**Cách máy chủ xác định IP người dùng:** khi chạy sau proxy (Render/Railway/Nginx), IP thật lấy từ **IP đầu tiên trong header `X-Forwarded-For`**; không có header này thì lấy địa chỉ socket trực tiếp. Tiền tố IPv6-mapped (`::ffff:`) được tự động loại bỏ.

**Lối thoát khẩn cấp (khi ADMIN bị khoá ở ngoài):**

- **Cách 1 — biến môi trường:** đặt `DISABLE_IP_LOCK=1` rồi khởi động lại app (Render/Railway: mục Environment; VPS/PM2: `DISABLE_IP_LOCK=1 pm2 restart kho-vitot --update-env`). Khoá bị vô hiệu hoá cho tới khi bỏ biến này.
- **Cách 2 — sửa trong Sheet:** mở tab `APP_CAI_DAT`, tìm dòng khoá `ip_lock`, sửa giá trị thành `{"enabled": false, "allow": []}` rồi khởi động lại app.
