"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * Thanh tiến trình mảnh chạy ở mép trên khi chuyển trang.
 *
 * ---
 * VÌ SAO KHÔNG DÙNG `loading.tsx`
 *
 * `loading.tsx` thay TOÀN BỘ nội dung bằng một khối "đang tải". Người dùng bấm
 * một link rồi thấy trang mình đang đọc biến mất, thay bằng ô trống — mất chỗ
 * đứng, và nếu mạng nhanh thì khối đó chớp lên rồi tắt, còn khó chịu hơn.
 *
 * Ở đây trang cũ ĐỨNG NGUYÊN cho tới khi trang mới sẵn sàng, chỉ có một sợi
 * chỉ chạy ở mép trên báo "đang xử lý". Đây là cách GitHub, YouTube và hầu hết
 * app dùng nhiều — nó nói đủ mà không cướp mất thứ đang đọc.
 *
 * ---
 * CÁCH BIẾT LÚC NÀO BẮT ĐẦU VÀ LÚC NÀO XONG
 *
 * App Router không phát sự kiện điều hướng nào để nghe. Nên:
 *
 *   BẮT ĐẦU — bắt sự kiện `click` ở pha capture trên mọi thẻ `<a>` nội bộ, và
 *             vá `history.pushState` để bắt cả `router.push()` gọi từ code.
 *   XONG    — `usePathname()`/`useSearchParams()` đổi giá trị nghĩa là React đã
 *             dựng xong trang mới.
 *
 * Thanh chạy tới 90% rồi CHỜ. Không bao giờ đoán phần còn lại: chạy tới 100%
 * trước khi trang sẵn sàng là nói dối, và người dùng sẽ học được rằng thanh
 * này vô nghĩa.
 */
export function TopProgressBar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [percent, setPercent] = useState(0);
  const [running, setRunning] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function cleanup() {
      if (timerRef.current) clearInterval(timerRef.current);
      if (hideRef.current) clearTimeout(hideRef.current);
      timerRef.current = null;
      hideRef.current = null;
    }

    function start() {
      cleanup();
      setRunning(true);
      setPercent(12);

      /*
       * Tiến CHẬM DẦN về 90 rồi dừng.
       *
       * Bước nhảy nhỏ dần theo quãng còn lại, nên thanh không bao giờ chạm 90 —
       * nó luôn còn "đang chạy" cho tới khi trang thật sự xong. Nếu chạy đều
       * rồi đứng im ở một chỗ, người dùng sẽ tưởng trang treo.
       */
      timerRef.current = setInterval(() => {
        setPercent((truoc) => (truoc >= 90 ? truoc : truoc + Math.max(0.6, (90 - truoc) * 0.08)));
      }, 180);
    }

    function onDocumentClick(event: MouseEvent) {
      // Bấm kèm Ctrl/Cmd/Shift là mở tab mới — trang này không đi đâu cả.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const link = (event.target as HTMLElement | null)?.closest?.("a");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download") || link.getAttribute("href")?.startsWith("#")) return;

      const target = new URL(link.href, window.location.href);
      if (target.origin !== window.location.origin) return;
      // Cùng hệt trang đang đứng thì không có gì để chờ.
      if (
        target.pathname === window.location.pathname &&
        target.search === window.location.search
      ) {
        return;
      }

      start();
    }

    document.addEventListener("click", onDocumentClick, true);

    // `router.push()` không sinh sự kiện click. Vá `pushState` để bắt được nó.
    const originalPushState = history.pushState.bind(history);
    history.pushState = function (...args: Parameters<typeof history.pushState>) {
      start();
      return originalPushState(...args);
    };

    return () => {
      document.removeEventListener("click", onDocumentClick, true);
      history.pushState = originalPushState;
      cleanup();
    };
  }, []);

  // Đường dẫn đổi = React đã dựng xong trang mới. Kéo nốt về 100 rồi tắt.
  useEffect(() => {
    if (!running) return;

    if (timerRef.current) clearInterval(timerRef.current);

    /*
     * Đặt 100% ở NHỊP SAU, không phải ngay trong thân effect.
     *
     * Hai lý do, một kỹ thuật một thị giác. Kỹ thuật: `setState` đồng bộ trong
     * effect làm React dựng lại trước khi trình duyệt kịp vẽ — render dây
     * chuyền. Thị giác: nếu đặt 100% trong cùng khung hình với lần vẽ đầu,
     * trình duyệt gộp hai giá trị làm một và `transition` không chạy — thanh
     * NHẢY tới cuối thay vì trượt tới, mất hẳn cảm giác "vừa xong".
     */
    const raf = requestAnimationFrame(() => {
      setPercent(100);
      hideRef.current = setTimeout(() => {
        setRunning(false);
        setPercent(0);
      }, 320);
    });

    return () => {
      cancelAnimationFrame(raf);
      if (hideRef.current) clearTimeout(hideRef.current);
    };
    // `running` cố tình KHÔNG nằm trong danh sách phụ thuộc: thêm vào thì hiệu
    // ứng chạy lại ngay khi chính nó vừa đặt `false`, và thanh nhấp nháy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  return (
    <div
      // Không phải `role="progressbar"`: giá trị ở đây là ƯỚC LƯỢNG, không phải
      // tiến độ thật. Đọc "12 phần trăm" cho người dùng trình đọc màn hình là
      // nói sai. Trạng thái thật được báo bằng `aria-busy` trên trang.
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5"
    >
      <div
        className="h-full bg-gradient-to-r from-brand via-emerald-400 to-brand shadow-[0_0_10px_rgba(16,185,129,0.7)] transition-[width,opacity] duration-200 ease-out"
        style={{
          width: `${percent}%`,
          opacity: running ? 1 : 0,
        }}
      />
    </div>
  );
}
