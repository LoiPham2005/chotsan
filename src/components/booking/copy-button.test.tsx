import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CopyButton, copyText } from "./copy-button";

/**
 * Nút "Chép" là chỗ khách lấy nội dung chuyển khoản. Lỗi thật trước đây: mở
 * trang qua HTTP bằng IP LAN (không có `navigator.clipboard`) thì bấm "Chép"
 * KHÔNG có phản hồi gì — khách tưởng đã chép, dán vào app ngân hàng thì trống.
 */

function setClipboard(writeText: ((value: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function setExecCommand(result: boolean | undefined) {
  Object.defineProperty(document, "execCommand", {
    value: result === undefined ? undefined : vi.fn(() => result),
    configurable: true,
  });
}

afterEach(() => {
  setClipboard(undefined);
  setExecCommand(undefined);
  window.getSelection()?.removeAllRanges();
});

describe("copyText", () => {
  it("có Clipboard API thì dùng nó, không đụng đường cũ", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    setClipboard(writeText);
    setExecCommand(true);

    expect(await copyText("CS DXWQE3")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("CS DXWQE3");
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("KHÔNG có Clipboard API (HTTP qua IP LAN) thì chép bằng textarea ẩn", async () => {
    setClipboard(undefined);
    setExecCommand(true);

    expect(await copyText("CS DXWQE3")).toBe("copied");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    // Textarea tạm phải được gỡ khỏi trang sau khi chép.
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("Clipboard API từ chối (không có quyền) thì vẫn thử đường cũ", async () => {
    setClipboard(() => Promise.reject(new Error("NotAllowedError")));
    setExecCommand(true);

    expect(await copyText("1234567890")).toBe("copied");
  });

  it("mọi đường đều hỏng thì báo phải chép tay — không giả vờ đã chép", async () => {
    setClipboard(undefined);
    setExecCommand(false);
    expect(await copyText("1234567890")).toBe("manual");

    // Trình duyệt không có cả `execCommand`.
    setExecCommand(undefined);
    expect(await copyText("1234567890")).toBe("manual");
  });
});

describe("CopyButton", () => {
  it("chép được thì đổi chữ nút thành 'Đã chép ✓'", async () => {
    setClipboard(() => Promise.resolve());
    render(<CopyButton value="CS DXWQE3" label="nội dung chuyển khoản" />);

    fireEvent.click(screen.getByRole("button", { name: "Sao chép nội dung chuyển khoản" }));

    expect(await screen.findByText("Đã chép ✓")).toBeInTheDocument();
  });

  it("không chép tự động được: HIỆN lời nhắc và bôi chọn sẵn dòng chữ trên trang", async () => {
    setClipboard(undefined);
    setExecCommand(false);
    render(
      <p>
        <span id="transfer-note">CS DXWQE3</span>
        <CopyButton value="CS DXWQE3" label="nội dung chuyển khoản" targetId="transfer-note" />
      </p>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sao chép nội dung chuyển khoản" }));

    expect(await screen.findByText("Không chép tự động được — hãy nhấn giữ để chép")).toBeVisible();
    expect(window.getSelection()?.toString()).toBe("CS DXWQE3");
  });
});
