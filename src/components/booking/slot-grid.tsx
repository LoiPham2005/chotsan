"use client";

import { useEffect, useMemo, useRef } from "react";
import { cn } from "@/lib/cn";
import { formatHhMm, formatVndShort, SLOT_MINUTES } from "@/lib/slots";
import type { DayAvailability, SlotStatus } from "@/services/availability.service";

/**
 * Lưới đặt sân — SÂN × KHUNG 30 PHÚT.
 *
 * ---
 * KHÔNG CÓ ĐƯỜNG KẺ
 *
 * Bản trước kẻ một vạch dọc giữa MỌI ô — 35 cột là 35 đường kẻ, cả lưới
 * trông như tờ giấy ô li. Ở đây các ô là những khối bo tròn tách nhau bằng
 * KHOẢNG TRẮNG; nhịp thời gian đến từ thước giờ phía trên, không đến từ vạch.
 *
 * ---
 * GIỜ NẰM Ở RANH GIỚI GIỮA HAI Ô, KHÔNG NẰM GIỮA Ô
 *
 * Ô nằm giữa nhãn 17:00 và nhãn 17:30 là khung 17:00–17:30 — nhìn là thấy
 * cả hai đầu. Mọi nhãn cùng cỡ chữ; nhãn to nhãn nhỏ xen kẽ làm thước lổn nhổn.
 *
 * ---
 * KHUNG ĐÃ QUA BỊ ẨN, KHÔNG BÀY RA
 *
 * Mở lúc 10 giờ sáng thì 9 cột đầu toàn "Đã qua" × số sân — một bức tường chữ
 * lặp lại không ai cần đọc. Ẩn chúng đi và ghi một dòng "đã ẩn N khung".
 *
 * ---
 * CUỘN, KHÔNG CHIA TRANG
 *
 * Chia trang buộc người dùng bấm "Muộn hơn" rồi mất dấu thứ vừa chọn.
 */

export type GridAxis = "court-rows" | "time-rows";

/** Khoá của một ô đã chọn. */
export const slotKey = (courtId: string, minute: number) => `${courtId}__${minute}`;

export type PickedSlot = { courtId: string; minute: number; price: number };

/**
 * Chỉ giữ những ô CÒN TRỐNG trong lịch đang có, kèm giá của ô.
 *
 * Dùng cho cả hai đường vào một lựa chọn: bấm ô, và lựa chọn mang về từ trang
 * đăng nhập. Đường thứ hai mới là lý do hàm này tồn tại — trong mấy chục giây
 * khách đăng nhập, người khác có thể đã đặt mất một ô. Ô đó phải rơi khỏi lựa
 * chọn, không được âm thầm nằm lại rồi làm hỏng cả lần đặt.
 */
export function keepFreeSlots(
  day: DayAvailability,
  slots: readonly { courtId: string; minute: number }[],
): Record<string, PickedSlot> {
  const picked: Record<string, PickedSlot> = {};

  for (const { courtId, minute } of slots) {
    const slot = day.courts
      .find((court) => court.courtId === courtId)
      ?.slots.find((item) => item.minute === minute);

    if (slot?.status === "FREE") {
      picked[slotKey(courtId, minute)] = { courtId, minute, price: slot.price };
    }
  }

  return picked;
}

type Props = {
  day: DayAvailability;
  /** Tập khoá `slotKey()` đang chọn. */
  selected: ReadonlySet<string>;
  /** Bỏ trống = chỉ xem, không chọn được. */
  onToggle?: (courtId: string, minute: number) => void;
  axis: GridAxis;
  onAxisChange: (next: GridAxis) => void;
  className?: string;
};

const STATUS_LABEL: Record<SlotStatus, string> = {
  FREE: "còn trống",
  TAKEN: "đã có người đặt",
  CLOSED: "sân đang bảo trì",
  PAST: "đã qua giờ",
  NOT_FOR_SALE: "chưa mở bán",
};

