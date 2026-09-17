"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  submitForReviewAction,
  updateBankAction,
  updateHoursAction,
  updateVenueAction,
  type SettingsState,
} from "@/app/(manage)/manage/[venueId]/settings/actions";
import { Button } from "@/components/ui/button";
import { fieldClassName, Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/cn";
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

export type ReviewChecklistItem = {
  key: "hours" | "courts" | "pricing" | "bank";
  label: string;
  done: boolean;
};

/**
 * Ngày chưa khai giờ trong database. Khởi tạo là ĐÓNG CỬA — khớp đúng cách lưới
 * đặt sân hiểu ("chưa khai = đóng cửa") và khớp câu hướng dẫn trên màn.
 *
 * Lỗi thật trước đây: khởi tạo là mở 06:00–22:00, nên chủ sân chỉ sửa giờ Thứ 2
 * rồi bấm Lưu là mở bán luôn cả những ngày họ chưa hề khai. Giờ 06:00–22:00 vẫn
 * giữ làm gợi ý sẵn khi họ tự tick "Mở cửa".
 */
export function initialHourRows(saved: HourRow[]): HourRow[] {
  return ORDER.map(
    (weekday) =>
      saved.find((hour) => hour.weekday === weekday) ?? {
        weekday,
        openMinute: 6 * 60,
        closeMinute: 22 * 60,
        isClosed: true,
      },
  );
}

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

/**
 * Trạng thái hồ sơ ở đầu trang cài đặt.
 *
 * - Bản nháp: danh sách việc phải xong (cùng một phép tính với chốt chặn của
 *   `setStatus` — xem `VenueService.readiness`), lý do nền tảng trả hồ sơ nếu
 *   có, và nút "Gửi duyệt".
 * - Chờ duyệt: nói rõ đang chờ, vẫn sửa được.
 * - Bị khoá: nói rõ là bị khoá và lý do, để không nhầm với bị trả hồ sơ.
 * - Còn lại: không hiện gì.
 */
export function VenueReviewPanel({
  venueId,
  status,
  inactiveNote,
  items,
  ready,
}: {
  venueId: string;
  status: string;
  inactiveNote: string | null;
  items: ReviewChecklistItem[];
  ready: boolean;
}) {
  const [state, submit] = useActionState<SettingsState, FormData>(
    submitForReviewAction.bind(null, venueId),
    {},
  );

  if (status === "PENDING") {
    return (
      <section
        aria-labelledby="review-heading"
        className="rounded-token-lg border border-line bg-surface p-4 sm:p-5"
      >
        <h2 id="review-heading" className="text-lg font-bold text-content">
          Hồ sơ đang chờ duyệt
        </h2>
        <p className="mt-1 text-sm text-muted">
          ChốtSân đang xem hồ sơ của bạn. Trong lúc chờ bạn vẫn sửa được thông tin, sân con và bảng
          giá; duyệt xong khách mới đặt được sân.
        </p>
      </section>
    );
  }

  if (status === "ADMIN_LOCKED") {
    return (
      <Notice tone="danger" role="alert">
        Cơ sở đang bị ChốtSân khoá{inactiveNote ? `: ${inactiveNote}` : ""}. Liên hệ quản trị viên
        để được xử lý.
      </Notice>
    );
  }

  if (status !== "DRAFT") return null;

  return (
    <section
      aria-labelledby="review-heading"
      className="rounded-token-lg border border-brand-line bg-surface p-4 sm:p-5"
    >
      <h2 id="review-heading" className="text-lg font-bold text-content">
        Hoàn tất hồ sơ để gửi duyệt
      </h2>
      <p className="mt-1 text-sm text-muted">
        Cơ sở đang là bản nháp — khách chưa thấy. Làm xong các mục dưới đây rồi gửi ChốtSân duyệt.
      </p>

      {/* Đỏ nhạt: hồ sơ bị trả về là việc PHẢI sửa trước khi gửi lại. */}
      {inactiveNote && (
        <Notice tone="danger" className="mt-3">
          <strong>Hồ sơ bị trả về:</strong> {inactiveNote}. Sửa theo lý do này rồi gửi duyệt lại
          giúp bạn nhé.
        </Notice>
      )}

      <ul className="mt-3 divide-y divide-line rounded-token-md border border-line">
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
            <span
              aria-hidden
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                item.done ? "bg-brand text-white" : "border border-line-strong text-subtle"
              }`}
            >
              {item.done ? "✓" : ""}
            </span>
            {/* `min-w-[9rem]`: màn hẹp thì chữ "Còn thiếu — …" xuống dòng riêng,
                không bóp tên mục thành bốn dòng mỗi dòng một chữ. */}
            <span className="min-w-[9rem] flex-1 text-sm font-medium text-content">
              {item.label.charAt(0).toUpperCase() + item.label.slice(1)}
            </span>
            {/* Liên kết "Còn thiếu" chỉ cao một dòng chữ (20px) — nới vùng bấm
                12px trên dưới bằng lớp giả trong suốt cho đủ 44px, như nút `sm`,
                mà dòng checklist không cao lên. */}
            {item.done ? (
              <span className="text-sm font-semibold text-brand-text">Đã xong</span>
            ) : item.key === "courts" || item.key === "pricing" ? (
              // Đường dẫn viết thẳng dạng mẫu chữ (không qua hàm trả `string`) để
              // `typedRoutes` còn kiểm được lúc build.
              <Link
                href={`/manage/${venueId}/courts`}
                className="relative text-sm font-semibold text-content underline underline-offset-4 after:absolute after:inset-x-0 after:-inset-y-3"
              >
                Còn thiếu — khai ở Sân &amp; giá
              </Link>
            ) : (
              <a
                href={item.key === "hours" ? "#hours" : "#bank"}
                className="relative text-sm font-semibold text-content underline underline-offset-4 after:absolute after:inset-x-0 after:-inset-y-3"
              >
                Còn thiếu — khai bên dưới
              </a>
            )}
          </li>
        ))}
      </ul>

      {state.error && (
        <Notice tone="danger" role="alert" className="mt-3">
          {state.error}
        </Notice>
      )}

      <form action={submit} className="mt-4">
        <SubmitForReviewButton ready={ready} />
      </form>
    </section>
  );
}

function ProfileBlock({ venueId, venue }: { venueId: string; venue: VenueSettingsData }) {
  const [state, save] = useActionState<SettingsState, FormData>(
    updateVenueAction.bind(null, venueId),
    {},
  );

  // Báo lỗi thì dựng lại form bằng đúng chữ vừa gõ (React 19 đã xoá trắng form);
  // lưu xong thì dùng dữ liệu mới của máy chủ.
  const value = (key: string, saved: string) => state.values?.[key] ?? saved;

  return (
    <Block title="Hồ sơ sân" state={state}>
      <form action={save} className="grid gap-3">
        <Row label="Tên sân">
          <Input name="name" required defaultValue={value("name", venue.name)} maxLength={120} />
        </Row>

        <Row label="Giới thiệu">
          <textarea
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={value("description", venue.description ?? "")}
            placeholder="Số sân, loại mặt sân, đèn, chỗ để xe…"
            className={cn(fieldClassName, "py-2")}
          />
        </Row>

        <div className="grid gap-3 sm:grid-cols-3">
          <Row label="Số nhà, đường">
            <Input name="address" required defaultValue={value("address", venue.address)} />
          </Row>
          <Row label="Phường/xã">
            <Input name="ward" required defaultValue={value("ward", venue.ward)} />
          </Row>
          <Row label="Tỉnh/thành">
            <Input name="province" required defaultValue={value("province", venue.province)} />
          </Row>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Điện thoại">
            <Input
              name="phone"
              type="tel"
              defaultValue={value("phone", venue.phone ?? "")}
              placeholder="0987654321"
            />
          </Row>
          <Row label="Tiện ích" hint="ngăn nhau bằng dấu phẩy">
            <Input
              name="amenities"
              defaultValue={value("amenities", venue.amenities.join(", "))}
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
              value={value("holdMinutes", String(venue.holdMinutes ?? 10))}
            />
          </Row>
          <Row label="Huỷ miễn phí trước (giờ)">
            <NumberInput
              name="freeCancelHours"
              min={0}
              max={168}
              step={1}
              value={value("freeCancelHours", String(venue.freeCancelHours ?? 2))}
            />
          </Row>
          <Row label="Phí huỷ trễ (%)" hint="100 = mất trắng">
            <NumberInput
              name="cancelFeePercent"
              min={0}
              max={100}
              step={5}
              value={value("cancelFeePercent", String(venue.cancelFeePercent ?? 100))}
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
  const [rows, setRows] = useState<HourRow[]>(() => initialHourRows(initial));
  // Bảng giờ nằm trong state của React, NGOÀI thẻ form (form chỉ mang ô ẩn),
  // nên lưu báo lỗi thì React 19 xoá trắng form cũng không mất giờ đang sửa.
  const [state, save] = useActionState<SettingsState, FormData>(
    updateHoursAction.bind(null, venueId),
    {},
  );

  const update = (weekday: number, patch: Partial<HourRow>) =>
    setRows((prev) => prev.map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)));

  return (
    <Block id="hours" title="Giờ mở cửa" state={state}>
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

            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={!row.isClosed}
                onChange={(e) => update(row.weekday, { isClosed: !e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              Mở cửa
            </label>

            {row.isClosed ? (
              <span className="text-sm text-subtle">Nghỉ cả ngày</span>
            ) : (
              <span className="flex items-center gap-2">
                <TimeSelect
                  label={`${WEEKDAY_NAMES[row.weekday]} mở cửa lúc`}
                  value={row.openMinute}
                  onChange={(v) => update(row.weekday, { openMinute: v })}
                />
                <span className="text-muted" aria-hidden>
                  →
                </span>
                <TimeSelect
                  label={`${WEEKDAY_NAMES[row.weekday]} đóng cửa lúc`}
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

  const bankName = state.values?.bankName ?? venue.bankName ?? "";

  return (
    <Block id="bank" title="Tài khoản nhận tiền" state={state}>
      {/* ĐỎ nhạt, không cam, không emoji: sai ở đây là mất tiền thật — đúng nghĩa
          "nguy hiểm" của màu đỏ (SKILL.md §2); cam chỉ nói giờ vàng. */}
      <Notice tone="danger" className="-mt-1 mb-3">
        <strong>Kiểm tra kỹ trước khi lưu.</strong> Mã QR khách quét dựng từ đúng ba ô này. Sai một
        số là tiền vào tài khoản người khác, và không có cách nào lấy lại.
      </Notice>

      <form action={save} className="grid gap-3 sm:grid-cols-3">
        <Row label="Ngân hàng">
          {/* `key`: select không nhận `defaultValue` mới sau lần dựng đầu — dựng
              lại để giữ đúng ngân hàng vừa chọn khi báo lỗi. */}
          <select
            key={bankName}
            name="bankName"
            defaultValue={bankName}
            className={cn(fieldClassName, "h-11 cursor-pointer")}
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
            defaultValue={state.values?.bankAccountNumber ?? venue.bankAccountNumber ?? ""}
          />
        </Row>

        <Row label="Chủ tài khoản" hint="viết HOA, không dấu">
          <Input
            name="bankAccountName"
            defaultValue={state.values?.bankAccountName ?? venue.bankAccountName ?? ""}
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
  id,
  title,
  state,
  children,
}: {
  id?: string;
  title: string;
  state: SettingsState;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 rounded-token-lg border border-line bg-surface p-4 sm:p-5"
    >
      <h2 className="mb-3 text-lg font-bold text-content">{title}</h2>

      {state.error && (
        <Notice tone="danger" role="alert" className="mb-3">
          {state.error}
        </Notice>
      )}
      {state.ok && (
        <p role="status" className="mb-3 text-sm font-semibold text-brand-text">
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
  value: string;
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
      className={cn(fieldClassName, "h-11 tabular-nums")}
    />
  );
}

function TimeSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={cn(fieldClassName, "h-11 w-auto cursor-pointer tabular-nums")}
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

function SubmitForReviewButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || !ready}>
      {pending ? "Đang gửi…" : ready ? "Gửi duyệt" : "Làm xong các mục trên để gửi duyệt"}
    </Button>
  );
}
