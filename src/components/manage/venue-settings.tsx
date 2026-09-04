"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  updateBankAction,
  updateHoursAction,
  updateVenueAction,
  type SettingsState,
} from "@/app/(manage)/manage/[venueId]/settings/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatHhMm } from "@/lib/slots";

const WEEKDAY_NAMES = ["Chủ nhật", "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7"];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const MINUTES = Array.from({ length: 49 }, (_, i) => i * 30);

export type VenueSettingsData = {
  name: string;
  description: string | null;
  address: string;
  ward: string;
  province: string;
  phone: string | null;
  amenities: string[];
  holdMinutes: number | null;
  freeCancelHours: number | null;
  cancelFeePercent: number | null;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountName: string | null;
};

export type HourRow = {
  weekday: number;
  openMinute: number;
  closeMinute: number;
  isClosed: boolean;
};

/** Ba khối rời, ba nút Lưu riêng — sửa giờ mở cửa không phải lưu lại cả hồ sơ. */
export function VenueSettings({
  venueId,
  venue,
  hours,
  banks,
}: {
  venueId: string;
  venue: VenueSettingsData;
  hours: HourRow[];
  banks: string[];
}) {
  return (
    <div className="space-y-8">
      <ProfileBlock venueId={venueId} venue={venue} />
      <HoursBlock venueId={venueId} initial={hours} />
      <BankBlock venueId={venueId} venue={venue} banks={banks} />
    </div>
  );
}

function ProfileBlock({ venueId, venue }: { venueId: string; venue: VenueSettingsData }) {
  const [state, save] = useActionState<SettingsState, FormData>(
    updateVenueAction.bind(null, venueId),
    {},
  );

  return (
    <Block title="Hồ sơ sân" state={state}>
      <form action={save} className="grid gap-3">
        <Row label="Tên sân">
          <Input name="name" required defaultValue={venue.name} maxLength={120} />
        </Row>

        <Row label="Giới thiệu">
          <textarea
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={venue.description ?? ""}
            placeholder="Số sân, loại mặt sân, đèn, chỗ để xe…"
            className="w-full rounded-token-md border border-line bg-surface p-2 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60"
          />
        </Row>

        <div className="grid gap-3 sm:grid-cols-3">
          <Row label="Số nhà, đường">
            <Input name="address" required defaultValue={venue.address} />
          </Row>
          <Row label="Phường/xã">
            <Input name="ward" required defaultValue={venue.ward} />
          </Row>
          <Row label="Tỉnh/thành">
            <Input name="province" required defaultValue={venue.province} />
          </Row>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Điện thoại">
            <Input
              name="phone"
              type="tel"
              defaultValue={venue.phone ?? ""}
              placeholder="0987654321"
            />
          </Row>
          <Row label="Tiện ích" hint="ngăn nhau bằng dấu phẩy">
            <Input
              name="amenities"
              defaultValue={venue.amenities.join(", ")}
              placeholder="Bãi đỗ xe, Phòng thay đồ, Căng tin"
            />
          </Row>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Row label="Giữ chỗ (phút)" hint="hết hạn thì nhả cho người khác">
            <NumberInput
              name="holdMinutes"
              min={5}
              max={120}
              step={5}
              value={venue.holdMinutes ?? 10}
            />
          </Row>
          <Row label="Huỷ miễn phí trước (giờ)">
            <NumberInput
              name="freeCancelHours"
              min={0}
              max={168}
              step={1}
              value={venue.freeCancelHours ?? 2}
            />
          </Row>
          <Row label="Phí huỷ trễ (%)" hint="100 = mất trắng">
            <NumberInput
              name="cancelFeePercent"
              min={0}
              max={100}
              step={5}
              value={venue.cancelFeePercent ?? 100}
            />
          </Row>
        </div>

        <div>
          <SaveButton />
        </div>
      </form>
    </Block>
  );
}