/**
 * Nhãn đọc to của một ô: sân, khung giờ, trạng thái — và GIÁ chỉ khi ô bán được.
 *
 * Lỗi thật trước đây: ô chưa có giá đọc thành "…, còn trống, 0" — người dùng
 * trình đọc màn hình nghe như khung miễn phí.
 */
export function slotAriaLabel(
  courtName: string,
  minute: number,
  slot: { status: SlotStatus; price: number },
  isSelected: boolean,
): string {
  const range = `${formatHhMm(minute)}–${formatHhMm(minute + SLOT_MINUTES)}`;
  const state = isSelected ? "đang chọn" : STATUS_LABEL[slot.status];
  const price = slot.status === "FREE" && slot.price > 0 ? `, ${formatVndShort(slot.price)}` : "";
  return `${courtName} ${range} — ${state}${price}`;
}

/**
 * Phút của khung ĐẦU TIÊN còn đặt được trên bất kỳ sân nào — đích cuộn lúc mở.
 * Trả `null` khi cả ngày không còn ô nào.
 */
export function firstBookableMinute(day: DayAvailability): number | null {
  for (const minute of day.minutes) {
    const free = day.courts.some(
      (court) => court.slots.find((slot) => slot.minute === minute)?.status === "FREE",
    );
    if (free) return minute;
  }
  return null;
}

/**
 * Bỏ các cột ĐẦU NGÀY mà mọi sân đều đã qua giờ.
 *
 * Chỉ cắt phần đầu, không cắt giữa: "đã qua" là theo đồng hồ nên luôn là một
 * dải liền từ giờ mở cửa tới bây giờ. Cắt lỗ chỗ giữa ngày sẽ làm thước giờ
 * nhảy cóc mà người dùng không nhận ra.
 */
export function visibleMinutes(day: DayAvailability): { minutes: number[]; hidden: number } {
  let hidden = 0;

  for (const minute of day.minutes) {
    const allPast = day.courts.every(
      (court) => court.slots.find((slot) => slot.minute === minute)?.status === "PAST",
    );
    if (!allPast) break;
    hidden += 1;
  }

  return { minutes: day.minutes.slice(hidden), hidden };
}

