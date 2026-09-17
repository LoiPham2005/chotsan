"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { holdBookingAction, type HoldBookingState } from "@/app/(public)/venues/[slug]/actions";
import {
  keepFreeSlots,
  SlotGrid,
  slotKey,
  type GridAxis,
  type PickedSlot,
} from "@/components/booking/slot-grid";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { encodeSelection, formatHhMm, formatVnd, SLOT_MINUTES, slotsToRanges } from "@/lib/slots";
import type { DayAvailability } from "@/services/availability.service";

/**
 * Lưới chọn khung giờ + danh sách đã chọn + tạm tính + nút đặt — theo kiểu v1.
 *
 * ---
 * CHỌN TỰ DO: BẤM Ô NÀO BẬT/TẮT Ô ĐÓ
 *
 * Nhiều sân, nhiều khung rời nhau đều được. Nhóm 8 người thuê hai sân cùng
 * giờ là chuyện hằng ngày; bắt họ đặt từng sân một là hai lần thanh toán và
 * hai lần lo "sân kia có bị người khác lấy mất không".
 *
 * Máy chủ tự gom các ô thành từng lượt đặt (một sân + một dãy giờ liền) — xem
 * `slotsToRanges`. Giao diện hiện trước sẽ ra mấy lượt, để không ai bất ngờ.
 *
 * ---
 * GIÁ Ở ĐÂY LÀ GIÁ TẠM
 *
 * Cộng từ dữ liệu lưới mà trình duyệt đang giữ, có thể đã cũ vài phút. Số tiền
 * THẬT do `bookingService.hold()` tính lại ở máy chủ, và form KHÔNG gửi số tiền.
 *
 * ---
 * LỰA CHỌN ĐI THEO QUA BƯỚC ĐĂNG NHẬP
 *
 * Khách chưa đăng nhập chọn ô rồi bấm đặt → sang trang đăng nhập → quay lại.
 * Các ô đã chọn được gói vào `?chon=` của đường quay lại (`encodeSelection`),
 * trang đọc ra thành `initialSelection`, và lưới dựng lại đúng như lúc rời đi.
 *
 * KHÔNG tự bấm đặt thay khách: giữ chỗ là bắt đầu đếm ngược 10 phút thanh
 * toán, và giá có thể đã đổi trong lúc họ đăng nhập. Việc của trang là đưa họ
 * về đúng chỗ, sát cạnh nút đặt — bấm hay không là quyết định của họ.
 */
