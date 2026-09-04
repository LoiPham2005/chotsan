-- Mở rộng ràng buộc "một giao dịch đang chờ cho mỗi lượt đặt".
--
-- Bản cũ chỉ chặn status = 'PENDING'. Nhưng chuyển khoản tay có thêm một trạng
-- thái sống nữa: 'AWAITING_CONFIRMATION' (khách đã khai đã chuyển, chờ chủ sân
-- duyệt). Khách khai xong rồi sốt ruột bấm trả bằng VNPay sẽ tạo thêm một giao
-- dịch PENDING — lúc đó chủ sân duyệt tay và cổng báo về là THU TIỀN HAI LẦN
-- cho cùng một lượt đặt.
--
-- Vẫn là partial index: giao dịch đã xong/huỷ/lỗi thì được phép có nhiều, vì
-- khách đổi từ VNPay sang MoMo là chuyện bình thường.
DROP INDEX IF EXISTS "payments_mot_giao_dich_cho_moi_booking";

CREATE UNIQUE INDEX "payments_mot_giao_dich_song_cho_moi_booking"
  ON "payments" ("booking_id")
  WHERE status IN ('PENDING', 'AWAITING_CONFIRMATION');
