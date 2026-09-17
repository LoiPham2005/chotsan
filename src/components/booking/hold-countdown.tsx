"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Đếm ngược thời gian giữ chỗ.
 *
 * ---
 * MỐC HẾT HẠN VÀ "BÂY GIỜ" ĐỀU LẤY TỪ MÁY CHỦ
 *
 * Component nhận mốc hết hạn tuyệt đối (ISO) chứ không tự tính "10 phút kể từ
 * lúc mở trang". Nhưng trừ mốc đó cho `Date.now()` của MÁY KHÁCH thì đồng hồ
 * điện thoại nhanh 3 phút là khách thấy hết giờ khi chỗ vẫn còn giữ — bản trước
 * còn tải lại trang mỗi giây vì trang tải về vẫn "chưa hết hạn". Nên nhận thêm
 * `serverNowIso` và đo độ lệch MỘT lần lúc gắn vào trang: đồng hồ máy khách sai
 * bao nhiêu cũng không đổi con số đếm.
 *
 * ---
 * HẾT GIỜ: LÀM MỚI TỐI ĐA MỘT LẦN
 *
 * Trạng thái thật nằm ở máy chủ (cron có thể đã nhả chỗ, chủ sân vừa duyệt),
 * nên về 0 thì xin trang mới — nhưng CHỈ MỘT LẦN cho mỗi mốc hết hạn. Trang mới
 * vẫn nói "còn hạn" (lệch vài giây) thì đứng yên ở dòng "Đã hết thời gian giữ
 * chỗ", không tải lại vòng vòng.
 */
export function HoldCountdown({
  expiresAtIso,
  serverNowIso,
}: {
  expiresAtIso: string;
  /** "Bây giờ" của máy chủ lúc dựng trang — để bù lệch đồng hồ của máy khách. */
  serverNowIso: string;
}) {
  const router = useRouter();
  const routerRef = useRef(router);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const refreshedFor = useRef<string | null>(null);

  useEffect(() => {
    routerRef.current = router;
  }, [router]);

  // CHỈ chạy lại khi mốc từ máy chủ đổi. Độ lệch đo lại vào lúc khác (vd khi đối
  // tượng router đổi) là đo bằng một `Date.now()` muộn hơn — đồng hồ nhảy ngược
  // về con số lúc mở trang.
  useEffect(() => {
    const skew = new Date(serverNowIso).getTime() - Date.now();
    const expiresAt = new Date(expiresAtIso).getTime();

    const tick = () => {
      const seconds = Math.max(0, Math.round((expiresAt - (Date.now() + skew)) / 1000));
      setSecondsLeft(seconds);

      if (seconds === 0) {
        clearInterval(timer);
        if (refreshedFor.current !== expiresAtIso) {
          refreshedFor.current = expiresAtIso;
          routerRef.current.refresh();
        }
      }
    };

    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
  }, [expiresAtIso, serverNowIso]);

  if (secondsLeft === 0) {
    return (
      <p
        role="status"
        className="mt-5 rounded-token-md border border-danger-line bg-danger-tint px-4 py-3 text-sm font-semibold text-danger-text"
      >
        Đã hết thời gian giữ chỗ
      </p>
    );
  }

  const almostOver = secondsLeft !== null && secondsLeft <= 120;

  return (
    <p className="mt-5 rounded-token-md border border-line bg-surface px-4 py-3 text-sm">
      Chỗ được giữ thêm{" "}
      {/* Lần dựng đầu ở máy chủ chưa đo được lệch đồng hồ. Trả khoảng giữ chỗ
          thay vì một con số — số ở máy chủ và ở trình duyệt sẽ khác nhau, và
          React báo lỗi hydration. */}
      {secondsLeft === null ? (
        <span className="tabular-nums text-muted">--:--</span>
      ) : (
        <span
          className={`tabular-nums font-semibold ${almostOver ? "text-danger-text" : "text-content"}`}
          aria-live={almostOver ? "polite" : "off"}
        >
          {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
        </span>
      )}
      . Hết giờ mà chưa chuyển khoản thì chỗ được nhả cho người khác.
    </p>
  );
}
