"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  savePriceRulesAction,
  type CourtState,
} from "@/app/(manage)/manage/[venueId]/courts/actions";
import { Button } from "@/components/ui/button";
import { fieldClassName } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
import { formatHhMm, formatVnd } from "@/lib/slots";

const WEEKDAYS = [
  { value: 1, label: "T2" },
  { value: 2, label: "T3" },
  { value: 3, label: "T4" },
  { value: 4, label: "T5" },
  { value: 5, label: "T6" },
  { value: 6, label: "T7" },
  { value: 0, label: "CN" },
];

export type PriceRuleItem = {
  courtId: string | null;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  pricePerSlot: number;
  isPeak: boolean;
  priority: number;
};

/** Danh sách mốc 30 phút để chọn giờ — cùng bước với lưới đặt sân. */
const MINUTES = Array.from({ length: 49 }, (_, i) => i * 30);

/**
 * Bảng giá.
 *
 * ---
 * SỬA CẢ BẢNG RỒI LƯU MỘT LẦN
 *
 * Giá của một khung phụ thuộc vào thứ tự ưu tiên GIỮA các luật, nên sửa lẻ một
 * dòng có thể đổi giá của khung khác mà người sửa không nhìn thấy. Ở đây họ sửa
 * cả bảng, thấy toàn cảnh, rồi bấm Lưu một lần — thứ họ nhìn đúng là thứ sẽ áp.
 *
 * Bảng nằm trong state của React, NGOÀI thẻ `<form>` (form chỉ mang một ô ẩn):
 * lưu báo lỗi thì React 19 xoá trắng form, nhưng không đụng tới state — bảng
 * đang sửa dở còn nguyên.
 *
 * ---
 * Ô "ƯU TIÊN" CÓ GIẢI THÍCH NGAY TẠI CHỖ
 *
 * Đây là khái niệm duy nhất trong màn này người dùng không đoán được. Giấu nó
 * trong tài liệu nghĩa là không ai đọc. Mỗi luật có số thứ tự ("Luật 2") để câu
 * báo "luật 2 và luật 3 chồng nhau" chỉ thẳng được vào dòng cần sửa.
 *
 * `canEdit = false` (không có `pricing:update`): chỉ xem, không ô nhập, không nút.
 */
