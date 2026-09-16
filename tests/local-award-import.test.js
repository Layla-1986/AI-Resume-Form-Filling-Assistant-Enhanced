const test = require("node:test");
const assert = require("node:assert/strict");

const awardImport = require("../shared/local-award-import.js");

test("description enrichment works for arbitrary awards without built-in personal award names", () => {
  const source = {
    personal: { name: "测试" },
    awards: [
      { name: "示例创新竞赛", description: "", level: "省级", rank: "二等奖" },
      { name: "示例荣誉", description: "", level: "校级", rank: "" },
      { name: "已有描述奖项", description: "自己的描述", level: "国家级" },
      { name: "", description: "", level: "校级" },
    ],
  };
  const result = awardImport.fillAwardDescriptions(source);
  assert.equal(result.updated, 2);
  assert.equal(result.profile.awards.length, 4);
  assert.equal(
    result.profile.awards[0].description,
    "获得“示例创新竞赛”省级二等奖，相关成果经评审获得认可。"
  );
  assert.equal(
    result.profile.awards[1].description,
    "获得“示例荣誉”校级，相关成果经评审获得认可。"
  );
  assert.equal(result.profile.awards[2].description, "自己的描述");
  assert.equal(result.profile.awards[3].description, "");
  assert.equal(source.awards[0].description, "");
  assert.equal(result.profile.personal.name, "测试");
  assert.equal(awardImport.fillAwardDescriptions(result.profile).updated, 0);
});

function createFakeStorage(initial = {}) {
  const state = { ...initial };
  return {
    state,
    storage: {
      local: {
        async get(key) {
          return { [key]: state[key] };
        },
        async set(values) {
          Object.assign(state, values);
        },
      },
    },
  };
}

test("one-time award import prepends missing awards and keeps existing awards", async () => {
  const fake = createFakeStorage();
  const saves = [];
  const resumeStorage = {
    async loadResumeData() {
      return {
        profile: {
          awards: [
            { awardDate: "2024-06", name: "已有奖项", level: "省级", rank: "一等奖" },
            { awardDate: "2023-05", name: "三维时空杯", level: "国家级", rank: "优秀奖" },
          ],
        },
        schemaVersion: 6,
        rawText: "旧文本",
      };
    },
    async saveResumeData(value) {
      saves.push(value);
    },
  };
  const schema = {
    version: 6,
    normalizeResumeProfile(profile) {
      return profile;
    },
  };
  const awards = [
    { awardDate: "2023-05", name: "三维时空杯", level: "国家级", rank: "优秀奖" },
    { awardDate: "2022-09", name: "互联网+大赛", level: "省级", rank: "铜奖" },
  ];

  const result = await awardImport.applyOneTimeAwardImport({
    resumeStorage,
    schema,
    storage: fake.storage,
    flagKey: "awardSeedApplied",
    awards,
  });

  assert.deepEqual(saves[0].profile.awards, [
    { awardDate: "2022-09", name: "互联网+大赛", level: "省级", rank: "铜奖" },
    { awardDate: "2024-06", name: "已有奖项", level: "省级", rank: "一等奖" },
    { awardDate: "2023-05", name: "三维时空杯", level: "国家级", rank: "优秀奖" },
  ]);
  assert.equal(saves[0].rawText, "旧文本");
  assert.equal(fake.state.awardSeedApplied, true);
  assert.deepEqual(result, { applied: true, added: 1 });
});

test("one-time award import does nothing after its flag is stored", async () => {
  const fake = createFakeStorage({ awardSeedApplied: true });
  let loadCount = 0;

  const result = await awardImport.applyOneTimeAwardImport({
    resumeStorage: {
      async loadResumeData() {
        loadCount += 1;
        return {};
      },
    },
    schema: {},
    storage: fake.storage,
    flagKey: "awardSeedApplied",
    awards: [{ awardDate: "2023-05", name: "三维时空杯" }],
  });

  assert.deepEqual(result, { applied: false, added: 0 });
  assert.equal(loadCount, 0);
});
