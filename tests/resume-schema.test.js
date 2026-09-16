const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadResumeSchema() {
  const source = fs.readFileSync(
    path.join(__dirname, "../shared/resume-schema.js"),
    "utf8"
  );
  const context = {
    window: {},
    console,
    structuredClone: global.structuredClone,
  };

  vm.createContext(context);
  vm.runInContext(source, context);

  return context.window.ResumeSchema;
}

test("resume schema exposes campus recruiting education and experience fields", () => {
  const schema = loadResumeSchema();
  const catalog = schema.getFieldCatalog({ mode: "max" });
  const template = JSON.parse(schema.createImportTemplateString());

  assert.ok(catalog.some((field) => field.path === "educations.0.educationType"));
  assert.ok(catalog.some((field) => field.path === "educations.0.studyMode"));
  assert.ok(catalog.some((field) => field.path === "educations.0.laboratory"));
  assert.ok(catalog.some((field) => field.path === "educations.0.researchDirection"));
  assert.ok(catalog.some((field) => field.path === "educations.0.advisor"));
  assert.ok(catalog.some((field) => field.path === "internships.0.company"));
  assert.ok(catalog.some((field) => field.path === "campusExperiences.0.organization"));

  assert.ok(Array.isArray(template.internships));
  assert.ok(Array.isArray(template.campusExperiences));
  assert.equal("educationType" in template.educations[0], true);
  assert.equal("studyMode" in template.educations[0], true);
  assert.equal("laboratory" in template.educations[0], true);
  assert.equal("researchDirection" in template.educations[0], true);
  assert.equal("advisor" in template.educations[0], true);
});

test("resume schema preserves common campus recruiting personal and source fields", () => {
  const schema = loadResumeSchema();
  const catalog = schema.getFieldCatalog({ mode: "max" });
  const paths = new Set(catalog.map((field) => field.path));
  assert.equal(paths.has("personal.ethnicity"), true);
  assert.equal(paths.has("personal.height"), true);
  assert.equal(paths.has("personal.weight"), true);
  assert.equal(paths.has("jobPreferences.recruitmentSource"), true);

  const normalized = schema.normalizeResumeProfile({
    personal: { ethnicity: "汉族", heightCm: "175", weightKg: "65" },
    jobPreferences: { recruitmentChannel: "校园招聘网站" },
  });
  assert.equal(normalized.personal.ethnicity, "汉族");
  assert.equal(normalized.personal.height, "175");
  assert.equal(normalized.personal.weight, "65");
  assert.equal(normalized.jobPreferences.recruitmentSource, "校园招聘网站");
});

test("resume schema models awards as independent records", () => {
  const schema = loadResumeSchema();
  const catalog = schema.getFieldCatalog({ mode: "max" });
  const template = JSON.parse(schema.createImportTemplateString());
  const awardSection = schema.sections.find((section) => section.key === "awards");
  const campusSection = schema.sections.find(
    (section) => section.key === "campusExperiences"
  );
  const campusCategory = campusSection.fields.find(
    (field) => field.key === "category"
  );

  assert.ok(Array.isArray(template.awards));
  assert.equal("awards" in template.additional, false);
  assert.equal("competitions" in template.additional, false);
  assert.equal(awardSection.label, "竞赛获奖");
  assert.equal(awardSection.itemLabel, "竞赛获奖");
  assert.equal(campusCategory.options.includes("竞赛"), false);
  assert.ok(catalog.some((field) => field.path === "awards.0.awardDate"));
  assert.ok(catalog.some((field) => field.path === "awards.0.name"));
  assert.ok(catalog.some((field) => field.path === "awards.0.level"));
  assert.ok(catalog.some((field) => field.path === "awards.0.rank"));
  assert.ok(catalog.some((field) => field.path === "awards.0.description"));
});

test("adding an empty award slot keeps it visible for editing", () => {
  const schema = loadResumeSchema();
  const appendEmptyListItem = schema.appendEmptyListItem;
  assert.equal(
    typeof appendEmptyListItem,
    "function",
    "resume schema should expose a list-item append operation"
  );

  const profile = schema.normalizeResumeProfile({
    awards: [
      {
        awardDate: "2023-05",
        name: "三维时空杯",
        level: "国家级",
        rank: "优秀奖",
      },
    ],
  });
  const nextProfile = appendEmptyListItem(profile, "awards");

  assert.equal(profile.awards.length, 1);
  assert.equal(nextProfile.awards.length, 2);
  assert.deepEqual(nextProfile.awards[1], schema.createEmptyListItem("awards"));
});

test("resume schema migrates legacy award text into separate award records", () => {
  const schema = loadResumeSchema();
  const normalized = schema.normalizeResumeProfile({
    additional: {
      awards:
        "互联网+省铜、ICAN西南赛区二等奖、挑战杯二等奖、三创赛二等奖、一等奖学金、优秀部长、优秀毕业生",
    },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.awards.map((award) => award.name))),
    [
      "互联网+省铜",
      "ICAN西南赛区二等奖",
      "挑战杯二等奖",
      "三创赛二等奖",
      "一等奖学金",
      "优秀部长",
      "优秀毕业生",
    ]
  );
});

test("resume schema migrates legacy competition text out of additional information", () => {
  const schema = loadResumeSchema();
  const normalized = schema.normalizeResumeProfile({
    additional: {
      competitions: "全国大学生数学建模竞赛二等奖、挑战杯省级一等奖",
    },
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.awards.map((award) => award.name))),
    ["全国大学生数学建模竞赛二等奖", "挑战杯省级一等奖"]
  );
});

