"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  savePriceRulesAction,
  type CourtState,
} from "@/app/(manage)/manage/[venueId]/courts/actions";
import { Button } from "@/components/ui/button";
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
 * ---
 * Ô "ƯU TIÊN" CÓ GIẢI THÍCH NGAY TẠI CHỖ
 *
 * Đây là khái niệm duy nhất trong màn này người dùng không đoán được. Giấu nó
 * trong tài liệu nghĩa là không ai đọc.
 */
export function PriceRuleEditor({
  venueId,
  courts,
  initial,
}: {
  venueId: string;
  courts: { id: string; name: string }[];
  initial: PriceRuleItem[];
}) {
  const [rules, setRules] = useState<PriceRuleItem[]>(initial);
  const [state, save] = useActionState<CourtState, FormData>(
    savePriceRulesAction.bind(null, venueId),
    {},
  );

  const update = (index: number, patch: Partial<PriceRuleItem>) =>
    setRules((prev) => prev.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  const toggleWeekday = (index: number, day: number) =>
    update(index, {
      weekdays: rules[index]!.weekdays.includes(day)
        ? rules[index]!.weekdays.filter((d) => d !== day)
        : [...rules[index]!.weekdays, day].sort(),
    });

  return (
    <section className="mt-8" aria-labelledby="bang-gia">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="bang-gia" className="text-lg font-bold text-content">
          Bảng giá
          <span className="ml-2 text-sm font-medium text-muted">{rules.length} luật</span>
        </h2>

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
                priority: prev.length === 0 ? 0 : 10,
              },
            ])
          }
        >
          + Thêm luật
        </Button>
      </div>

      <p className="mt-1 text-sm text-muted">
        Giá tính theo <strong>mỗi 30 phút</strong>. Luật có <strong>ưu tiên</strong> cao hơn thắng
        khi hai luật cùng phủ một khung giờ.
      </p>

      {state.error && (
        <p role="alert" className="alert alert-danger mt-3">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="mt-3 text-sm font-medium text-brand-hover">
          {state.ok}
        </p>
      )}

      {rules.length === 0 ? (
        <p className="mt-3 rounded-token-lg border border-dashed border-line bg-surface p-8 text-center text-sm text-muted">
          Chưa có luật giá nào. Không có bảng giá thì lưới đặt sân hiện giá 0đ.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rules.map((rule, index) => (
            <li
              key={index}
              className={`rounded-token-lg border bg-surface p-3 shadow-nang-1 ${
                rule.isPeak ? "border-peak-line" : "border-line"
              }`}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Áp cho">
                  <select
                    value={rule.courtId ?? ""}
                    onChange={(e) => update(index, { courtId: e.target.value || null })}
                    className="h-10 w-full rounded-token-md border border-line bg-surface px-2 text-sm"
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
                    className="h-10 w-full rounded-token-md border border-line bg-surface px-2 text-sm tabular-nums"
                  />
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-3">
                <div className="flex items-center gap-1.5">
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
                        className={`h-8 w-9 rounded-token-sm border text-xs font-semibold transition ${
                          on
                            ? "border-brand bg-brand text-white"
                            : "border-line bg-surface text-muted hover:border-brand-line"
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

                <label className="flex items-center gap-2 text-sm text-content">
                  <input
                    type="checkbox"
                    checked={rule.isPeak}
                    onChange={(e) => update(index, { isPeak: e.target.checked })}
                    className="h-4 w-4"
                  />
                  Giờ vàng
                </label>

                <label className="flex items-center gap-2 text-sm text-content">
                  Ưu tiên
                  <input
                    type="number"
                    value={rule.priority}
                    onChange={(e) => update(index, { priority: Number(e.target.value) })}
                    className="h-8 w-16 rounded-token-sm border border-line bg-surface px-2 text-sm tabular-nums"
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

      <form action={save} className="mt-4">
        <input type="hidden" name="rules" value={JSON.stringify(rules)} />
        <SaveButton />
      </form>
    </section>
  );
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
      className="h-10 w-full rounded-token-md border border-line bg-surface px-2 text-sm tabular-nums"
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
    <Button type="submit" disabled={pending} className="shadow-chon">
      {pending ? "Đang lưu…" : "Lưu bảng giá"}
    </Button>
  );
}
