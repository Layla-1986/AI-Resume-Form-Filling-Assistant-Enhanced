const test = require("node:test");
const assert = require("node:assert/strict");

const transfer = require("../shared/resume-transfer.js");

test("export payload preserves the stored resume profile and raw text", () => {
  const profile = {
    personal: { name: "测试用户" },
    campus: [{ category: "竞赛", organization: "智能车竞赛" }],
  };

  const payload = transfer.createTransferPayload({
    profile,
    schemaVersion: 5,
    rawText: "原始简历文本",
    exportedAt: "2026-09-02T00:00:00.000Z",
  });

  assert.deepEqual(payload, {
    format: "ai-resume-form-filling-assistant/resume-backup",
    formatVersion: 1,
    exportedAt: "2026-09-02T00:00:00.000Z",
    schemaVersion: 5,
    profile,
    rawText: "原始简历文本",
  });
});

test("import parser accepts a valid backup and returns only resume data", () => {
  const parsed = transfer.parseTransferPayload(
    JSON.stringify({
      format: "ai-resume-form-filling-assistant/resume-backup",
      formatVersion: 1,
      exportedAt: "2026-09-02T00:00:00.000Z",
      schemaVersion: 5,
      profile: { personal: { name: "测试用户" } },
      rawText: "原始简历文本",
    })
  );

  assert.deepEqual(parsed, {
    schemaVersion: 5,
    profile: { personal: { name: "测试用户" } },
    rawText: "原始简历文本",
  });
});

test("import parser rejects unrelated or malformed JSON", () => {
  assert.throws(
    () => transfer.parseTransferPayload('{"profile":{}}'),
    /不是本插件导出的简历备份/
  );
  assert.throws(
    () => transfer.parseTransferPayload("not-json"),
    /备份文件不是有效的 JSON/
  );
});

test("download helper writes a JSON file and releases its object URL", () => {
  const actions = [];
  let blobParts;
  const link = {
    click() {
      actions.push("click");
    },
    remove() {
      actions.push("remove");
    },
  };
  const environment = {
    document: {
      createElement(tag) {
        assert.equal(tag, "a");
        return link;
      },
      body: {
        appendChild(value) {
          assert.equal(value, link);
          actions.push("append");
        },
      },
    },
    Blob: class FakeBlob {
      constructor(parts, options) {
        blobParts = parts;
        assert.equal(options.type, "application/json;charset=utf-8");
      }
    },
    URL: {
      createObjectURL() {
        actions.push("create-url");
        return "blob:resume-backup";
      },
      revokeObjectURL(url) {
        assert.equal(url, "blob:resume-backup");
        actions.push("revoke-url");
      },
    },
    setTimeout(callback) {
      callback();
    },
  };
  const payload = transfer.createTransferPayload({
    profile: { personal: { name: "测试用户" } },
    schemaVersion: 5,
    rawText: "",
    exportedAt: "2026-09-02T00:00:00.000Z",
  });

  const filename = transfer.downloadTransferPayload(
    payload,
    "resume-backup",
    environment,
    "2026-09-02T01:02:03.456Z"
  );

  assert.equal(filename, "resume-backup-2026-09-02T01-02-03-456Z.json");
  assert.equal(link.href, "blob:resume-backup");
  assert.equal(link.download, filename);
  assert.deepEqual(actions, ["create-url", "append", "click", "remove", "revoke-url"]);
  assert.deepEqual(JSON.parse(blobParts.join("")), payload);
});