export function SelectAndBook({
  day,
  venueId,
  date,
  nguoiDung,
  duongDanHienTai,
  initialSelection = [],
}: {
  day: DayAvailability;
  venueId: string;
  date: string;
  /** `null` = chưa đăng nhập. */
  nguoiDung: { ten: string; soDienThoai: string | null } | null;
  duongDanHienTai: string;
  /** Lựa chọn mang về từ trang đăng nhập (`?chon=`), CHƯA kiểm còn trống hay không. */
  initialSelection?: readonly { courtId: string; minute: number }[];
}) {
  // Chụp MỘT LẦN lúc dựng. Ô nào đã bị người khác đặt trong lúc khách đăng
  // nhập thì rơi ra ở đây, và được báo ngay bên dưới.
  const [restored] = useState(() => keepFreeSlots(day, initialSelection));
  const [picked, setPicked] = useState<Record<string, PickedSlot>>(restored);
  const [axis, setAxis] = useState<GridAxis>("court-rows");
  const [state, formAction] = useActionState<HoldBookingState, FormData>(holdBookingAction, {});
  const formRef = useRef<HTMLFormElement>(null);

  const restoredCount = Object.keys(restored).length;
  const droppedCount = initialSelection.length - restoredCount;

  const courtName = useMemo(
    () => new Map(day.courts.map((court) => [court.courtId, court.courtName])),
    [day.courts],
  );
  const courtOrder = useMemo(
    () => new Map(day.courts.map((court, index) => [court.courtId, index])),
    [day.courts],
  );

  const list = useMemo(
    () =>
      Object.values(picked).sort(
        (a, b) =>
          (courtOrder.get(a.courtId) ?? 0) - (courtOrder.get(b.courtId) ?? 0) ||
          a.minute - b.minute,
      ),
    [picked, courtOrder],
  );

  const selectedKeys = useMemo(() => new Set(Object.keys(picked)), [picked]);
  const total = list.reduce((sum, item) => sum + item.price, 0);
  const ranges = useMemo(() => slotsToRanges(list), [list]);
  const hasSelection = list.length > 0;

  /*
   * Vừa quay về từ trang đăng nhập với lựa chọn cũ.
   *
   * 1. Gỡ `chon` khỏi thanh địa chỉ. Nếu để lại, đặt xong bấm Quay lại (hay tải
   *    lại trang) sẽ "hồi sinh" đúng những ô vừa thành lượt đặt của chính mình.
   * 2. Cuộn tới khối đặt sân: việc còn lại chỉ là bấm nút, không bắt khách dò
   *    xuống tìm.
   *
   * Chỉ chạy lúc dựng — đây là một sự kiện "vừa tới", không phải phản ứng theo
   * thay đổi nào.
   */
  useEffect(() => {
    if (initialSelection.length === 0) return;

    const url = new URL(window.location.href);
    if (url.searchParams.has("chon")) {
      url.searchParams.delete("chon");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }

    if (nguoiDung === null || restoredCount === 0) return;

    // Nhịp sau: App Router cuộn trang mới lên đầu ở pha layout; cuộn ngay bây
    // giờ có thể bị chính lần cuộn đó đè mất.
    const frame = requestAnimationFrame(() => {
      formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(courtId: string, minute: number) {
    const key = slotKey(courtId, minute);

    setPicked((prev) => {
      if (prev[key]) {
        const next = { ...prev };
        delete next[key];
        return next;
      }

      const found = keepFreeSlots(day, [{ courtId, minute }])[key];
      return found ? { ...prev, [key]: found } : prev;
    });
  }

  // Đường quay lại sau đăng nhập/đăng ký: đúng sân, đúng ngày, đúng các ô.
  const returnPath = hasSelection
    ? `${duongDanHienTai}${duongDanHienTai.includes("?") ? "&" : "?"}chon=${encodeSelection(list)}`
    : duongDanHienTai;

  return (
    <>
      <SlotGrid
        day={day}
        selected={selectedKeys}
        onToggle={toggle}
        axis={axis}
        onAxisChange={setAxis}
      />

      <form
        ref={formRef}
        action={formAction}
        id="dat-san"
        className="mt-4 scroll-mt-24 overflow-hidden rounded-token-lg border border-line bg-surface shadow-nang-1"
      >
        <input type="hidden" name="venueId" value={venueId} />
        <input type="hidden" name="date" value={date} />
        <input
          type="hidden"
          name="slots"
          value={JSON.stringify(list.map(({ courtId, minute }) => ({ courtId, minute })))}
        />

        {nguoiDung !== null && restoredCount > 0 && hasSelection && (
          <div
            role="status"
            className="flex items-start gap-2.5 border-b border-brand-line bg-brand-tint px-4 py-3"
          >
            <span
              aria-hidden
              className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-white"
            >
              <svg viewBox="0 0 16 16" fill="none" className="h-3 w-3">
                <path
                  d="m3.5 8.5 3 3 6-7"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <p className="text-sm text-content">
              <strong className="font-semibold">
                Đã giữ nguyên {restoredCount} khung bạn chọn.
              </strong>{" "}
              <span className="text-muted">Kiểm tra lại rồi bấm đặt sân bên dưới.</span>
            </p>
          </div>
        )}

        {droppedCount > 0 && (
          <p
            role="status"
            className="border-b border-peak-line bg-peak-tint px-4 py-3 text-sm text-peak-text"
          >
            {droppedCount} khung bạn chọn trước đó không còn trống nên đã được bỏ ra.
          </p>
        )}

        {hasSelection && (
          <div className="border-b border-line bg-elevated/50 px-4 py-3">
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-wide text-subtle">
                Đã chọn ({list.length} khung · {ranges.length} lượt đặt)
              </p>
              <button
                type="button"
                onClick={() => setPicked({})}
                className="text-xs font-semibold text-muted hover:text-danger"
              >
                Bỏ chọn tất cả
              </button>
            </div>

            <ul className="flex flex-wrap gap-2">
              {list.map((item) => (
                <li key={slotKey(item.courtId, item.minute)}>
                  <button
                    type="button"
                    onClick={() => toggle(item.courtId, item.minute)}
                    aria-label={`Bỏ ${courtName.get(item.courtId)} ${formatHhMm(item.minute)}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-brand-tint px-3 py-1 text-xs font-semibold text-brand-hover ring-1 ring-brand-line transition hover:bg-emerald-100"
                  >
                    {courtName.get(item.courtId)} · {formatHhMm(item.minute)}–
                    {formatHhMm(item.minute + SLOT_MINUTES)}
                    <span aria-hidden className="text-sm leading-none">
                      ×
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {ranges.length > 1 && (
              <p className="mt-2 text-xs text-muted">
                Các khung khác sân hoặc không liền nhau được tách thành {ranges.length} lượt đặt,
                mỗi lượt một mã. Nếu một lượt không giữ được, cả lần đặt này được huỷ để bạn không
                bị giữ dở một nửa.
              </p>
            )}
          </div>
        )}

        <div className="p-4">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm text-muted">
                Tạm tính {hasSelection ? `(${list.length} khung × 30 phút)` : ""}
              </p>
              {!hasSelection && (
                <p className="text-xs text-subtle">
                  Bấm vào ô còn trống để chọn — chọn được nhiều ô
                </p>
              )}
            </div>
            <p className="text-2xl font-bold tabular-nums text-brand">{formatVnd(total)}</p>
          </div>

          {state.error && (
            <p role="alert" className="alert alert-danger mt-3">
              {state.error}
            </p>
          )}

          {/*
            CHƯA ĐĂNG NHẬP THÌ DẪN TỚI ĐĂNG NHẬP, KHÔNG HỎI TÊN VÀ SỐ.

            Lượt đặt không gắn tài khoản mang `userId: null`: nó không bao giờ
            hiện ở "Lượt đặt của tôi" và khách không tự huỷ được.
          */}
          {nguoiDung === null ? (
            <div className="mt-4">
              <Button asChild size="lg" className="w-full shadow-chon">
                <Link href={`/login?next=${encodeURIComponent(returnPath)}`}>
                  Đăng nhập để đặt sân
                </Link>
              </Button>
              <p className="mt-2 text-center text-xs text-muted">
                {hasSelection
                  ? "Các khung đang chọn được giữ nguyên sau khi đăng nhập. "
                  : "Có tài khoản thì xem lại và huỷ lượt đặt bất cứ lúc nào. "}
                <Link
                  href={`/register?next=${encodeURIComponent(returnPath)}`}
                  className="font-medium text-brand hover:underline"
                >
                  Chưa có tài khoản? Đăng ký
                </Link>
              </p>
            </div>
          ) : (
            <>
              {/* Hồ sơ đã có số thì KHÔNG hỏi lại. */}
              {nguoiDung.soDienThoai === null && hasSelection && (
                <div className="mt-4">
                  <label htmlFor="customerPhone" className="mb-1 block text-sm text-muted">
                    Số điện thoại để sân gọi khi có việc
                  </label>
                  <Input
                    id="customerPhone"
                    name="customerPhone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="0987654321"
                    required
                    autoComplete="tel"
                    aria-describedby={state.fields?.customerPhone ? "loi-sdt" : undefined}
                  />
                  {state.fields?.customerPhone && (
                    <p id="loi-sdt" className="mt-1 text-xs text-danger">
                      {state.fields.customerPhone[0]}
                    </p>
                  )}
                </div>
              )}

              <SubmitBookingButton disabled={!hasSelection} />

              <p className="mt-2 text-center text-xs text-muted">
                Đặt với tên <strong>{nguoiDung.ten}</strong>
                {nguoiDung.soDienThoai && ` · ${nguoiDung.soDienThoai}`}. Chỗ được giữ 10 phút, chưa
                trừ tiền ở bước này.
              </p>
            </>
          )}
        </div>
      </form>

      {/*
        Thanh nhỏ dính đáy trên điện thoại: lưới dài hơn màn hình, người dùng
        chọn xong không phải cuộn đi tìm nút đặt — và vẫn thấy tổng tiền.
      */}
      {hasSelection && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-line bg-surface/95 px-4 py-2.5 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur sm:hidden">
          <p className="text-sm">
            <span className="font-semibold text-content">{list.length} khung</span>
            <span className="ml-2 font-bold text-brand">{formatVnd(total)}</span>
          </p>
          <Button asChild size="sm">
            <a href="#dat-san">Tiếp tục ↓</a>
          </Button>
        </div>
      )}
      {hasSelection && <div className="h-16 sm:hidden" aria-hidden />}
    </>
  );
}

/**
 * Nút gửi tách riêng vì `useFormStatus` chỉ đọc được trạng thái khi nó nằm
 * TRONG `<form>` — gọi ở component chứa form thì luôn trả `pending: false`.
 */
function SubmitBookingButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <Button
      type="submit"
      size="lg"
      disabled={pending || disabled}
      className="mt-4 w-full shadow-chon"
    >
      {pending
        ? "Đang giữ chỗ…"
        : disabled
          ? "Chọn ít nhất 1 ô để đặt sân"
          : "Đặt sân và thanh toán"}
    </Button>
  );
}
