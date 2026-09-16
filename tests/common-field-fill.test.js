const test = require("node:test");
const assert = require("node:assert/strict");

let commonFill = {};
try {
  commonFill = require("../shared/common-field-fill.js");
} catch (_) {
  // The first TDD run intentionally exercises the missing behavior.
}

test("common campus recruiting labels receive deterministic resume paths", () => {
  const cases = [
    [{ label: "出生日期" }, "personal.birthDate"],
    [{ label: "籍贯" }, "contactAndLocation.hometownCity"],
    [{ label: "民族" }, "personal.ethnicity"],
    [{ label: "政治面貌" }, "identityAndAuthorization.politicalStatus"],
    [{ label: "身高(cm)" }, "personal.height"],
    [{ label: "体重（kg）" }, "personal.weight"],
    [{ label: "招聘信息来源" }, "jobPreferences.recruitmentSource"],
    [{ label: "英语等级" }, "languages.0.testScore"],
    [{ label: "英语证书名称" }, "languages.0.testScore"],
    [{ label: "期望月薪(税前)" }, "jobPreferences.expectedSalary"],
    [{ label: "期望工作城市" }, "jobPreferences.expectedCity"],
    [{ label: "计算机能力" }, "skills.primarySkills"],
    [
      { label: "学习形式", sectionKey: "education", repeatIndex: 1 },
      "educations.1.studyMode",
    ],
    [{ label: "培养方式" }, "educations.0.studyMode"],
    [
      { label: "学历类型", sectionKey: "education", repeatIndex: 1 },
      "educations.1.educationType",
    ],
    [
      { label: "是否最高学历", sectionKey: "education", repeatIndex: 1 },
      "educations.1.degree",
    ],
    [
      {
        label: "最高学历",
        sectionKey: "education",
        repeatIndex: 0,
        options: ["是", "否"],
      },
      "educations.0.degree",
    ],
    [
      { label: "成绩排名", sectionKey: "education", repeatIndex: 1 },
      "educations.1.ranking",
    ],
    [
      { label: "学校所在城市", sectionKey: "education", repeatIndex: 0 },
      "educations.0.city",
    ],
    [
      { label: "专业大类", sectionKey: "education", repeatIndex: 1 },
      "educations.1.major",
    ],
    [
      { label: "年", sectionKey: "education", repeatIndex: 0, dateRole: "start" },
      "educations.0.startDate",
    ],
    [
      { label: "月", sectionKey: "education", repeatIndex: 0, dateRole: "end" },
      "educations.0.endDate",
    ],
  ];

  for (const [field, expected] of cases) {
    assert.equal(commonFill.getDeterministicCommonPath?.(field), expected);
  }
});

test("common field values derive English level, study mode, location, and computer skills", () => {
  const profile = {
    personal: { ethnicity: "", nationality: "汉族", height: "175", weight: "65" },
    contactAndLocation: { hometownCity: "", hometownProvince: "四川", hukouLocation: "" },
    jobPreferences: { expectedCity: "", preferredLocations: "成都、重庆" },
    skills: {
      primarySkills: "RAG、Agent",
      programmingLanguages: "Python、C语言",
      frameworks: "FastAPI",
      aiTools: "LangChain、LangGraph",
    },
    languages: [{ name: "英语", proficiency: "", testScore: "CET6" }],
    educations: [
      { studyMode: "", educationType: "统招全日制", city: "成都" },
    ],
  };

  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "英语等级" }),
    "六级"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "英语等级成绩" }),
    "CET6"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "英语证书名称" }),
    "CET6"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "民族" }),
    "汉族"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "籍贯" }),
    "四川"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "期望工作城市" }),
    "成都、重庆"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, {
      label: "培养方式",
      repeatIndex: 0,
    }),
    "统招全日制"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "计算机能力" }),
    "RAG、Agent、Python、C语言、FastAPI、LangChain、LangGraph"
  );
});

test("English certificate name falls back to the matching certificate record", () => {
  const profile = {
    languages: [{ name: "英语", proficiency: "", testScore: "" }],
    certificates: [
      { name: "计算机二级" },
      { name: "大学英语六级证书" },
    ],
  };

  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "英语证书名称" }),
    "大学英语六级证书"
  );
});

test("computer level certificates are not mistaken for English certificates", () => {
  const profile = {
    languages: [{ name: "英语", proficiency: "", testScore: "CET-6" }],
    certificates: [{ name: "全国计算机等级考试四级证书" }],
  };

  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "英语证书名称" }),
    "CET-6"
  );
});

test("other foreign-language certificates are not mistaken for English certificates", () => {
  const profile = {
    languages: [{ name: "英语", proficiency: "", testScore: "CET-6" }],
    certificates: [
      { name: "大学日语六级证书" },
      { name: "全国外语水平考试日语证书" },
    ],
  };

  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, { label: "英语证书名称" }),
    "CET-6"
  );
});

test("legacy nationality values covering Chinese ethnic groups remain usable", () => {
  assert.equal(
    commonFill.resolveCommonFieldValue?.(
      { personal: { nationality: "畲" } },
      { label: "民族" }
    ),
    "畲族"
  );
});

test("education recruiting fields use stable requested values for every record", () => {
  const profile = {
    educations: [
      { degree: "本科", educationType: "非统招", ranking: "前50%" },
      { degree: "硕士研究生", educationType: "联合培养", ranking: "未知" },
    ],
  };

  for (const repeatIndex of [0, 1]) {
    assert.equal(
      commonFill.resolveCommonFieldValue?.(profile, {
        label: "学历类型",
        sectionKey: "education",
        repeatIndex,
      }),
      "统招全日制"
    );
    assert.equal(
      commonFill.resolveCommonFieldValue?.(profile, {
        label: "专业排名",
        sectionKey: "education",
        repeatIndex,
      }),
      "前20%"
    );
  }

  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, {
      label: "是否最高学历",
      sectionKey: "education",
      repeatIndex: 0,
    }),
    "否"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, {
      label: "是否为最高学历",
      sectionKey: "education",
      repeatIndex: 1,
    }),
    "是"
  );
});

test("Moka primary discipline is derived from each education major", () => {
  const profile = {
    educations: [
      { major: "电子信息科学与技术" },
      { major: "电子信息" },
      { major: "应用数学" },
      { major: "工商管理" },
    ],
  };

  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, {
      label: "专业大类",
      sectionKey: "education",
      repeatIndex: 0,
    }),
    "工学"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, {
      label: "Primary Discipline",
      sectionKey: "education",
      repeatIndex: 2,
    }),
    "理学"
  );
  assert.equal(
    commonFill.resolveCommonFieldValue?.(profile, {
      label: "专业大类",
      sectionKey: "education",
      repeatIndex: 3,
    }),
    "管理学"
  );
});
