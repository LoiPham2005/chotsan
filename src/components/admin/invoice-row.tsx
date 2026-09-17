"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  markInvoicePaidAction,
  waiveInvoiceAction,
  type InvoiceState,
} from "@/app/(admin)/invoices/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { formatVnd } from "@/lib/slots";

export type InvoiceItem = {
  id: string;
  number: string;
  venueName: string;
  venueArea: string;
  period: string;
  dueDate: string;
  overdueDays: number;
  bookingCount: number;
  grossRevenue: number;
  commissionRate: number;
  commissionAmount: number;
  status: string;
};

/** Trạng thái còn phải thu — chỉ những hoá đơn này mới có thao tác. */
function isCollectible(status: string): boolean {
  return status === "DUE" || status === "OVERDUE";
}

const CLOSED_LABEL: Record<string, string> = {
  PAID: "Đã thu tiền",
  WAIVED: "Đã miễn",
};

/**
 * Một hoá đơn hoa hồng trong màn đối soát.
 *
 * ---
 * SỐ TIỀN PHẢI THU ĐỨNG TO NHẤT, DOANH THU GỐC ĐỨNG NHỎ
 *
 * Người đối soát đi tìm một con số trong sao kê: khoản hoa hồng. Doanh thu gốc
 * chỉ để họ tin con số đó đúng, nên nó là chú thích chứ không phải tiêu đề.
 *
 * ---
 * SỐ NGÀY QUÁ HẠN ĐỨNG CẠNH TÊN SÂN
 *
 * Quá 30 ngày là ngưỡng khoá sân. Bắt người đối soát tự trừ ngày từ hạn trả là
 * chỗ chắc chắn sẽ tính nhầm.
 *
 * ---
 * NÚT THEO TRẠNG THÁI
 *
 * Chỉ hoá đơn còn phải thu (Đang chờ, Quá hạn) mới có "Đã thu được tiền" và
 * "Miễn hoá đơn". Trước đây tab "Đã thu" cũng hiện hai nút đó, bấm lại vẫn báo
 * "đã ghi nhận" như thể vừa thu thêm một lần.
 */
export function InvoiceRow({ invoice }: { invoice: InvoiceItem }) {
  const [paidState, markPaid] = useActionState<InvoiceState, FormData>(markInvoicePaidAction, {});
  const [waiveState, waive] = useActionState<InvoiceState, FormData>(waiveInvoiceAction, {});
  const [showWaive, setShowWaive] = useState(false);

  const done = paidState.ok ?? waiveState.ok;
  if (done) {
    return (
      <li className="rounded-token-lg border border-brand-line bg-brand-tint p-4">
        <p className="font-semibold text-brand-text">
          {invoice.number} — {done}
        </p>
      </li>
    );
  }

  const collectible = isCollectible(invoice.status);
  const late = collectible && invoice.overdueDays > 0;

  return (
    // Trễ hạn là "quá hạn" — màu ĐỎ (SKILL.md §2: đỏ = lỗi, sắp hết), không cam.
    // Tới ngưỡng khoá sân (≥30 ngày) thì cả viền thẻ đỏ; trễ ít hơn chỉ tô số ngày.
    <li
      className={`rounded-token-lg border bg-surface p-4 ${
        invoice.overdueDays >= 30 ? "border-danger-line" : "border-line"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-content">{invoice.venueName}</p>
          <p className="truncate text-sm text-muted">
            {invoice.venueArea} · <span className="font-mono text-xs">{invoice.number}</span>
          </p>
        </div>

        <div className="text-right">
          <p className="text-2xl font-bold tabular-nums text-content">
            {formatVnd(invoice.commissionAmount)}
          </p>
          <p className="text-xs text-muted">
            {invoice.commissionRate}% của {formatVnd(invoice.grossRevenue)}
          </p>
        </div>
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-line pt-3 text-sm">
        <Item label="Kỳ">{invoice.period}</Item>
        <Item label="Số lượt">{invoice.bookingCount}</Item>
        <Item label="Hạn trả">{invoice.dueDate}</Item>
        {late && (
          <Item label="Quá hạn">
            <span className="font-bold text-danger-text">
              {invoice.overdueDays} ngày
              {invoice.overdueDays >= 30 && " — tới ngưỡng khoá sân"}
            </span>
          </Item>
        )}
      </dl>

      {(paidState.error ?? waiveState.error) && (
        <Notice tone="danger" role="alert" className="mt-3">
          {paidState.error ?? waiveState.error}
        </Notice>
      )}

      {collectible ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <form action={markPaid}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <PaidButton />
          </form>

          {!showWaive && (
            <Button type="button" variant="outline" onClick={() => setShowWaive(true)}>
              Miễn hoá đơn
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm font-medium text-muted">
          {CLOSED_LABEL[invoice.status] ?? invoice.status}
        </p>
      )}

      {collectible && showWaive && (
        <form action={waive} className="mt-3 rounded-token-md border border-line bg-elevated p-3">
          <input type="hidden" name="invoiceId" value={invoice.id} />

          <label htmlFor={`w-${invoice.id}`} className="text-sm font-semibold text-content">
            Lý do miễn — đây là tiền nền tảng tự bỏ
          </label>
          {/* Báo lỗi thì dựng lại đúng lý do vừa gõ: React 19 đã xoá trắng form. */}
          <Input
            id={`w-${invoice.id}`}
            name="reason"
            required
            minLength={4}
            maxLength={300}
            placeholder="Ví dụ: đối tác chiến lược, miễn 3 tháng đầu"
            defaultValue={waiveState.reason}
            className="mt-1.5 bg-surface"
          />

          <div className="mt-2 flex gap-2">
            <WaiveButton />
            <Button type="button" variant="ghost" onClick={() => setShowWaive(false)}>
              Thôi
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium text-content">{children}</dd>
    </div>
  );
}

function PaidButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Đang ghi…" : "Đã thu được tiền"}
    </Button>
  );
}
function WaiveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending}>
      {pending ? "Đang lưu…" : "Xác nhận miễn"}
    </Button>
  );
}
