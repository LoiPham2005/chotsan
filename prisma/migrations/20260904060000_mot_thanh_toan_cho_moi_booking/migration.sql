-- Mỗi lượt đặt chỉ có ĐÚNG MỘT giao dịch đang chờ tại một thời điểm.
--
-- Khách bấm "Chốt sân" hai lần (mạng chậm, bấm lại) sẽ tạo hai giao dịch cho
-- cùng một booking, và cả hai đều mở được trang thanh toán. Trả cả hai là mất
-- tiền của khách; trả một là khách khiếu nại. Chặn ở database vì hai request
-- song song đều thấy "chưa có giao dịch nào" nếu chỉ kiểm trong service.
--
-- Partial index: giao dịch đã xong/huỷ/lỗi thì được phép có nhiều — khách đổi
-- từ VNPay sang MoMo là chuyện bình thường.
CREATE UNIQUE INDEX "payments_mot_giao_dich_cho_moi_booking"
  ON "payments" ("booking_id")
  WHERE status = 'PENDING';