export function SlotGrid({ day, selected, onToggle, axis, onAxisChange, className }: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const cellOf = useMemo(() => {
    const map = new Map<string, DayAvailability["courts"][number]["slots"][number]>();
    for (const court of day.courts) {
      for (const slot of court.slots) map.set(slotKey(court.courtId, slot.minute), slot);
    }
    return map;
  }, [day.courts]);

  const peakMinutes = useMemo(() => {
    const set = new Set<number>();
    for (const court of day.courts) {
      for (const slot of court.slots) if (slot.isPeak) set.add(slot.minute);
    }
    return set;
  }, [day.courts]);

  const { minutes, hidden } = useMemo(() => visibleMinutes(day), [day]);
  const target = useMemo(() => firstBookableMinute(day), [day]);
  const hasNotForSale = useMemo(
    () => day.courts.some((court) => court.slots.some((slot) => slot.status === "NOT_FOR_SALE")),
    [day.courts],
  );

  /*
   * Cuộn tới khung đầu tiên còn đặt được. Đặt `scrollLeft` thẳng trên phần tử,
   * KHÔNG qua `setState` — không có gì cần dựng lại.
   */
  useEffect(() => {
    const box = scrollRef.current;
    if (!box || target === null) return;

    const cell = box.querySelector<HTMLElement>(`[data-minute="${target}"]`);
    if (!cell) return;

    /*
     * Đo bằng `getBoundingClientRect`, KHÔNG dùng `offsetLeft`: `offsetParent`
     * của nút là ô `td`, nên `offsetLeft` chỉ ra vài pixel — lưới cuộn sai chỗ.
     * Trừ bề rộng cột dính (tên sân / nhãn giờ) để ô đích không chui xuống dưới
     * nó, nhất là trên điện thoại nơi cột đó chiếm gần một phần tư màn hình.
     */
    const boxRect = box.getBoundingClientRect();
    const cellRect = cell.getBoundingClientRect();
    const sticky = box.querySelector("tbody th")?.getBoundingClientRect() ?? null;

    if (axis === "court-rows") {
      const delta = cellRect.left - boxRect.left - (sticky?.width ?? 0) - 40;
      // Lệch vài pixel thì thôi: cuộn 3px chỉ đủ để che mất nửa nhãn giờ đầu.
      if (delta > 24) box.scrollLeft += delta;
    } else {
      const header = box.querySelector("thead")?.getBoundingClientRect().height ?? 0;
      const delta = cellRect.top - boxRect.top - header - 20;
      if (delta > 24) box.scrollTop += delta;
    }
  }, [target, axis, day.date]);

  // Ngày đã qua nói trước mọi thứ khác: nói "sân nghỉ" hay "hôm nay hết giờ"
  // cho một ngày của tuần trước là nói sai chuyện.
  if (day.timing === "PAST") {
    return (
      <EmptyState
        className={className}
        title="Ngày này đã qua"
        hint="Chọn hôm nay hoặc một ngày sắp tới để xem khung giờ còn trống."
      />
    );
  }

  if (day.isClosed || day.courts.length === 0) {
    return (
      <EmptyState
        className={className}
        title="Sân không mở cửa ngày này"
        hint="Chọn ngày khác để xem khung giờ còn trống."
      />
    );
  }

  if (minutes.length === 0) {
    return (
      <EmptyState
        className={className}
        title="Hôm nay đã hết giờ đặt"
        hint="Mọi khung trong ngày đã qua. Chọn ngày mai hoặc ngày khác nhé."
      />
    );
  }

  const renderCell = (courtId: string, courtName: string, minute: number) => {
    const key = slotKey(courtId, minute);
    const slot = cellOf.get(key);
    const isSelected = selected.has(key);

    if (!slot) {
      return <span className="block h-11 rounded-xl bg-elevated/50" aria-hidden />;
    }

    const clickable = Boolean(onToggle) && slot.status === "FREE";

    let content: React.ReactNode;
    let tone: string;

    if (isSelected) {
      content = <CheckIcon />;
      tone = "bg-brand text-white shadow-chon hover:bg-brand-hover";
    } else if (slot.status === "TAKEN") {
      content = <span className="text-[11px] font-medium">Đã đặt</span>;
      tone = "cursor-not-allowed bg-taken text-subtle";
    } else if (slot.status === "CLOSED") {
      content = <span className="text-[11px] font-medium">Bảo trì</span>;
      tone =
        "cursor-not-allowed text-subtle bg-[repeating-linear-gradient(135deg,var(--taken-bg)_0_5px,transparent_5px_10px)]";
    } else if (slot.status === "PAST") {
      content = null;
      tone = "cursor-not-allowed bg-elevated/40";
    } else if (slot.status === "NOT_FOR_SALE") {
      // Khung chưa có giá: chủ sân chưa mở bán giờ này. Trông như ô không bấm
      // được, KHÔNG hiện "0" — số 0 đọc thành "miễn phí".
      content = <span className="text-[11px] font-medium">—</span>;
      tone = "cursor-not-allowed bg-elevated/40 text-subtle";
    } else if (slot.isPeak) {
      content = formatVndShort(slot.price);
      tone =
        "bg-peak-tint text-peak-text ring-1 ring-inset ring-peak-line/80 hover:ring-2 hover:ring-peak-text/60";
    } else {
      content = formatVndShort(slot.price);
      tone =
        "bg-surface text-content ring-1 ring-inset ring-line hover:bg-brand-tint hover:text-brand-text hover:ring-2 hover:ring-brand/50";
    }

    return (
      <button
        type="button"
        data-minute={minute}
        disabled={!clickable && !isSelected}
        onClick={() => onToggle?.(courtId, minute)}
        aria-pressed={isSelected}
        aria-label={slotAriaLabel(courtName, minute, slot, isSelected)}
        className={cn(
          // 44px: ngưỡng chạm tối thiểu trên điện thoại và máy tính bảng.
          "flex h-11 w-full items-center justify-center rounded-xl text-[13px] font-semibold tabular-nums transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          clickable && "active:scale-95",
          tone,
        )}
      >
        {content}
      </button>
    );
  };

  return (
    // Viền 1px, không đổ bóng — thẻ thường không đổ bóng (SKILL.md §4).
    <div
      className={cn("min-w-0 overflow-hidden rounded-2xl bg-surface ring-1 ring-line", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-2 pt-3.5">
        <p className="text-xs text-muted">
          {hidden > 0 ? (
            <>
              Đã ẩn <span className="font-semibold text-content">{hidden}</span> khung đã qua giờ
            </>
          ) : (
            "Bấm vào ô để chọn · chọn được nhiều ô"
          )}
        </p>

        {/* Nút chuyển kiểu xem dạng "viên thuốc" — hai lựa chọn nhìn thấy cùng lúc. */}
        <div
          role="group"
          aria-label="Kiểu xem"
          className="inline-flex rounded-full bg-elevated p-1"
        >
          {(
            [
              ["court-rows", "Theo sân"],
              ["time-rows", "Theo giờ"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={axis === value}
              onClick={() => onAxisChange(value)}
              // Viên thuốc nhìn gọn (24px: chữ 16px + đệm 4px trên dưới) nhưng vùng
              // bấm đủ 44px nhờ lớp giả `after:` nới 10px trên dưới (SKILL.md §1,
              // luật 5). Nới 8px chỉ được 40px — đã đo bằng `getBoundingClientRect`.
              className={cn(
                "relative rounded-full px-3 py-1 text-xs font-semibold transition-colors after:absolute after:inset-x-0 after:-inset-y-2.5",
                axis === value
                  ? "bg-surface text-content ring-1 ring-line"
                  : "text-muted hover:text-content",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/*
        `min-w-0` + `overflow-auto`: thiếu `min-w-0` thì bảng đẩy rộng CẢ TRANG
        thay vì tự cuộn trong khung của nó. Xem SKILL.md.
      */}
      <div
        ref={scrollRef}
        className={cn(
          "scrollbar-thin min-w-0 overflow-auto px-2 pb-3",
          axis === "time-rows" && "max-h-[68vh]",
        )}
      >
        {axis === "court-rows" ? (
          <table className="border-separate" style={{ borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[92px] bg-surface" />
                {/* Cột đệm: chừa chỗ cho nửa trái của nhãn giờ đầu tiên. */}
                <th aria-hidden className="sticky top-0 z-10 w-7 min-w-7 bg-surface" />
                {minutes.map((minute, index) => (
                  <th key={minute} className="sticky top-0 z-10 min-w-[66px] bg-surface p-0">
                    <div className="relative h-8">
                      <RulerLabel minute={minute} peak={peakMinutes.has(minute)} />
                      {index === minutes.length - 1 && (
                        <RulerLabel
                          minute={minute + SLOT_MINUTES}
                          peak={peakMinutes.has(minute)}
                          atEnd
                        />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {day.courts.map((court) => (
                <tr key={court.courtId} className="group">
                  <th
                    scope="row"
                    className="sticky left-0 z-20 bg-surface pl-2 pr-3 text-left shadow-sticky-edge"
                  >
                    <span className="whitespace-nowrap text-sm font-semibold text-content">
                      {court.courtName}
                    </span>
                  </th>
                  <td aria-hidden className="w-7 min-w-7 p-0" />
                  {minutes.map((minute) => (
                    <td key={minute} className="p-[3px]">
                      {renderCell(court.courtId, court.courtName, minute)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="border-separate" style={{ borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[60px] bg-surface" />
                {day.courts.map((court) => (
                  <th
                    key={court.courtId}
                    className="sticky top-0 z-10 min-w-[84px] bg-surface px-[3px] pb-2"
                  >
                    <span className="block whitespace-nowrap rounded-lg bg-elevated px-2 py-1.5 text-center text-sm font-semibold text-content">
                      {court.courtName}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Hàng đệm: chừa chỗ cho nửa trên của nhãn giờ đầu tiên. */}
              <tr aria-hidden>
                <td className="h-2 p-0" colSpan={day.courts.length + 1} />
              </tr>
              {minutes.map((minute, index) => (
                <tr key={minute}>
                  <th scope="row" className="sticky left-0 z-10 bg-surface p-0 align-top">
                    <div className="relative h-[50px]">
                      <RulerLabelVertical minute={minute} peak={peakMinutes.has(minute)} />
                      {index === minutes.length - 1 && (
                        <RulerLabelVertical
                          minute={minute + SLOT_MINUTES}
                          peak={peakMinutes.has(minute)}
                          atEnd
                        />
                      )}
                    </div>
                  </th>
                  {day.courts.map((court) => (
                    <td key={court.courtId} className="p-[3px]">
                      {renderCell(court.courtId, court.courtName, minute)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-elevated/50 px-4 py-2.5 text-xs text-muted">
        <Swatch className="bg-surface ring-1 ring-inset ring-line" label="Còn trống" />
        <Swatch className="bg-peak-tint ring-1 ring-inset ring-peak-line" label="Giờ vàng" />
        <Swatch className="bg-brand" label="Đang chọn" />
        <Swatch className="bg-taken" label="Đã đặt" />
        <Swatch
          className="bg-[repeating-linear-gradient(135deg,var(--border-strong)_0_2px,transparent_2px_5px)]"
          label="Bảo trì"
        />
        {hasNotForSale && <Swatch className="bg-elevated" label="Chưa mở bán" />}
      </div>
    </div>
  );
}

/**
 * Nhãn giờ trên thước NẰM NGANG — căn giữa đúng mép trái của cột, tức đúng
 * ranh giới giữa hai ô. Một chấm nhỏ đánh dấu ranh giới thay cho vạch kẻ.
 *
 * Mọi nhãn cùng cỡ, cùng độ đậm: nhãn to nhãn nhỏ xen kẽ làm thước lổn nhổn.
 */
function RulerLabel({ minute, peak, atEnd }: { minute: number; peak: boolean; atEnd?: boolean }) {
  return (
    <>
      <span
        className={cn(
          "absolute top-1.5 whitespace-nowrap text-xs font-semibold tabular-nums leading-none",
          atEnd ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
          peak ? "text-peak-text" : "text-muted",
        )}
      >
        {formatHhMm(minute)}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute bottom-1 h-1 w-1 rounded-full",
          atEnd ? "right-0 translate-x-1/2" : "left-0 -translate-x-1/2",
          peak ? "bg-peak-line" : "bg-line-strong",
        )}
      />
    </>
  );
}

/** Bản DỌC — căn giữa đúng mép trên của hàng. */
function RulerLabelVertical({
  minute,
  peak,
  atEnd,
}: {
  minute: number;
  peak: boolean;
  atEnd?: boolean;
}) {
  return (
    <span
      className={cn(
        "absolute right-3 whitespace-nowrap text-xs font-semibold tabular-nums leading-none",
        atEnd ? "bottom-0 translate-y-1/2" : "top-0 -translate-y-1/2",
        peak ? "text-peak-text" : "text-muted",
      )}
    >
      {formatHhMm(minute)}
    </span>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3.5 w-3.5 rounded-[5px]", className)} aria-hidden />
      {label}
    </span>
  );
}

function EmptyState({
  className,
  title,
  hint,
}: {
  className?: string;
  title: string;
  hint: string;
}) {
  return (
    <div className={cn("rounded-2xl bg-surface p-10 text-center ring-1 ring-line", className)}>
      <p className="text-base font-semibold text-content">{title}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </div>
  );
}