function HoursBlock({ venueId, initial }: { venueId: string; initial: HourRow[] }) {
  const [rows, setRows] = useState<HourRow[]>(() =>
    ORDER.map(
      (weekday) =>
        initial.find((h) => h.weekday === weekday) ?? {
          weekday,
          openMinute: 6 * 60,
          closeMinute: 22 * 60,
          isClosed: false,
        },
    ),
  );
  const [state, save] = useActionState<SettingsState, FormData>(
    updateHoursAction.bind(null, venueId),
    {},
  );

  const update = (weekday: number, patch: Partial<HourRow>) =>
    setRows((prev) => prev.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)));

  return (
    <Block title="Giờ mở cửa" state={state}>
      <p className="-mt-1 mb-3 text-sm text-muted">
        Ngày chưa khai giờ = <strong>đóng cửa</strong>. Lưới đặt sân không đoán một khung mặc định,
        vì đoán sai là bán ra những giờ sân không có ai trực.
      </p>

      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={row.weekday} className="flex flex-wrap items-center gap-3">
            <span className="w-20 shrink-0 text-sm font-semibold text-content">
              {WEEKDAY_NAMES[row.weekday]}
            </span>

            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={!row.isClosed}
                onChange={(e) => update(row.weekday, { isClosed: !e.target.checked })}
                className="h-4 w-4"
              />
              Mở cửa
            </label>

            {row.isClosed ? (
              <span className="text-sm text-subtle">Nghỉ cả ngày</span>
            ) : (
              <span className="flex items-center gap-2">
                <TimeSelect
                  value={row.openMinute}
                  onChange={(v) => update(row.weekday, { openMinute: v })}
                />
                <span className="text-muted" aria-hidden>
                  →
                </span>
                <TimeSelect
                  value={row.closeMinute}
                  onChange={(v) => update(row.weekday, { closeMinute: v })}
                />
              </span>
            )}
          </li>
        ))}
      </ul>

      <form action={save} className="mt-4">
        <input type="hidden" name="hours" value={JSON.stringify(rows)} />
        <SaveButton />
      </form>
    </Block>
  );
}

function BankBlock({
  venueId,
  venue,
  banks,
}: {
  venueId: string;
  venue: VenueSettingsData;
  banks: string[];
}) {
  const [state, save] = useActionState<SettingsState, FormData>(
    updateBankAction.bind(null, venueId),
    {},
  );

  return (
    <Block title="Tài khoản nhận tiền" state={state}>
      <p className="-mt-1 mb-3 rounded-token-md bg-peak-tint px-3 py-2 text-sm text-peak-text">
        ⚠️ Mã QR khách quét dựng từ đúng ba ô này. Sai một số là tiền vào tài khoản người khác, và
        không có cách nào lấy lại.
      </p>

      <form action={save} className="grid gap-3 sm:grid-cols-3">
        <Row label="Ngân hàng">
          <select
            name="bankName"
            defaultValue={venue.bankName ?? ""}
            className="h-10 w-full rounded-token-md border border-line bg-surface px-2 text-sm"
          >
            <option value="">Chưa khai</option>
            {banks.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Row>

        <Row label="Số tài khoản">
          <Input
            name="bankAccountNumber"
            inputMode="numeric"
            defaultValue={venue.bankAccountNumber ?? ""}
          />
        </Row>

        <Row label="Chủ tài khoản" hint="viết HOA, không dấu">
          <Input
            name="bankAccountName"
            defaultValue={venue.bankAccountName ?? ""}
            placeholder="NGUYEN VAN A"
            className="uppercase"
          />
        </Row>

        <div className="sm:col-span-3">
          <SaveButton />
        </div>
      </form>
    </Block>
  );
}

function Block({
  title,
  state,
  children,
}: {
  title: string;
  state: SettingsState;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-token-lg border border-line bg-surface p-4 shadow-nang-1 sm:p-5">
      <h2 className="mb-3 text-lg font-bold text-content">{title}</h2>

      {state.error && (
        <p role="alert" className="alert alert-danger mb-3">
          {state.error}
        </p>
      )}
      {state.ok && (
        <p role="status" className="mb-3 text-sm font-medium text-brand-hover">
          {state.ok}
        </p>
      )}

      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-subtle">
        {label}
        {hint && <span className="ml-1 font-medium normal-case text-muted">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function NumberInput({
  name,
  value,
  min,
  max,
  step,
}: {
  name: string;
  value: number;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <input
      type="number"
      name={name}
      defaultValue={value}
      min={min}
      max={max}
      step={step}
      className="h-10 w-full rounded-token-md border border-line bg-surface px-2 text-sm tabular-nums"
    />
  );
}

function TimeSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="h-9 rounded-token-md border border-line bg-surface px-2 text-sm tabular-nums"
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
      {pending ? "Đang lưu…" : "Lưu"}
    </Button>
  );
}
