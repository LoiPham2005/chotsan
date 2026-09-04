"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Vẽ mã QR NGAY TRONG TRÌNH DUYỆT.
 *
 * ---
 * ĐỪNG BAO GIỜ THAY BẰNG DỊCH VỤ SINH ẢNH QR
 *
 * `img.vietqr.io`, `api.qrserver.com` và tương tự nhận dữ liệu qua URL. Với QR
 * chuyển khoản, dữ liệu đó gồm **số tài khoản, tên chủ tài khoản và số tiền của
 * chủ sân** — toàn bộ đi qua máy chủ bên thứ ba và nằm lại trong log truy cập
 * của họ, vĩnh viễn.
 *
 * Ở đây chuỗi EMVCo dựng tại máy chủ của ta (`src/lib/vietqr.ts`), trình duyệt
 * tự vẽ. Không có ai ở giữa. Cùng lý do với QR của 2FA — xem GOTCHAS #9.
 */
export function MaQr({ payload, size = 220 }: { payload: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [loi, setLoi] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Nạp động: thư viện QR chỉ cần ở màn thanh toán, không phải trong bundle
    // của mọi lần mở trang.
    void import("qrcode")
      .then(({ default: QRCode }) =>
        QRCode.toCanvas(canvas, payload, { width: size, margin: 1, errorCorrectionLevel: "M" }),
      )
      .catch(() => setLoi(true));
  }, [payload, size]);

  if (loi) {
    // Thà nói không vẽ được còn hơn để một ô trắng — khách sẽ ngồi chờ một mã
    // không bao giờ hiện ra.
    return (
      <p className="text-sm text-danger">
        Không vẽ được mã QR. Chuyển khoản thủ công theo thông tin bên dưới giúp bạn nhé.
      </p>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded-token-md border border-line bg-white"
      aria-label="Mã QR chuyển khoản"
      role="img"
    />
  );
}
