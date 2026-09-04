"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatHhMm, formatVndShort, SLOT_MINUTES } from "@/lib/slots";
import type { DayAvailability, SlotStatus } from "@/services/availability.service";

/**
 * Lưới SÂN × KHUNG 30 PHÚT — thành phần đắt nhất của sản phẩm.
 *
 * ---
 * VÌ SAO LÀ LƯỚI, KHÔNG PHẢI CHỌN TỪNG SÂN RỒI XEM GIỜ
 *
 * Người ta hỏi *"19h còn sân nào?"*, không hỏi *"sân 7 có rảnh không?"*. Cơ sở
 * 10 sân mà bắt bấm từng cái để dò thì mất 10 lần bấm chỉ để biết một điều.
 *
 * ---
 * BA KHỔ MÀN, MỘT COMPONENT
 *
 * Không phóng to thu nhỏ: mỗi khổ đổi số giờ hiển thị cùng lúc, còn cột tên sân
 * thì luôn đứng yên và phần giờ cuộn ngang. Xem `.claude/skills/chotsan-thiet-ke`.
 *
 * ---
 * GIÁ NẰM Ở TIÊU ĐỀ CỘT GIỜ, KHÔNG NHỒI VÀO Ô
 *
 * Ô 30 phút rộng khoảng 33px trên desktop — nhét "90k" vào là chữ nhỏ tới mức
 * không ai đọc. Mà giá vốn tính theo giờ, ghi hai lần cho hai nửa là thừa.
 */

export type SlotSelection = { courtId: string; startMinute: number; endMinute: number };

type Props = {
  day: DayAvailability;
  /** Bỏ trống = chỉ xem, không chọn được. */
  onSelect?: (selection: SlotSelection | null) => void;
  /** Số giờ hiện cùng lúc. Mặc định theo khổ màn qua CSS, đây là trần trên desktop. */
  hoursPerPage?: number;
  className?: string;
};

const STATUS_CLASS: Record<SlotStatus, string> = {
  FREE: "border-brand-line bg-brand-tint hover:bg-emerald-100",
  TAKEN: "border-taken-line bg-taken cursor-not-allowed",
  CLOSED:
    "border-line bg-[repeating-linear-gradient(45deg,#f8fafc,#f8fafc_4px,#e9eef4_4px,#e9eef4_8px)] cursor-not-allowed",
  PAST: "border-line bg-taken opacity-60 cursor-not-allowed",
};

const STATUS_LABEL: Record<SlotStatus, string> = {
  FREE: "còn trống",
  TAKEN: "đã có người đặt",
  CLOSED: "sân đang bảo trì",
  PAST: "đã qua giờ",
};