export function PriceRuleEditor({
  venueId,
  courts,
  initial,
  canEdit,
}: {
  venueId: string;
  courts: { id: string; name: string }[];
  initial: PriceRuleItem[];
  canEdit: boolean;
}) {
  const [rules, setRules] = useState<PriceRuleItem[]>(initial);
  const [state, save] = useActionState<CourtState, FormData>(
    savePriceRulesAction.bind(null, venueId),
    {},
  );

  const courtName = (courtId: string | null) =>
    courtId
      ? `Riêng ${courts.find((court) => court.id === courtId)?.name ?? "sân đã xoá"}`
      : "Cả cơ sở";

  const update = (index: number, patch: Partial<PriceRuleItem>) =>
    setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  const toggleWeekday = (index: number, day: number) =>
    update(index, {
      weekdays: rules[index]!.weekdays.includes(day)
        ? rules[index]!.weekdays.filter((d) => d !== day)
        : [...rules[index]!.weekdays, day].sort(),
    });

  return (
    <section className="mt-8" aria-labelledby="pricing-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="pricing-heading" className="text-lg font-bold text-content">
          Bảng giá
          <span className="ml-2 text-sm font-medium text-muted">{rules.length} luật</span>
        </h2>

        {canEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setRules((prev) => [
                ...prev,
                {
                  courtId: null,
                  weekdays: [],
                  startMinute: 6 * 60,
                  endMinute: 22 * 60,
                  pricePerSlot: 70_000,
                  isPeak: false,
                  priority: nextPriority(prev),
                },
              ])
            }
          >
            + Thêm luật
          </Button>
        )}
      </div>

      <p className="mt-1 text-sm text-muted">
        Giá tính theo <strong>mỗi 30 phút</strong>. Luật có <strong>ưu tiên</strong> cao hơn thắng
        khi hai luật cùng phủ một khung giờ; cùng ưu tiên thì luật riêng một sân thắng luật cả cơ
        sở.
        {!canEdit && " Bạn đang xem — sửa bảng giá cần quyền sửa giá."}
      </p>

      {state.error && (
        <Notice tone="danger" role="alert" className="mt-3">
          {state.error}
        </Notice>
      )}
      {state.ok && (
        <p role="status" className="mt-3 text-sm font-semibold text-brand-text">
          {state.ok}
        </p>
      )}

      {rules.length === 0 ? (
        <p className="mt-3 rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">
          Chưa có luật giá nào. Chưa có bảng giá thì cơ sở chưa gửi duyệt hay mở bán được.
        </p>
      ) : !canEdit ? (
        <ul className="mt-3 space-y-2">
          {rules.map((rule, index) => (
            <li
              key={index}
              className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-token-lg border bg-surface p-3 text-sm ${
                rule.isPeak ? "border-peak-line" : "border-line"
              }`}
            >
              <span className="text-xs font-bold uppercase tracking-wide text-subtle">
                Luật {index + 1}
              </span>
              <span className="font-semibold text-content">{courtName(rule.courtId)}</span>
              <span className="text-muted">{weekdaysText(rule.weekdays)}</span>
              <span className="tabular-nums text-muted">
                {formatHhMm(rule.startMinute)}–{formatHhMm(rule.endMinute)}
              </span>
              <span className="font-semibold tabular-nums text-content">
                {formatVnd(rule.pricePerSlot)}
              </span>
              {rule.isPeak && <span className="text-peak-text">Giờ vàng</span>}
              <span className="ml-auto text-muted">Ưu tiên {rule.priority}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-3 space-y-3">
          {rules.map((rule, index) => (
            <li
              key={index}
              className={`rounded-token-lg border bg-surface p-3 ${
                rule.isPeak ? "border-peak-line" : "border-line"
              }`}
            >
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-subtle">
                Luật {index + 1}
              </p>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Áp cho">
                  <select
                    value={rule.courtId ?? ""}
                    onChange={(e) => update(index, { courtId: e.target.value || null })}
                    className={cn(fieldClassName, "h-11 cursor-pointer")}
                  >
                    <option value="">Cả cơ sở</option>
                    {courts.map((court) => (
                      <option key={court.id} value={court.id}>
                        Riêng {court.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Từ giờ">
                  <TimeSelect
                    value={rule.startMinute}
                    onChange={(v) => update(index, { startMinute: v })}
                  />
                </Field>

                <Field label="Đến giờ">
                  <TimeSelect
                    value={rule.endMinute}
                    onChange={(v) => update(index, { endMinute: v })}
                  />
                </Field>

                <Field label="Giá / 30 phút">
                  <input
                    type="number"
                    min={0}
                    step={5000}
                    value={rule.pricePerSlot}
                    onChange={(e) => update(index, { pricePerSlot: Number(e.target.value) })}
                    className={cn(fieldClassName, "h-11 tabular-nums")}
                  />
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs font-bold uppercase tracking-wide text-subtle">
                    Ngày
                  </span>
                  {WEEKDAYS.map((day) => {
                    const on = rule.weekdays.includes(day.value);
                    return (
                      <button
                        key={day.value}
                        type="button"
                        onClick={() => toggleWeekday(index, day.value)}
                        aria-pressed={on}
                        // 44px mỗi nút thứ — chủ sân sửa bảng giá trên máy tính bảng.
                        className={`h-11 min-w-11 rounded-token-control border-[1.5px] px-1 text-xs font-semibold transition-colors ${
                          on
                            ? "border-brand bg-brand text-white"
                            : "border-line-strong bg-surface text-muted hover:border-brand-line"
                        }`}
                      >
                        {day.label}
                      </button>
                    );
                  })}
                  {rule.weekdays.length === 0 && (
                    <span className="ml-1 text-xs text-muted">= mọi ngày</span>
                  )}
                </div>

                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-content">
                  <input
                    type="checkbox"
                    checked={rule.isPeak}
                    onChange={(e) => update(index, { isPeak: e.target.checked })}
                    className="h-4 w-4 accent-brand"
                  />
                  Giờ vàng
                </label>

                <label className="flex items-center gap-2 text-sm text-content">
                  Ưu tiên
                  <input
                    type="number"
                    value={rule.priority}
                    onChange={(e) => update(index, { priority: Number(e.target.value) })}
                    className={cn(fieldClassName, "h-11 w-20 tabular-nums")}
                  />
                </label>

                <p className="ml-auto text-sm text-muted">
                  {formatHhMm(rule.startMinute)}–{formatHhMm(rule.endMinute)} ·{" "}
                  <span className="font-semibold text-content">{formatVnd(rule.pricePerSlot)}</span>
                </p>

                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                >
                  Xoá luật
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form action={save} className="mt-4">
          <input type="hidden" name="rules" value={JSON.stringify(rules)} />
          <SaveButton />
        </form>
      )}
    </section>
  );
}

/**
 * Ưu tiên cho luật vừa thêm: cao hơn mọi luật đang có. Luật mới mặc định phủ
 * 06:00–22:00 mọi ngày cho cả cơ sở — đặt cố định một số (trước đây luôn là 10)
 * thì thêm hai luật liền nhau là lưu bị từ chối vì "cùng ưu tiên, chồng nhau".
 */
export function nextPriority(rules: readonly PriceRuleItem[]): number {
  return rules.length === 0 ? 0 : Math.max(...rules.map((rule) => rule.priority)) + 10;
}

/** "Mọi ngày" hoặc "T2, T3, T7" theo thứ tự trong tuần. */
function weekdaysText(weekdays: number[]): string {
  if (weekdays.length === 0) return "Mọi ngày";
  return WEEKDAYS.filter((day) => weekdays.includes(day.value))
    .map((day) => day.label)
    .join(", ");
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-subtle">
        {label}
      </span>
      {children}
    </label>
  );
}

function TimeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(fieldClassName, "h-11 cursor-pointer tabular-nums")}
    >
      {MINUTES.map((minute) => (
        <option key={minute} value={minute}>
          {formatHhMm(minute)}
        </option>
      ))}
    </select>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Đang lưu…" : "Lưu bảng giá"}
    </Button>
  );
}
