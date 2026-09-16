(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  root.ResumeCommonFieldFill = api;
})(
  typeof globalThis !== "undefined" ? globalThis : this,
  function () {
    "use strict";

    function normalizeText(value) {
      return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "")
        .replace(/^(请填写|请选择|请输入)/g, "")
        .replace(/[＊*:：()（）[\]【】{}<>]/g, "");
    }

    function educationPath(field, key) {
      const index = Number.isInteger(field?.repeatIndex) && field.repeatIndex >= 0
        ? field.repeatIndex
        : 0;
      return `educations.${index}.${key}`;
    }

    function repeatedPath(field, profileKey, key) {
      const index = Number.isInteger(field?.repeatIndex) && field.repeatIndex >= 0
        ? field.repeatIndex
        : 0;
      return `${profileKey}.${index}.${key}`;
    }

    function hasYesNoOptions(field) {
      const options = Array.isArray(field?.options) ? field.options : [];
      const normalized = options.map((option) => normalizeText(option));
      const hasYes = normalized.some((option) => ["是", "yes", "true", "1"].includes(option));
      const hasNo = normalized.some((option) => ["否", "no", "false", "0"].includes(option));
      return hasYes && hasNo;
    }

    function isHighestEducationFlagField(field, label) {
      return (
        /^(是否(为)?最高学历|最高学历(标识|状态|是否))$/.test(label) ||
        (label === "最高学历" && hasYesNoOptions(field))
      );
    }

    function getDeterministicCommonPath(field) {
      const label = normalizeText(
        field?.label || field?.placeholder || field?.name || field?.id
      );
      if (!label) return "";

      if (field?.dateRole) {
        const dateKey = field.dateRole === "start" ? "startDate" : "endDate";
        if (field.sectionKey === "education") return educationPath(field, dateKey);
        if (field.sectionKey === "internship") {
          return repeatedPath(field, "internships", dateKey);
        }
        if (field.sectionKey === "work") {
          return repeatedPath(field, "workExperiences", dateKey);
        }
        if (field.sectionKey === "project") {
          return repeatedPath(field, "projects", dateKey);
        }
        if (field.sectionKey === "campus") {
          return repeatedPath(field, "campusExperiences", dateKey);
        }
        if (field.sectionKey === "award") {
          return repeatedPath(field, "awards", "awardDate");
        }
      }

      if (/^出生(日期|年月|时间)$/.test(label)) return "personal.birthDate";
      if (/^(籍贯|祖籍)$/.test(label)) return "contactAndLocation.hometownCity";
      if (/^民族$/.test(label)) return "personal.ethnicity";
      if (/^政治面貌$/.test(label)) return "identityAndAuthorization.politicalStatus";
      if (/^身高(cm|厘米)?$/.test(label)) return "personal.height";
      if (/^体重(kg|公斤|千克)?$/.test(label)) return "personal.weight";
      if (/^(招聘)?信息来源$|^招聘来源$|^获知渠道$/.test(label)) {
        return "jobPreferences.recruitmentSource";
      }
      if (isHighestEducationFlagField(field, label)) return educationPath(field, "degree");
      if (/^最高学历$/.test(label)) return "personal.highestEducationLevel";
      if (/^(手机号码|手机号|联系电话)$/.test(label)) return "personal.phoneNumber";
      if (/^(邮箱|电子邮箱|email)$/.test(label)) return "personal.email";
      if (/^英语等级(成绩)?$/.test(label)) return "languages.0.testScore";
      if (/^(英语|外语)(等级)?证书(名称)?$/.test(label)) return "languages.0.testScore";
      if (/^(计算机能力|计算机技能|专业技能)$/.test(label)) return "skills.primarySkills";
      if (/^期望(月薪|薪资|薪酬)/.test(label)) return "jobPreferences.expectedSalary";
      if (/^(期望工作城市|期望城市|意向城市)$/.test(label)) {
        return "jobPreferences.expectedCity";
      }

      if (/^(学习形式|培养方式)$/.test(label)) return educationPath(field, "studyMode");
      if (/^(学历类型|学历类别|学历性质)$/.test(label)) {
        return educationPath(field, "educationType");
      }
      if (/^(成绩排名|专业排名|综合排名)$/.test(label)) {
        return educationPath(field, "ranking");
      }

      if (field?.sectionKey === "education") {
        if (/^开始(时间|日期)$/.test(label)) return educationPath(field, "startDate");
        if (/^结束(时间|日期)$/.test(label)) return educationPath(field, "endDate");
        if (/^(学校名称|毕业院校)$/.test(label)) return educationPath(field, "school");
        if (/^(专业名称|专业)$/.test(label)) return educationPath(field, "major");
        if (/^(专业大类|学科门类|一级学科|primarydiscipline)$/.test(label)) {
          return educationPath(field, "major");
        }
        if (/^(学历|学历层次|学位)$/.test(label)) return educationPath(field, "degree");
        if (/^(学校所在城市|学校城市|就读城市)$/.test(label)) {
          return educationPath(field, "city");
        }
      }

      return "";
    }

    function firstMeaningful(values) {
      return values
        .map((value) => String(value || "").trim())
        .find(Boolean) || "";
    }

    function getEnglishRecord(profile) {
      const records = Array.isArray(profile?.languages) ? profile.languages : [];
      return records.find((item) => /英语|english/i.test(String(item?.name || ""))) || records[0] || {};
    }

    function deriveEnglishLevel(profile) {
      const record = getEnglishRecord(profile);
      const score = String(record?.testScore || "").trim();
      if (/cet\s*-?\s*6|大学英语六级|英语六级|^六级$/i.test(score)) return "六级";
      if (/cet\s*-?\s*4|大学英语四级|英语四级|^四级$/i.test(score)) return "四级";
      return firstMeaningful([score, record?.proficiency]);
    }

    function getEnglishCertificateName(profile) {
      const records = Array.isArray(profile?.certificates) ? profile.certificates : [];
      const record = records.find((item) =>
        /(英语|english|cet\s*-?\s*[46]|雅思|托福|ielts|toefl)/i.test(
          String(item?.name || "")
        )
      );
      return String(record?.name || "").trim();
    }

    function deriveEthnicity(profile) {
      const explicit = String(profile?.personal?.ethnicity || "").trim();
      if (explicit) return explicit;

      const legacy = String(profile?.personal?.nationality || "").trim();
      if (!legacy || /^(中国|中华人民共和国|china|chinese)$/i.test(legacy)) return "";
      if (/族$/.test(legacy)) return legacy;
      const chineseEthnicGroups = new Set(
        "汉,蒙古,回,藏,维吾尔,苗,彝,壮,布依,朝鲜,满,侗,瑶,白,土家,哈尼,哈萨克,傣,黎,傈僳,佤,畲,高山,拉祜,水,东乡,纳西,景颇,柯尔克孜,土,达斡尔,仫佬,羌,布朗,撒拉,毛南,仡佬,锡伯,阿昌,普米,塔吉克,怒,乌孜别克,俄罗斯,鄂温克,德昂,保安,裕固,京,塔塔尔,独龙,鄂伦春,赫哲,门巴,珞巴,基诺".split(",")
      );
      if (chineseEthnicGroups.has(legacy)) {
        return `${legacy}族`;
      }
      return "";
    }

    function combineComputerSkills(profile) {
      const skills = profile?.skills || {};
      const tokens = [
        skills.primarySkills,
        skills.programmingLanguages,
        skills.frameworks,
        skills.aiTools,
        skills.cloudPlatforms,
        skills.databases,
        skills.tooling,
        skills.domainKnowledge,
      ]
        .flatMap((value) => String(value || "").split(/[、,，;；\n]+/))
        .map((value) => value.trim())
        .filter(Boolean);
      return Array.from(new Set(tokens)).join("、");
    }

    function getEducationLevelRank(value) {
      const text = normalizeText(value);
      if (/博士|doctor|phd/.test(text)) return 5;
      if (/硕士|研究生|master/.test(text)) return 4;
      if (/本科|学士|bachelor|undergraduate/.test(text)) return 3;
      if (/大专|专科|associate/.test(text)) return 2;
      if (/高中|highschool/.test(text)) return 1;
      return 0;
    }

    function deriveHighestEducationFlag(profile, field) {
      const educations = Array.isArray(profile?.educations) ? profile.educations : [];
      const index = Number.isInteger(field?.repeatIndex) && field.repeatIndex >= 0
        ? field.repeatIndex
        : 0;
      const currentRank = getEducationLevelRank(educations[index]?.degree);
      const highestRank = educations.reduce(
        (highest, education) => Math.max(highest, getEducationLevelRank(education?.degree)),
        0
      );
      if (!currentRank || !highestRank) return "";
      return currentRank === highestRank ? "是" : "否";
    }

    function inferPrimaryDiscipline(major) {
      const text = normalizeText(major);
      if (!text) return "";
      if (/(工商管理|公共管理|行政管理|人力资源|市场营销|会计|财务管理|审计|物流管理|管理科学)/.test(text)) {
        return "管理学";
      }
      if (/(经济|金融|财政|税收|国际贸易|保险|投资学)/.test(text)) return "经济学";
      if (/(数学|物理|化学|生物科学|地理科学|大气科学|统计学|天文学|海洋科学|地质学)/.test(text)) {
        return "理学";
      }
      if (/(法学|法律|政治学|社会学|民族学|马克思主义|公安学)/.test(text)) return "法学";
      if (/(教育学|心理学|学前教育|体育教育)/.test(text)) return "教育学/心理学";
      if (/(汉语言|外国语言|英语|日语|新闻|传播|广告学)/.test(text)) return "文学";
      if (/(艺术|设计学|音乐|舞蹈|戏剧|美术)/.test(text)) return "艺术学";
      if (/(农学|园艺|植物保护|林学|动物科学|水产|草业)/.test(text)) return "农学";
      if (/(哲学|逻辑学|宗教学|伦理学)/.test(text)) return "哲学";
      if (/(电子|信息|通信|计算机|软件|自动化|电气|机械|材料|土木|建筑|交通|能源|动力|化工|环境工程|航空|航天|测绘|仪器|光电|生物医学工程|人工智能|机器人工程)/.test(text)) {
        return "工学";
      }
      return "";
    }

    function resolveCommonFieldValue(profile, field) {
      const label = normalizeText(
        field?.label || field?.placeholder || field?.name || field?.id
      );
      if (!label) return "";

      if (/^(籍贯|祖籍)$/.test(label)) {
        const location = profile?.contactAndLocation || {};
        return firstMeaningful([
          location.hometownCity,
          location.hometownProvince,
          location.hukouLocation,
        ]);
      }
      if (label === "民族") return deriveEthnicity(profile);
      if (label === "英语等级") return deriveEnglishLevel(profile);
      if (label === "英语等级成绩") {
        const record = getEnglishRecord(profile);
        return firstMeaningful([record?.testScore, record?.proficiency]);
      }
      if (/^(英语|外语)(等级)?证书(名称)?$/.test(label)) {
        const record = getEnglishRecord(profile);
        return firstMeaningful([
          getEnglishCertificateName(profile),
          record?.testScore,
          record?.proficiency,
        ]);
      }
      if (/^(计算机能力|计算机技能|专业技能)$/.test(label)) {
        return combineComputerSkills(profile);
      }
      if (/^(期望工作城市|期望城市|意向城市)$/.test(label)) {
        return firstMeaningful([
          profile?.jobPreferences?.expectedCity,
          profile?.jobPreferences?.preferredLocations,
        ]);
      }
      if (isHighestEducationFlagField(field, label)) {
        return deriveHighestEducationFlag(profile, field);
      }
      if (/^(学历类型|学历类别|学历性质)$/.test(label)) {
        return "统招全日制";
      }
      if (/^(成绩排名|专业排名|综合排名)$/.test(label)) {
        return "前20%";
      }
      if (/^(专业大类|学科门类|一级学科|primarydiscipline)$/.test(label)) {
        const index = Number.isInteger(field?.repeatIndex) && field.repeatIndex >= 0
          ? field.repeatIndex
          : 0;
        return inferPrimaryDiscipline(profile?.educations?.[index]?.major);
      }
      if (/^(学习形式|培养方式)$/.test(label)) {
        const index = Number.isInteger(field?.repeatIndex) && field.repeatIndex >= 0
          ? field.repeatIndex
          : 0;
        const education = profile?.educations?.[index] || {};
        return firstMeaningful([education.studyMode, education.educationType]);
      }
      return "";
    }

    return {
      getDeterministicCommonPath,
      resolveCommonFieldValue,
    };
  }
);
