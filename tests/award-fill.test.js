const test = require("node:test");
const assert = require("node:assert/strict");

const awardFill = require("../shared/award-fill.js");

test("award card fields share the correct record index even when description is generic", () => {
  const fields = [
    { fieldId: "f_1", sectionKey: "award", label: "获奖名称*" },
    { fieldId: "f_2", sectionKey: "award", label: "获奖时间" },
    { fieldId: "f_3", sectionKey: "", label: "描述" },
    { fieldId: "f_4", sectionKey: "award", label: "获奖名称*" },
    { fieldId: "f_5", sectionKey: "award", label: "获奖时间" },
    { fieldId: "f_6", sectionKey: "", label: "描述" },
  ];

  awardFill.annotateAwardFields(fields);

  assert.deepEqual(
    fields.map((field) => [field.sectionKey, field.repeatIndex, field.repeatFieldKey]),
    [
      ["award", 0, "name"],
      ["award", 0, "awardDate"],
      ["award", 0, "description"],
      ["award", 1, "name"],
      ["award", 1, "awardDate"],
      ["award", 1, "description"],
    ]
  );
  assert.deepEqual(
    fields.map(awardFill.getDeterministicAwardPath),
    [
      "awards.0.name",
      "awards.0.awardDate",
      "awards.0.description",
      "awards.1.name",
      "awards.1.awardDate",
      "awards.1.description",
    ]
  );
});

test("award name includes level and rank only when the page has no separate fields", () => {
  const profile = {
    awards: [
      { name: "三维时空杯", level: "国家级", rank: "优秀奖" },
      { name: "互联网+", level: "省级", rank: "铜奖" },
    ],
  };

  assert.equal(
    awardFill.resolveAwardNameValue(profile, "awards.0.name", [
      { resumePath: "awards.0.name" },
      { resumePath: "awards.0.awardDate" },
      { resumePath: "awards.0.description" },
    ]),
    "三维时空杯（国家级，优秀奖）"
  );
  assert.equal(
    awardFill.resolveAwardNameValue(profile, "awards.1.name", [
      { resumePath: "awards.1.name" },
      { resumePath: "awards.1.level" },
    ]),
    "互联网+（铜奖）"
  );
  assert.equal(
    awardFill.resolveAwardNameValue(profile, "awards.1.name", [
      { resumePath: "awards.1.name" },
      { resumePath: "awards.1.level" },
      { resumePath: "awards.1.rank" },
    ]),
    "互联网+"
  );
});

test("award neighborhood repair does not steal a description already assigned to another section", () => {
  const fields = [
    { fieldId: "f_1", sectionKey: "award", label: "获奖名称" },
    { fieldId: "f_2", sectionKey: "award", label: "获奖时间" },
    { fieldId: "f_3", sectionKey: "project", label: "描述" },
    { fieldId: "f_4", sectionKey: "project", label: "项目名称" },
  ];

  awardFill.annotateAwardFields(fields);

  assert.equal(fields[2].sectionKey, "project");
  assert.equal(fields[2].repeatFieldKey, undefined);
});
