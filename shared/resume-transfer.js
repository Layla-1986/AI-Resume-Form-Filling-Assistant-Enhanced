(function initResumeTransfer(root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.ResumeTransfer = Object.freeze(api);
  }
})(typeof window !== "undefined" ? window : globalThis, function createResumeTransfer(root) {
  "use strict";

  const FORMAT = "ai-resume-form-filling-assistant/resume-backup";
  const FORMAT_VERSION = 1;

  function createTransferPayload({
    profile,
    schemaVersion,
    rawText,
    exportedAt = new Date().toISOString(),
  }) {
    return {
      format: FORMAT,
      formatVersion: FORMAT_VERSION,
      exportedAt,
      schemaVersion,
      profile: profile && typeof profile === "object" ? profile : {},
      rawText: String(rawText || ""),
    };
  }

  function parseTransferPayload(input) {
    let payload;
    try {
      payload = typeof input === "string" ? JSON.parse(input) : input;
    } catch (_) {
      throw new Error("备份文件不是有效的 JSON");
    }

    if (
      !payload ||
      typeof payload !== "object" ||
      Array.isArray(payload) ||
      payload.format !== FORMAT ||
      payload.formatVersion !== FORMAT_VERSION ||
      !payload.profile ||
      typeof payload.profile !== "object" ||
      Array.isArray(payload.profile)
    ) {
      throw new Error("这不是本插件导出的简历备份");
    }

    return {
      schemaVersion: payload.schemaVersion,
      profile: payload.profile,
      rawText: String(payload.rawText || ""),
    };
  }

  function downloadTransferPayload(
    payload,
    filenamePrefix = "resume-backup",
    environment = root,
    now = new Date().toISOString()
  ) {
    const { document, Blob, URL, setTimeout } = environment || {};
    if (!document?.createElement || !document?.body || !Blob || !URL) {
      throw new Error("当前环境不支持下载备份文件");
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    const filename = `${filenamePrefix}-${stamp}.json`;
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return filename;
  }

  return {
    FORMAT,
    FORMAT_VERSION,
    createTransferPayload,
    parseTransferPayload,
    downloadTransferPayload,
  };
});
