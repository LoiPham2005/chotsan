"use client";

import { useEffect, useState } from "react";

/**
 * Đếm ngược thời gian giữ chỗ.
 *
 * ---
 * MỐC HẾT HẠN TÍNH Ở MÁY CHỦ, KHÔNG PHẢI Ở ĐÂY
 *
 * Component nhận một mốc tuyệt đối (ISO) và chỉ trừ đi. Nếu tính bằng
 * "10 phút kể từ lúc mở trang" thì đồng hồ máy khách lệch bao nhiêu, hạn giữ
 * chỗ sai bấy nhiêu — và khách thấy còn 3 phút trong khi máy chủ đã nhả chỗ.
 *
 * Hết giờ thì TỰ TẢI LẠI trang, không tự đổi giao diện tại chỗ: trạng thái
 * thật nằm ở database (cron có thể đã đổi sang `EXPIRED`, hoặc chủ sân vừa
 * duyệt xong), và đoán mò trạng thái đó ở trình duyệt là cách chắc chắn để
 * hiện sai.
 */
export function DemNguocGiuCho({ hetHanIso }: { hetHanIso: string }) {
  const [conLai, setConLai] = useState<number | null>(null);

  useEffect(() => {
    const hetHan = new Date(hetHanIso).getTime();

    const tick = () => {
      const giay = Math.max(0, Math.round((hetHan - Date.now()) / 1000));
      setConLai(giay);
      if (giay === 0) window.location.reload();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [hetHanIso]);

  // Lần dựng đầu ở máy chủ chưa có `Date.now()` của máy khách. Trả khoảng trống
  // giữ chỗ thay vì một con số — số ở máy chủ và ở trình duyệt sẽ khác nhau, và
  // React báo lỗi hydration.
  if (conLai === null) return <span className="tabular-nums text-muted">--:--</span>;

  const phut = Math.floor(conLai / 60);
  const giay = conLai % 60;
  const sapHet = conLai <= 120;

  return (
    <span
      className={`tabular-nums font-semibold ${sapHet ? "text-danger" : "text-content"}`}
      aria-live={sapHet ? "polite" : "off"}
    >
      {phut}:{String(giay).padStart(2, "0")}
    </span>
  );
}