export function SlotGrid({ day, onSelect, hoursPerPage = 7, className }: Props) {
  const [anchor, setAnchor] = useState<SlotSelection | null>(null);

  /** Gom các khung thành nhóm theo GIỜ để mắt đọc theo giờ, không loạn 32 cột. */
  const hours = useMemo(() => {
    const grouped = new Map<number, number[]>();

    for (const minute of day.minutes) {
      const hour = Math.floor(minute / 60);
      grouped.set(hour, [...(grouped.get(hour) ?? []), minute]);
    }

    return [...grouped.entries()].map(([hour, minutes]) => ({ hour, minutes }));
  }, [day.minutes]);

  /*
   * MỞ Ở GIỜ CÒN ĐẶT ĐƯỢC, KHÔNG PHẢI Ở GIỜ MỞ CỬA.
   *
   * Sân mở 05:30 nhưng người mở trang lúc 3 giờ chiều thì trang đầu tiên toàn
   * ô xám của những khung đã trôi qua — họ phải bấm "Muộn hơn" hai lần mới
   * thấy thứ mua được. Nhảy thẳng tới giờ đầu tiên còn bán được.
   *
   * `day` do máy chủ dựng và ĐÃ đánh dấu `PAST` theo giờ Việt Nam, nên chỗ này
   * không đọc `Date.now()` — làm vậy là máy chủ và trình duyệt tính ra hai
   * trang khác nhau, và React báo lỗi hydration.
   */
  const trangDau = useMemo(() => {
    const conBan = hours.findIndex((group) =>
      group.minutes.some((minute) =>
        day.courts.some(
          (court) => court.slots.find((slot) => slot.minute === minute)?.status === "FREE",
        ),
      ),
    );

    if (conBan <= 0) return 0;
    // Lùi lại một giờ để còn thấy bối cảnh liền trước, nhưng không vượt cuối dải.
    return Math.min(Math.max(0, conBan - 1), Math.max(0, hours.length - hoursPerPage));
  }, [hours, day.courts, hoursPerPage]);

  const [pageStart, setPageStart] = useState(trangDau);

  const visible = hours.slice(pageStart, pageStart + hoursPerPage);
  const canPrev = pageStart > 0;
  const canNext = pageStart + hoursPerPage < hours.length;

  if (day.isClosed) {
    return (
      <div
        className={cn("rounded-token-md border border-line bg-surface p-8 text-center", className)}
      >
        <p className="text-base font-semibold text-content">Sân đóng cửa hôm nay</p>
        <p className="mt-1 text-sm text-muted">Chọn ngày khác để xem khung giờ còn trống.</p>
      </div>
    );
  }

  function handleClick(courtId: string, minute: number, status: SlotStatus) {
    if (!onSelect || status !== "FREE") return;

    // Bấm lần hai trên CÙNG sân, sau khung đầu → chọn cả dãy. Đây là cách nối
    // nhiều khung mà không cần kéo thả — kéo thả không dùng được trên điện thoại.
    if (anchor && anchor.courtId === courtId && minute > anchor.startMinute) {
      const next = { courtId, startMinute: anchor.startMinute, endMinute: minute + SLOT_MINUTES };
      setAnchor(next);
      onSelect(next);
      return;
    }

    if (anchor && anchor.courtId === courtId && anchor.startMinute === minute) {
      setAnchor(null);
      onSelect(null);
      return;
    }

    const next = { courtId, startMinute: minute, endMinute: minute + SLOT_MINUTES };
    setAnchor(next);
    onSelect(next);
  }

  const isSelected = (courtId: string, minute: number) =>
    anchor?.courtId === courtId && minute >= anchor.startMinute && minute < anchor.endMinute;

  return (
    /*
     * `min-w-0` KHÔNG PHẢI THỪA.
     *
     * Phần tử con của flex/grid mặc định là `min-width: auto`, nghĩa là nó nở
     * ra vừa nội dung thay vì chịu bó theo cha. Thiếu một chữ này thì cái
     * `overflow-x-auto` bên dưới hoàn toàn vô hiệu: lưới không cuộn trong khung
     * của nó mà đẩy RỘNG CẢ TRANG — trên điện thoại là header bị cắt, chữ tràn
     * ra ngoài mép, và người dùng phải cuộn ngang toàn trang để đọc.
     */
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {/* Điều hướng theo buổi — 32 cột không vừa màn nào, kể cả desktop */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setPageStart((value) => Math.max(0, value - hoursPerPage))}
          disabled={!canPrev}
          className="h-11 rounded-token-sm border border-line-strong bg-surface px-3 text-sm font-semibold disabled:opacity-40"
        >
          ← Sớm hơn
        </button>

        <p className="text-sm font-bold text-content">
          {visible.length > 0
            ? `${formatHhMm(visible[0]!.minutes[0]!)} – ${formatHhMm(
                visible.at(-1)!.minutes.at(-1)! + SLOT_MINUTES,
              )}`
            : ""}
        </p>

        <button
          type="button"
          onClick={() =>
            setPageStart((value) => Math.min(hours.length - hoursPerPage, value + hoursPerPage))
          }
          disabled={!canNext}
          className="h-11 rounded-token-sm border border-line-strong bg-surface px-3 text-sm font-semibold disabled:opacity-40"
        >
          Muộn hơn →
        </button>
      </div>

      <div className="min-w-0 overflow-x-auto">
        <div className="min-w-max">
          {/* Tiêu đề: giờ + giá. Giá ở đây chứ không ở trong ô. */}
          <div className="mb-1.5 flex gap-2">
            <div className="w-[72px] shrink-0" aria-hidden />
            {visible.map(({ hour, minutes }) => {
              const peak = minutes.some((minute) =>
                day.courts.some(
                  (court) => court.slots.find((slot) => slot.minute === minute)?.isPeak,
                ),
              );
              const price = day.courts[0]?.slots.find((slot) => slot.minute === minutes[0])?.price;

              return (
                <div key={hour} className="w-[104px] shrink-0 text-center">
                  <div
                    className={cn(
                      "text-[13px] font-extrabold",
                      peak ? "text-peak-text" : "text-content",
                    )}
                  >
                    {formatHhMm(hour * 60)}
                  </div>
                  {price !== undefined && price > 0 && (
                    <div
                      className={cn(
                        "text-[10px] font-bold",
                        peak ? "text-peak-text" : "text-brand-hover",
                      )}
                    >
                      {formatVndShort(price)}/30p
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {day.courts.map((court) => (
            <div key={court.courtId} className="mb-1.5 flex gap-2">
              <div className="flex w-[72px] shrink-0 items-center text-[13px] font-bold">
                {court.courtName}
              </div>

              {visible.map(({ hour, minutes }) => (
                <div key={hour} className="grid w-[104px] shrink-0 grid-cols-2 gap-[3px]">
                  {minutes.map((minute) => {
                    const slot = court.slots.find((item) => item.minute === minute);
                    if (!slot) return <div key={minute} />;

                    const selected = isSelected(court.courtId, minute);
                    const clickable = Boolean(onSelect) && slot.status === "FREE";

                    return (
                      <button
                        key={minute}
                        type="button"
                        disabled={!clickable}
                        onClick={() => handleClick(court.courtId, minute, slot.status)}
                        /* 44px là ngưỡng chạm, không phải gợi ý — chủ sân bấm
                           trên máy tính bảng, một tay còn cầm điện thoại. */
                        className={cn(
                          "h-11 rounded-token-sm border-[1.5px] transition-colors",
                          selected
                            ? "border-brand bg-brand"
                            : slot.isPeak && slot.status === "FREE"
                              ? "border-peak-line bg-peak-tint hover:bg-orange-100"
                              : STATUS_CLASS[slot.status],
                        )}
                        aria-label={`${court.courtName} ${formatHhMm(minute)} — ${
                          selected ? "đang chọn" : STATUS_LABEL[slot.status]
                        }`}
                        aria-pressed={selected}
                      >
                        {selected && (
                          <svg
                            viewBox="0 0 24 24"
                            className="mx-auto h-3.5 w-3.5"
                            fill="none"
                            stroke="#fff"
                            strokeWidth={3.4}
                          >
                            <path d="M20 6L9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Chú giải: mỗi trạng thái khác nhau ở CẢ màu LẪN chữ — in đen trắng vẫn đọc được */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-2 text-xs text-muted">
        <Legend className="border-brand-line bg-brand-tint" label="Còn trống" />
        <Legend className="border-peak-line bg-peak-tint" label="Giờ vàng · giá cao hơn" />
        <Legend className="border-taken-line bg-taken" label="Đã có người" />
        <Legend
          className="border-line bg-[repeating-linear-gradient(45deg,#f8fafc,#f8fafc_4px,#e9eef4_4px,#e9eef4_8px)]"
          label="Bảo trì"
        />
        {onSelect && (
          <span className="ml-auto font-semibold">Bấm ô đầu rồi bấm ô cuối để đặt liền mạch</span>
        )}
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded-[3px] border-[1.5px]", className)} aria-hidden />
      {label}
    </span>
  );
}

/**
 * Dải tổng quan cả ngày — số sân trống theo từng khung 30 phút.
 *
 * Liếc một cái là biết nên đặt giờ nào, chưa cần đọc lưới. Đây là thứ trả lời
 * câu hỏi thật của người dùng: *"tối nay còn chỗ không?"*
 */
export function DaySummaryStrip({
  day,
  className,
  onPick,
}: {
  day: DayAvailability;
  className?: string;
  onPick?: (minute: number) => void;
}) {
  if (day.isClosed) return null;

  const max = Math.max(1, ...day.summary);

  return (
    <div className={cn("rounded-token-md border border-line bg-surface p-3", className)}>
      <div className="mb-2 flex items-baseline justify-between">
        <p className="text-xs font-bold text-muted">Cả ngày · số sân trống mỗi 30 phút</p>
        <p className="text-[11px] text-subtle">
          {formatHhMm(day.minutes[0] ?? 0)} → {formatHhMm((day.minutes.at(-1) ?? 0) + SLOT_MINUTES)}
        </p>
      </div>

      <div className="flex gap-[2px]">
        {day.minutes.map((minute, index) => {
          const free = day.summary[index] ?? 0;
          const ratio = free / max;

          return (
            <button
              key={minute}
              type="button"
              onClick={() => onPick?.(minute)}
              disabled={!onPick}
              title={`${formatHhMm(minute)} — còn ${free} sân`}
              aria-label={`${formatHhMm(minute)}, còn ${free} sân trống`}
              className={cn(
                /*
                 * `min-w-0` cho phép ô co lại thật sự.
                 *
                 * `flex-1` một mình KHÔNG đủ: phần tử flex mặc định
                 * `min-width: auto`, tức không co nhỏ hơn nội dung của nó. Với
                 * 35 ô mang chữ số, ở màn 320px cả dải đòi ~348px và đẩy tràn
                 * ngang cả trang.
                 *
                 * Chữ số ẩn đi ở khổ hẹp nhất — dải này bán MÀU trước, con số
                 * chỉ là phần thêm, mà một dải màu đọc được vẫn hơn một trang
                 * phải cuộn ngang.
                 */
                "h-7 min-w-0 flex-1 overflow-hidden rounded-[3px] text-[10px] font-extrabold text-white",
                free === 0
                  ? "bg-slate-300 text-slate-500"
                  : ratio <= 0.15
                    ? "bg-red-300 text-red-900"
                    : ratio <= 0.35
                      ? "bg-peak text-white"
                      : ratio <= 0.6
                        ? "bg-emerald-300 text-emerald-900"
                        : "bg-brand",
              )}
            >
              <span className="max-[380px]:hidden">{free}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-1 flex justify-between text-[9px] text-subtle">
        {day.minutes
          .filter((minute) => minute % 120 === 0)
          .map((minute) => (
            <span key={minute}>{formatHhMm(minute)}</span>
          ))}
      </div>
    </div>
  );
}