test("resume schema moves legacy campus competitions into competition awards", () => {
  const schema = loadResumeSchema();
  const normalized = schema.normalizeResumeProfile({
    campusExperiences: [
      {
        category: "竞赛",
        organization: "互联网+大学生创新创业大赛",
        startDate: "2024-03",
        endDate: "2024-06",
        achievements: "省级铜奖",
        description: "负责产品方案与答辩材料",
      },
      {
        category: "学生组织",
        organization: "校学生会",
        role: "部长",
      },
    ],
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(normalized.awards[0])),
    {
      awardDate: "2024-06",
      name: "互联网+大学生创新创业大赛",
      level: "",
      rank: "省级铜奖",
      issuer: "",
      description: "负责产品方案与答辩材料",
    }
  );
  assert.equal(normalized.campusExperiences.length, 1);
  assert.equal(normalized.campusExperiences[0].category, "学生组织");
  assert.equal(normalized.campusExperiences[0].organization, "校学生会");
});

test("resume schema merges campus competitions without duplicating existing awards", () => {
  const schema = loadResumeSchema();
  const normalized = schema.normalizeResumeProfile({
    awards: [
      {
        awardDate: "2024-06",
        name: "互联网+大学生创新创业大赛",
        rank: "省级铜奖",
      },
    ],
    campusExperiences: [
      {
        category: "竞赛",
        organization: "互联网+大学生创新创业大赛",
        endDate: "2024-06",
        achievements: "省级铜奖",
      },
    ],
  });

  assert.equal(
    normalized.awards.filter(
      (award) => award.name === "互联网+大学生创新创业大赛"
    ).length,
    1
  );
  assert.equal(
    normalized.campusExperiences.some((item) => item.category === "竞赛"),
    false
  );
});

test("resume schema preserves twelve separate competition awards", () => {
  const schema = loadResumeSchema();
  const awards = Array.from({ length: 12 }, (_, index) => ({
    awardDate: `202${index % 5}-0${(index % 9) + 1}`,
    name: `竞赛奖项 ${index + 1}`,
    level: "省级",
    rank: "二等奖",
  }));

  const normalized = schema.normalizeResumeProfile({ awards });

  assert.equal(normalized.awards.length, 12);
  assert.equal(normalized.awards[11].name, "竞赛奖项 12");
});

test("resume schema normalizes campus recruiting resume data", () => {
  const schema = loadResumeSchema();
  const normalized = schema.normalizeResumeProfile({
    educations: [
      {
        school: "浙江大学",
        educationType: "统招全日制",
        studyMode: "联合培养",
        laboratory: "CAD&CG 国家重点实验室",
        researchDirection: ["AIGC", "多模态生成"],
        advisor: "王老师",
        studentId: 20231234,
        academicSystem: 3,
      },
    ],
    internships: [
      {
        company: "字节跳动",
        title: "后端开发实习生",
        description: ["负责推荐服务接口开发", "支持线上稳定性治理"],
      },
    ],
    campusExperiences: [
      {
        organization: "浙江大学 ACM 协会",
        category: "学生组织",
        role: "技术负责人",
        isCurrent: true,
      },
    ],
  });

  assert.equal(normalized.educations[0].educationType, "统招全日制");
  assert.equal(normalized.educations[0].studyMode, "联合培养");
  assert.equal(normalized.educations[0].laboratory, "CAD&CG 国家重点实验室");
  assert.equal(normalized.educations[0].researchDirection, "AIGC, 多模态生成");
  assert.equal(normalized.educations[0].advisor, "王老师");
  assert.equal(normalized.educations[0].studentId, "20231234");
  assert.equal(normalized.educations[0].academicSystem, "3");
  assert.equal(normalized.internships[0].company, "字节跳动");
  assert.equal(
    normalized.internships[0].description,
    "负责推荐服务接口开发, 支持线上稳定性治理"
  );
  assert.equal(normalized.campusExperiences[0].category, "学生组织");
  assert.equal(normalized.campusExperiences[0].isCurrent, "是");
});

test("resume schema preserves flexible date precision and legacy aliases", () => {
  const schema = loadResumeSchema();
  const normalized = schema.normalizeResumeProfile({
    personal: {
      birthYearMonth: "2001/06",
    },
    contactAndLocation: {
      nativePlace: "江西南昌",
    },
    identityAndAuthorization: {
      idCardNumber: "362202200106265976",
    },
    educations: [
      {
        learningModality: "全国普通高等院校全日制",
        schoolSystem: "2年及以上",
        timeRange: "2021年09月 至 2025年06月",
      },
    ],
  });

  assert.equal(normalized.personal.birthDate, "2001-06");
  assert.equal(normalized.contactAndLocation.hometownCity, "江西南昌");
  assert.equal(normalized.contactAndLocation.hometownProvince, "江西南昌");
  assert.equal(
    normalized.identityAndAuthorization.personalIdNumber,
    "362202200106265976"
  );
  assert.equal(normalized.identityAndAuthorization.personalIdType, "身份证");
  assert.equal(normalized.educations[0].studyMode, "统招");
  assert.equal(normalized.educations[0].academicSystem, "2年及以上");
  assert.equal(normalized.educations[0].startDate, "2021-09");
  assert.equal(normalized.educations[0].endDate, "2025-06");
});
