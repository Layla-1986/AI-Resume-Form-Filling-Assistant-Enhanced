const test = require("node:test");
const assert = require("node:assert/strict");

const repeatExpansion = require("../shared/repeat-expansion.js");

function repeatedFields(sectionKey, count, labels) {
  return Array.from({ length: count }, () =>
    labels.map((label) => ({ sectionKey, label }))
  ).flat();
}

test("desired record counts ignore empty resume placeholders", () => {
  const counts = repeatExpansion.getDesiredRecordCounts({
    awards: [
      { name: "三维时空杯", rank: "优秀奖" },
      { name: "", rank: "" },
      { name: "互联网+", rank: "铜奖" },
    ],
    internships: [{ company: "某公司" }, {}],
  });

  assert.equal(counts.award, 2);
  assert.equal(counts.internship, 1);
});

test("rendered record counts use repeated labels within each section", () => {
  const counts = repeatExpansion.countRenderedRecords([
    ...repeatedFields("award", 3, ["获奖时间", "奖项名称", "获奖描述"]),
    ...repeatedFields("internship", 2, ["公司名称", "职位名称"]),
  ]);

  assert.equal(counts.award, 3);
  assert.equal(counts.internship, 2);
});

test("add button matching rejects another section and dangerous actions", () => {
  const candidates = [
    { id: "education", text: "新增教育经历", context: "教育经历" },
    { id: "submit", text: "提交", context: "获奖情况" },
    { id: "award", text: "+", context: "获奖情况 新增一条" },
  ];

  assert.equal(
    repeatExpansion.findBestAddCandidate(candidates, "award")?.id,
    "award"
  );
  assert.equal(
    repeatExpansion.findBestAddCandidate(candidates, "internship"),
    null
  );
});

test("repeat add selector includes Beisen div controls identified by addButton ids", () => {
  assert.match(
    String(repeatExpansion.REPEAT_ADD_CONTROL_SELECTOR || ""),
    /\[id\$="_addButton"\]/
  );
});

test("expansion adds records until resume and page counts match", async () => {
  const counts = { award: 1, internship: 1 };
  const clicked = [];
  const fieldsForState = () => [
    ...repeatedFields("award", counts.award, ["获奖时间", "奖项名称"]),
    ...repeatedFields("internship", counts.internship, ["公司名称", "职位名称"]),
  ];

  const result = await repeatExpansion.expandRepeatedSections({
    profile: {
      awards: [{ name: "A" }, { name: "B" }, { name: "C" }],
      internships: [{ company: "甲" }, { company: "乙" }],
    },
    scan: fieldsForState,
    listCandidates(sectionKey) {
      return sectionKey === "award"
        ? [{ id: "award-add", text: "新增获奖经历", context: "获奖情况" }]
        : [{ id: "intern-add", text: "+", context: "实习经历 添加一条" }];
    },
    async clickCandidate(candidate, sectionKey) {
      clicked.push(candidate.id);
      counts[sectionKey] += 1;
    },
    async waitForGrowth() {},
  });

  assert.deepEqual(clicked.sort(), ["award-add", "award-add", "intern-add"]);
  assert.equal(result.totalClicked, 3);
  assert.deepEqual(result.expanded, { award: 2, internship: 1 });
  assert.deepEqual(result.unresolved, []);
});

test("expansion stops a section when clicking does not create a record", async () => {
  let clickCount = 0;
  const result = await repeatExpansion.expandRepeatedSections({
    profile: { awards: [{ name: "A" }, { name: "B" }, { name: "C" }] },
    scan: () => repeatedFields("award", 1, ["获奖时间", "奖项名称"]),
    listCandidates: () => [
      { id: "award-add", text: "新增获奖经历", context: "获奖情况" },
    ],
    async clickCandidate() {
      clickCount += 1;
    },
    async waitForGrowth() {},
  });

  assert.equal(clickCount, 1);
  assert.deepEqual(result.unresolved, [
    { sectionKey: "award", desired: 3, current: 1, reason: "no-growth" },
  ]);
});
