const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function extract(source, startSignature, endSignature) {
  const start = source.indexOf(startSignature);
  const end = source.indexOf(endSignature, start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Failed to locate snippet: ${startSignature}`);
  }
  return source.slice(start, end);
}

function loadContentSecurityHelpers() {
  const contentSource = fs.readFileSync(
    path.join(__dirname, "../content.js"),
    "utf8"
  );
  const schemaSource = fs.readFileSync(
    path.join(__dirname, "../shared/resume-schema.js"),
    "utf8"
  );
  const repeatExpansionSource = fs.readFileSync(
    path.join(__dirname, "../shared/repeat-expansion.js"),
    "utf8"
  );
  const awardFillSource = fs.readFileSync(
    path.join(__dirname, "../shared/award-fill.js"),
    "utf8"
  );
  const commonFieldFillSource = fs.readFileSync(
    path.join(__dirname, "../shared/common-field-fill.js"),
    "utf8"
  );
  const snippet = `
    ${schemaSource}
    ${repeatExpansionSource}
    ${awardFillSource}
    ${commonFieldFillSource}
    const schema = window.ResumeSchema;
    const repeatExpansion = globalThis.ResumeRepeatExpansion;
    const awardFill = globalThis.ResumeAwardFill;
    const commonFieldFill = globalThis.ResumeCommonFieldFill;
    ${extract(contentSource, "function sanitizePageUrl(value) {", "function cssEscape(value) {")}
    ${extract(contentSource, "function normalizeMappings(rawMappings, fields) {", "function normalizeTransform(transform) {")}
    ${extract(contentSource, "function normalizeTransform(transform) {", "function deriveFillValue(rawValue, transform, runtime) {")}
    module.exports = { assignRepeatedItemIndexes, normalizeMappings, sanitizePageUrl };
  `;
  const context = { module: { exports: {} }, exports: {}, window: {}, URL };
  vm.createContext(context);
  vm.runInContext(snippet, context);
  return context.module.exports;
}

test("page URLs sent to the model exclude query and hash", () => {
  const helpers = loadContentSecurityHelpers();
  assert.equal(
    helpers.sanitizePageUrl("https://example.com/app?token=secret#section"),
    "https://example.com/app"
  );
});

test("mapping paths are restricted to the schema catalog", () => {
  const helpers = loadContentSecurityHelpers();
  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "f_1", resumePath: "personal.email" },
      { fieldId: "f_2", resumePath: "../../apiKey" },
      { fieldId: "f_3", resumePath: "[object Object]" },
    ],
    [{ fieldId: "f_1" }, { fieldId: "f_2" }, { fieldId: "f_3" }]
  );

  assert.equal(mappings[0].resumePath, "personal.email");
  assert.equal(mappings[1].resumePath, "");
  assert.equal(mappings[2].resumePath, "");
});

test("award fields receive stable repeat indexes by label occurrence", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "award", label: "获奖时间" },
    { fieldId: "f_2", sectionKey: "award", label: "奖项" },
    { fieldId: "f_3", sectionKey: "award", label: "等级" },
    { fieldId: "f_4", sectionKey: "award", label: "获奖时间" },
    { fieldId: "f_5", sectionKey: "award", label: "奖项" },
    { fieldId: "f_6", sectionKey: "award", label: "等级" },
  ];

  helpers.assignRepeatedItemIndexes(fields);

  assert.deepEqual(
    JSON.parse(JSON.stringify(fields.map((field) => field.repeatIndex))),
    [0, 0, 0, 1, 1, 1]
  );
});

test("award mappings are aligned to the matching repeated card", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "award", label: "获奖时间", repeatIndex: 0 },
    { fieldId: "f_2", sectionKey: "award", label: "奖项", repeatIndex: 0 },
    { fieldId: "f_3", sectionKey: "award", label: "获奖时间", repeatIndex: 1 },
    { fieldId: "f_4", sectionKey: "award", label: "奖项", repeatIndex: 1 },
  ];
  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "f_1", resumePath: "awards.0.awardDate" },
      { fieldId: "f_2", resumePath: "awards.0.name" },
      { fieldId: "f_3", resumePath: "awards.0.awardDate" },
      { fieldId: "f_4", resumePath: "awards.0.name" },
    ],
    fields
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(mappings.map((mapping) => mapping.resumePath))),
    ["awards.0.awardDate", "awards.0.name", "awards.1.awardDate", "awards.1.name"]
  );
});

test("award mapping locally adds omitted descriptions and corrects duplicated names", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "award", label: "获奖名称*" },
    { fieldId: "f_2", sectionKey: "award", label: "获奖时间" },
    { fieldId: "f_3", sectionKey: "", label: "描述" },
    { fieldId: "f_4", sectionKey: "award", label: "获奖名称*" },
    { fieldId: "f_5", sectionKey: "award", label: "获奖时间" },
    { fieldId: "f_6", sectionKey: "", label: "描述" },
  ];
  helpers.assignRepeatedItemIndexes(fields);

  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "f_1", resumePath: "awards.0.name" },
      { fieldId: "f_2", resumePath: "awards.0.awardDate" },
      { fieldId: "f_4", resumePath: "awards.0.name" },
      { fieldId: "f_5", resumePath: "awards.1.awardDate" },
    ],
    fields
  );
  const byId = Object.fromEntries(mappings.map((item) => [item.fieldId, item.resumePath]));

  assert.deepEqual(byId, {
    f_1: "awards.0.name",
    f_2: "awards.0.awardDate",
    f_3: "awards.0.description",
    f_4: "awards.1.name",
    f_5: "awards.1.awardDate",
    f_6: "awards.1.description",
  });
});

test("internship fields and mappings follow the matching repeated card", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "internship", label: "公司名称" },
    { fieldId: "f_2", sectionKey: "internship", label: "职位名称" },
    { fieldId: "f_3", sectionKey: "internship", label: "公司名称" },
    { fieldId: "f_4", sectionKey: "internship", label: "职位名称" },
  ];
  helpers.assignRepeatedItemIndexes(fields);

  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "f_1", resumePath: "internships.0.company" },
      { fieldId: "f_2", resumePath: "internships.0.title" },
      { fieldId: "f_3", resumePath: "internships.0.company" },
      { fieldId: "f_4", resumePath: "internships.0.title" },
    ],
    fields
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(fields.map((field) => field.repeatIndex))),
    [0, 0, 1, 1]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(mappings.map((mapping) => mapping.resumePath))),
    ["internships.0.company", "internships.0.title", "internships.1.company", "internships.1.title"]
  );
});

test("generic work cards preserve an internship mapping while advancing its record index", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "work", label: "公司名称" },
    { fieldId: "f_2", sectionKey: "work", label: "担任岗位" },
    { fieldId: "f_3", sectionKey: "work", label: "公司名称" },
    { fieldId: "f_4", sectionKey: "work", label: "担任岗位" },
  ];
  helpers.assignRepeatedItemIndexes(fields);

  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "f_1", resumePath: "internships.0.company" },
      { fieldId: "f_2", resumePath: "internships.0.title" },
      { fieldId: "f_3", resumePath: "internships.0.company" },
      { fieldId: "f_4", resumePath: "internships.0.title" },
    ],
    fields
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(mappings.map((mapping) => mapping.resumePath))),
    ["internships.0.company", "internships.0.title", "internships.1.company", "internships.1.title"]
  );
});

test("Moka controls in the same repeated card keep one record index", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "education", label: "年", repeatGroupId: "card-a" },
    { fieldId: "f_2", sectionKey: "education", label: "月", repeatGroupId: "card-a" },
    { fieldId: "f_3", sectionKey: "education", label: "年", repeatGroupId: "card-a" },
    { fieldId: "f_4", sectionKey: "education", label: "月", repeatGroupId: "card-a" },
    { fieldId: "f_5", sectionKey: "education", label: "学校名称", repeatGroupId: "card-a" },
    { fieldId: "f_6", sectionKey: "education", label: "年", repeatGroupId: "card-b" },
    { fieldId: "f_7", sectionKey: "education", label: "月", repeatGroupId: "card-b" },
    { fieldId: "f_8", sectionKey: "education", label: "年", repeatGroupId: "card-b" },
    { fieldId: "f_9", sectionKey: "education", label: "月", repeatGroupId: "card-b" },
    { fieldId: "f_10", sectionKey: "education", label: "学校名称", repeatGroupId: "card-b" },
  ];

  helpers.assignRepeatedItemIndexes(fields);

  assert.deepEqual(
    JSON.parse(JSON.stringify(fields.map((field) => field.repeatIndex))),
    [0, 0, 0, 0, 0, 1, 1, 1, 1, 1]
  );
});

test("legacy scalar award mappings are rejected", () => {
  const helpers = loadContentSecurityHelpers();
  const mappings = helpers.normalizeMappings(
    [{ fieldId: "f_1", resumePath: "additional.awards" }],
    [{ fieldId: "f_1", sectionKey: "award", label: "奖项", repeatIndex: 0 }]
  );

  assert.equal(mappings[0].resumePath, "");
});

test("common campus recruiting fields receive local mappings when AI omits them", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", label: "出生日期" },
    { fieldId: "f_2", label: "民族" },
    { fieldId: "f_3", label: "期望月薪(税前)" },
    { fieldId: "f_4", label: "期望工作城市" },
    { fieldId: "f_5", label: "计算机能力" },
    { fieldId: "f_6", label: "学习形式", sectionKey: "education", repeatIndex: 1 },
    { fieldId: "f_7", label: "学校所在城市", sectionKey: "education", repeatIndex: 1 },
    { fieldId: "f_8", label: "政治面貌" },
    { fieldId: "f_9", label: "身高(cm)" },
    { fieldId: "f_10", label: "体重(kg)" },
    { fieldId: "f_11", label: "招聘信息来源" },
    { fieldId: "f_12", label: "成绩排名", sectionKey: "education", repeatIndex: 1 },
    { fieldId: "f_13", label: "英语证书名称" },
    { fieldId: "f_14", label: "学历类型", sectionKey: "education", repeatIndex: 0 },
    { fieldId: "f_15", label: "是否最高学历", sectionKey: "education", repeatIndex: 1, options: ["是", "否"] },
  ];

  const mappings = helpers.normalizeMappings([], fields);
  const byId = Object.fromEntries(mappings.map((item) => [item.fieldId, item.resumePath]));

  assert.deepEqual(byId, {
    f_1: "personal.birthDate",
    f_2: "personal.ethnicity",
    f_3: "jobPreferences.expectedSalary",
    f_4: "jobPreferences.expectedCity",
    f_5: "skills.primarySkills",
    f_6: "educations.1.studyMode",
    f_7: "educations.1.city",
    f_8: "identityAndAuthorization.politicalStatus",
    f_9: "personal.height",
    f_10: "personal.weight",
    f_11: "jobPreferences.recruitmentSource",
    f_12: "educations.1.ranking",
    f_13: "languages.0.testScore",
    f_14: "educations.0.educationType",
    f_15: "educations.1.degree",
  });
});

test("deterministic common mappings discard incompatible AI transforms", () => {
  const helpers = loadContentSecurityHelpers();
  const mappings = helpers.normalizeMappings(
    [
      {
        fieldId: "f_1",
        resumePath: "personal.birthDate",
        transform: { type: "boolean_choice", trueValue: "是", falseValue: "否" },
      },
    ],
    [{ fieldId: "f_1", label: "民族" }]
  );

  assert.equal(mappings[0].fieldId, "f_1");
  assert.equal(mappings[0].resumePath, "personal.ethnicity");
  assert.equal(mappings[0].reason, "");
  assert.equal(mappings[0].transform.type, "none");
});
