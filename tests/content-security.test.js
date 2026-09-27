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
  const projectFillSource = fs.readFileSync(
    path.join(__dirname, "../shared/project-fill.js"),
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
    ${projectFillSource}
    ${commonFieldFillSource}
    const schema = window.ResumeSchema;
    const repeatExpansion = globalThis.ResumeRepeatExpansion;
    const awardFill = globalThis.ResumeAwardFill;
    const projectFill = globalThis.ResumeProjectFill;
    const commonFieldFill = globalThis.ResumeCommonFieldFill;
    const repeatGroupIds = new WeakMap();
    let repeatGroupSequence = 0;
    ${extract(contentSource, "function sanitizePageUrl(value) {", "function cssEscape(value) {")}
    ${extract(contentSource, "function getRepeatedCardMeta(el) {", "function getMokaRepeatGroupId(el) {")}
    ${extract(contentSource, "function getMokaSectionMeta(el) {", "function getMokaDateMeta(el) {")}
    ${extract(contentSource, "function normalizeMappings(rawMappings, fields) {", "function normalizeTransform(transform) {")}
    ${extract(contentSource, "function normalizeTransform(transform) {", "function deriveFillValue(rawValue, transform, runtime) {")}
    module.exports = { assignRepeatedItemIndexes, getMokaSectionMeta, getRepeatedCardMeta, normalizeMappings, sanitizePageUrl };
  `;
  const context = {
    module: { exports: {} },
    exports: {},
    window: {},
    URL,
    fieldText: {
      normalizeFieldText: (value) => String(value || "").trim().toLowerCase().replace(/\\s+/g, ""),
    },
  };
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

test("generic descriptions inherit the nearest internship card before mapping", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "internship", label: "公司名称", repeatIndex: 0 },
    { fieldId: "f_2", sectionKey: "internship", label: "职位名称", repeatIndex: 0 },
    { fieldId: "f_3", sectionKey: "", label: "描述" },
    { fieldId: "f_4", sectionKey: "internship", label: "公司名称", repeatIndex: 1 },
    { fieldId: "f_5", sectionKey: "internship", label: "职位名称", repeatIndex: 1 },
    { fieldId: "f_6", sectionKey: "", label: "描述" },
  ];

  helpers.assignRepeatedItemIndexes(fields);
  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "f_3", resumePath: "internships.0.description" },
      { fieldId: "f_6", resumePath: "internships.0.description" },
    ],
    fields
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(mappings.map((mapping) => mapping.resumePath))),
    ["internships.0.description", "internships.1.description"]
  );
  assert.equal(fields[5].sectionKey, "internship");
  assert.equal(fields[5].repeatIndex, 1);
});

test("a stale generic internship description index is corrected from its card", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "internship", label: "公司名称", repeatIndex: 0 },
    { fieldId: "f_2", sectionKey: "internship", label: "描述", repeatIndex: 0 },
    { fieldId: "f_3", sectionKey: "internship", label: "公司名称", repeatIndex: 1 },
    { fieldId: "f_4", sectionKey: "", label: "描述", repeatIndex: 0 },
  ];

  helpers.assignRepeatedItemIndexes(fields);

  assert.equal(fields[3].repeatIndex, 1);
});

test("internship description follows the mapped company in its own card", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "i1-company", sectionKey: "internship", label: "公司名称", repeatIndex: 0 },
    { fieldId: "i1-title", sectionKey: "internship", label: "职位名称", repeatIndex: 0 },
    { fieldId: "i1-description", sectionKey: "internship", label: "描述", repeatIndex: 0 },
    { fieldId: "i2-company", sectionKey: "internship", label: "公司名称", repeatIndex: 1 },
    { fieldId: "i2-title", sectionKey: "internship", label: "职位名称", repeatIndex: 1 },
    { fieldId: "i2-description", sectionKey: "work", label: "描述", repeatIndex: 0 },
  ];
  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "i1-company", resumePath: "internships.0.company" },
      { fieldId: "i1-title", resumePath: "internships.0.title" },
      { fieldId: "i1-description", resumePath: "internships.0.description" },
      { fieldId: "i2-company", resumePath: "internships.1.company" },
      { fieldId: "i2-title", resumePath: "internships.1.title" },
      { fieldId: "i2-description", resumePath: "internships.0.description" },
    ],
    fields
  );
  const byId = Object.fromEntries(mappings.map((item) => [item.fieldId, item.resumePath]));

  assert.equal(byId["i2-description"], "internships.1.description");
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

test("numbered card hints override field discovery order", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "work", label: "公司名称", repeatGroupId: "card-2", repeatIndexHint: 1 },
    { fieldId: "f_2", sectionKey: "work", label: "担任岗位", repeatGroupId: "card-2", repeatIndexHint: 1 },
    { fieldId: "f_3", sectionKey: "work", label: "公司名称", repeatGroupId: "card-1", repeatIndexHint: 0 },
  ];

  helpers.assignRepeatedItemIndexes(fields);

  assert.deepEqual(
    JSON.parse(JSON.stringify(fields.map((field) => field.repeatIndex))),
    [1, 1, 0]
  );
});

test("campus numbered cards keep all fields aligned to their own resume record", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "campus", label: "活动名称", repeatGroupId: "campus-1", repeatIndexHint: 0 },
    { fieldId: "f_2", sectionKey: "campus", label: "职务", repeatGroupId: "campus-1", repeatIndexHint: 0 },
    { fieldId: "f_3", sectionKey: "campus", label: "活动描述", repeatGroupId: "campus-1", repeatIndexHint: 0 },
    { fieldId: "f_4", sectionKey: "campus", label: "活动名称", repeatGroupId: "campus-2", repeatIndexHint: 1 },
    { fieldId: "f_5", sectionKey: "campus", label: "职务", repeatGroupId: "campus-2", repeatIndexHint: 1 },
    { fieldId: "f_6", sectionKey: "campus", label: "活动描述", repeatGroupId: "campus-2", repeatIndexHint: 1 },
  ];

  helpers.assignRepeatedItemIndexes(fields);

  assert.deepEqual(
    JSON.parse(JSON.stringify(fields.map((field) => field.repeatIndex))),
    [0, 0, 0, 1, 1, 1]
  );
});

test("campus cards with alternate organization labels still advance to the next record", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "campus", label: "组织名称" },
    { fieldId: "f_2", sectionKey: "campus", label: "担任角色" },
    { fieldId: "f_3", sectionKey: "campus", label: "开始时间" },
    { fieldId: "f_4", sectionKey: "campus", label: "活动名称" },
    { fieldId: "f_5", sectionKey: "campus", label: "担任角色" },
    { fieldId: "f_6", sectionKey: "campus", label: "开始时间" },
    { fieldId: "f_7", sectionKey: "campus", label: "活动描述" },
  ];

  helpers.assignRepeatedItemIndexes(fields);

  assert.deepEqual(
    JSON.parse(JSON.stringify(fields.map((field) => field.repeatIndex))),
    [0, 0, 0, 1, 1, 1, 1]
  );
});

test("campus activity headings expose the explicit section and record index", () => {
  const helpers = loadContentSecurityHelpers();
  const makeCampusFields = (title, prefix) => {
    const card = {
      previousElementSibling: { textContent: title },
      parentElement: null,
      children: [],
    };
    return ["活动名称", "职务", "活动描述"].map((label, index) => ({
      fieldId: `${prefix}-${index}`,
      label,
      ...helpers.getRepeatedCardMeta({ parentElement: card }),
    }));
  };
  const fields = [
    ...makeCampusFields("校园活动经历1", "first"),
    ...makeCampusFields("校园活动经历2", "second"),
  ];

  helpers.assignRepeatedItemIndexes(fields);
  const mappings = helpers.normalizeMappings(
    fields.map((field) => ({
      fieldId: field.fieldId,
      resumePath: "campusExperiences.0.description",
    })),
    fields
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(fields.map((field) => field.repeatIndex))),
    [0, 0, 0, 1, 1, 1]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(mappings.map((mapping) => mapping.resumePath))),
    [
      "campusExperiences.0.description",
      "campusExperiences.0.role",
      "campusExperiences.0.description",
      "campusExperiences.1.description",
      "campusExperiences.1.role",
      "campusExperiences.1.description",
    ]
  );
});

test("Moka campus activity section headings are recognized as campus experiences", () => {
  const helpers = loadContentSecurityHelpers();
  const title = { className: "blockTitle-campus", textContent: "校园活动经历" };
  const card = { previousElementSibling: title };
  const field = { closest: () => card };

  assert.equal(helpers.getMokaSectionMeta(field).sectionKey, "campus");
});

test("Moka on-campus position headings are recognized as campus experiences", () => {
  const helpers = loadContentSecurityHelpers();
  const title = { className: "blockTitle-campus", textContent: "在校职务" };
  const card = { previousElementSibling: title };
  const field = { closest: () => card };

  assert.equal(helpers.getMokaSectionMeta(field).sectionKey, "campus");
});

test("numbered on-campus position cards expose stable campus indexes", () => {
  const helpers = loadContentSecurityHelpers();
  const card = {
    previousElementSibling: { textContent: "在校职务2" },
    parentElement: null,
    children: [],
  };

  const meta = helpers.getRepeatedCardMeta({ parentElement: card });

  assert.equal(meta.sectionKey, "campus");
  assert.equal(meta.repeatIndexHint, 1);
});

test("generic descriptions align with the project card immediately before them", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "f_1", sectionKey: "project", label: "项目名称" },
    { fieldId: "f_2", sectionKey: "", label: "描述" },
    { fieldId: "f_3", sectionKey: "project", label: "项目名称" },
    { fieldId: "f_4", sectionKey: "", label: "描述" },
  ];
  helpers.assignRepeatedItemIndexes(fields);

  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "f_1", resumePath: "projects.0.name" },
      { fieldId: "f_2", resumePath: "projects.0.description" },
      { fieldId: "f_3", resumePath: "projects.0.name" },
      { fieldId: "f_4", resumePath: "projects.0.description" },
    ],
    fields
  );

  assert.deepEqual(
    JSON.parse(JSON.stringify(mappings.map((mapping) => mapping.resumePath))),
    [
      "projects.0.name",
      "projects.0.description",
      "projects.1.name",
      "projects.1.description",
    ]
  );
});

test("project description follows the mapped project name in its own card", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    { fieldId: "p1-name", sectionKey: "project", label: "项目名称", repeatIndex: 0 },
    { fieldId: "p1-role", sectionKey: "project", label: "项目角色", repeatIndex: 0 },
    { fieldId: "p1-description", sectionKey: "project", label: "描述", repeatIndex: 0 },
    { fieldId: "p2-name", sectionKey: "project", label: "项目名称", repeatIndex: 1 },
    { fieldId: "p2-role", sectionKey: "project", label: "项目角色", repeatIndex: 1 },
    { fieldId: "p2-description", sectionKey: "work", label: "描述", repeatIndex: 0 },
  ];
  const mappings = helpers.normalizeMappings(
    [
      { fieldId: "p1-name", resumePath: "projects.0.name" },
      { fieldId: "p1-role", resumePath: "projects.0.role" },
      { fieldId: "p1-description", resumePath: "projects.0.description" },
      { fieldId: "p2-name", resumePath: "projects.1.name" },
      { fieldId: "p2-role", resumePath: "projects.1.role" },
      { fieldId: "p2-description", resumePath: "projects.0.description" },
    ],
    fields
  );
  const byId = Object.fromEntries(mappings.map((item) => [item.fieldId, item.resumePath]));

  assert.equal(byId["p2-description"], "projects.1.description");
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

test("on-campus position fields receive deterministic campus role mappings", () => {
  const helpers = loadContentSecurityHelpers();
  const fields = [
    {
      fieldId: "campus-role-2",
      label: "在校职务",
      sectionKey: "campus",
      repeatIndex: 1,
    },
  ];

  const mappings = helpers.normalizeMappings([], fields);

  assert.deepEqual(JSON.parse(JSON.stringify(mappings)), [
    {
      fieldId: "campus-role-2",
      resumePath: "campusExperiences.1.role",
      reason: "本地常见校招字段规则",
      transform: { type: "none" },
    },
  ]);
});

test("on-campus position cards override stale internship mappings for every record", () => {
  const helpers = loadContentSecurityHelpers();
  const labels = ["职务名称", "开始时间", "结束时间", "职务描述"];
  const fields = [0, 1, 2].flatMap((repeatIndex) =>
    labels.map((label, labelIndex) => ({
      fieldId: `campus-${repeatIndex}-${labelIndex}`,
      label,
      sectionKey: "campus",
      repeatIndex,
    }))
  );
  const staleMappings = fields.map((field) => ({
    fieldId: field.fieldId,
    resumePath: field.label === "职务描述"
      ? "internships.0.description"
      : field.label === "职务名称"
        ? "internships.0.title"
        : field.label === "开始时间"
          ? "internships.0.startDate"
          : "internships.0.endDate",
  }));

  const mappings = helpers.normalizeMappings(staleMappings, fields);
  const paths = Object.fromEntries(mappings.map((item) => [item.fieldId, item.resumePath]));

  assert.deepEqual(paths, {
    "campus-0-0": "campusExperiences.0.role",
    "campus-0-1": "campusExperiences.0.startDate",
    "campus-0-2": "campusExperiences.0.endDate",
    "campus-0-3": "campusExperiences.0.description",
    "campus-1-0": "campusExperiences.1.role",
    "campus-1-1": "campusExperiences.1.startDate",
    "campus-1-2": "campusExperiences.1.endDate",
    "campus-1-3": "campusExperiences.1.description",
    "campus-2-0": "campusExperiences.2.role",
    "campus-2-1": "campusExperiences.2.startDate",
    "campus-2-2": "campusExperiences.2.endDate",
    "campus-2-3": "campusExperiences.2.description",
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
