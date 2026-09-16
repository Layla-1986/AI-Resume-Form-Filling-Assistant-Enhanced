const fs = require("node:fs");
const path = require("node:path");

global.window = global;
require("../shared/resume-schema.js");
const transfer = require("../shared/resume-transfer.js");

const projectRoot = path.resolve(__dirname, "..", "..");
const sourcePath = path.join(
  projectRoot,
  "resume-backup-2026-09-02T10-36-03-046Z.json"
);
const outputPath = path.join(
  projectRoot,
  "resume-backup-latest-reconstructed-2026-09-16.json"
);

const source = transfer.parseTransferPayload(
  fs.readFileSync(sourcePath, "utf8")
);
const profile = window.ResumeSchema.normalizeResumeProfile(source.profile);

profile.awards = [
  {
    awardDate: "2023-05",
    name: "三维时空杯",
    level: "国家级",
    rank: "优秀奖",
    issuer: "",
    description:
      "参加“三维时空杯”相关竞赛，围绕三维数字化设计与工程实践完成参赛项目，通过方案设计、三维建模及成果展示等环节完成作品并获得优秀奖。",
  },
  {
    awardDate: "2022-09",
    name: "第八届四川省国际“互联网+”大学生创新创业大赛",
    level: "省级",
    rank: "铜奖",
    issuer: "",
    description:
      "参加第八届四川省国际“互联网+”大学生创新创业大赛，参与项目方案设计、技术实现及项目材料整理，完成项目申报与竞赛展示并获得铜奖。",
  },
  {
    awardDate: "2023-09",
    name: "第十六届iCAN西南赛区",
    level: "省级",
    rank: "二等奖",
    issuer: "",
    description:
      "参加第十六届iCAN大学生创新创业大赛西南赛区竞赛，参与创新项目的方案设计、技术实现与成果展示，并在西南赛区获得二等奖。",
  },
  {
    awardDate: "2023-11",
    name: "第十三届“创新、创意及创业”挑战赛校赛",
    level: "校级",
    rank: "二等奖",
    issuer: "",
    description:
      "参加第十三届全国大学生电子商务“创新、创意及创业”挑战赛校级选拔赛，参与项目创意策划、方案设计、材料准备及答辩展示，并获得校赛二等奖。",
  },
  {
    awardDate: "2021-08",
    name: "第十七届挑战杯校赛",
    level: "校级",
    rank: "二等奖",
    issuer: "",
    description:
      "参加第十七届“挑战杯”大学生课外学术科技作品竞赛校赛，参与项目方案设计、作品完善、申报材料整理及项目展示，并获得校赛二等奖。",
  },
  {
    awardDate: "2020-11",
    name: "气象讲解员大赛校赛",
    level: "校级",
    rank: "二等奖",
    issuer: "",
    description:
      "参加校级气象讲解员大赛，围绕气象科学知识进行内容整理、讲解方案设计及现场展示，锻炼科学知识表达与公众科普能力，并获得校赛二等奖。",
  },
  {
    awardDate: "",
    name: "一等奖学金",
    level: "校级",
    rank: "一等奖学金",
    issuer: "",
    description:
      "在校期间学习成绩及综合表现突出，获得学校一等奖学金，体现了较好的专业学习能力、综合素质和持续学习能力。",
  },
  {
    awardDate: "",
    name: "优秀毕业生",
    level: "校级",
    rank: "优秀毕业生",
    issuer: "",
    description:
      "在校期间学习成绩、科研实践及综合表现良好，经学校综合评定获得“优秀毕业生”荣誉称号。",
  },
];

const payload = transfer.createTransferPayload({
  profile,
  schemaVersion: window.ResumeSchema.version,
  rawText: source.rawText,
});

fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(outputPath);
