const test = require("node:test");
const assert = require("node:assert/strict");

let projectFill = {};
try {
  projectFill = require("../shared/project-fill.js");
} catch (_) {
  projectFill = {};
}

const profile = {
  projects: [
    {
      description: "项目说明正文",
      highlights: "项目亮点正文",
    },
  ],
};

test("a lone project description field receives description and highlights", () => {
  assert.equal(typeof projectFill.resolveProjectDescriptionValue, "function");
  const field = {
    fieldId: "f_1",
    sectionKey: "project",
    repeatIndex: 0,
    kind: "textarea",
    label: "项目描述",
  };

  assert.equal(
    projectFill.resolveProjectDescriptionValue(
      profile,
      field,
      "projects.0.description",
      [field]
    ),
    "项目说明正文\n项目亮点正文"
  );
});

test("separate project description and highlight fields remain separate", () => {
  const descriptionField = {
    fieldId: "f_1",
    sectionKey: "project",
    repeatIndex: 0,
    kind: "textarea",
    label: "项目说明",
  };
  const highlightField = {
    fieldId: "f_2",
    sectionKey: "project",
    repeatIndex: 0,
    kind: "textarea",
    label: "项目亮点",
  };

  assert.equal(
    projectFill.resolveProjectDescriptionValue(
      profile,
      descriptionField,
      "projects.0.description",
      [descriptionField, highlightField]
    ),
    ""
  );
});

test("a lone project description field does not add blank separators", () => {
  const field = {
    fieldId: "f_1",
    sectionKey: "project",
    repeatIndex: 0,
    kind: "textarea",
    label: "项目描述",
  };

  assert.equal(
    projectFill.resolveProjectDescriptionValue(
      { projects: [{ description: "只有项目说明", highlights: "" }] },
      field,
      "projects.0.description",
      [field]
    ),
    "只有项目说明"
  );
});

test("a generic description label trusts an explicit project resume path", () => {
  const field = {
    fieldId: "f_1",
    sectionKey: "",
    repeatIndex: 0,
    kind: "textarea",
    label: "描述",
  };

  assert.equal(
    projectFill.resolveProjectDescriptionValue(
      profile,
      field,
      "projects.0.description",
      [field]
    ),
    "项目说明正文\n项目亮点正文"
  );
});

test("an unlabeled second-card description inherits the second project index", () => {
  assert.equal(typeof projectFill.annotateProjectFields, "function");
  const fields = [
    { fieldId: "f_1", sectionKey: "project", repeatIndex: 0, label: "项目名称" },
    { fieldId: "f_2", sectionKey: "project", repeatIndex: 0, label: "项目角色" },
    { fieldId: "f_3", sectionKey: "", label: "描述" },
    { fieldId: "f_4", sectionKey: "project", repeatIndex: 1, label: "项目名称" },
    { fieldId: "f_5", sectionKey: "project", repeatIndex: 1, label: "项目角色" },
    { fieldId: "f_6", sectionKey: "", label: "描述" },
  ];

  projectFill.annotateProjectFields(fields);

  assert.equal(fields[2].sectionKey, "project");
  assert.equal(fields[2].repeatIndex, 0);
  assert.equal(fields[5].sectionKey, "project");
  assert.equal(fields[5].repeatIndex, 1);
});

test("a second-card description corrects a stale first-project index", () => {
  const fields = [
    {
      fieldId: "project-1-name",
      sectionKey: "project",
      label: "项目名称",
      repeatIndex: 0,
    },
    {
      fieldId: "project-1-description",
      sectionKey: "project",
      label: "描述",
      repeatIndex: 0,
    },
    {
      fieldId: "project-2-name",
      sectionKey: "project",
      label: "项目名称",
      repeatIndex: 1,
    },
    {
      fieldId: "project-2-description",
      sectionKey: "project",
      label: "描述",
      repeatIndex: 0,
    },
  ];

  projectFill.annotateProjectFields(fields);

  assert.equal(fields[3].repeatIndex, 1);
});

test("a lone project responsibilities and results field receives description and highlights", () => {
  const field = {
    fieldId: "f_1",
    sectionKey: "project",
    repeatIndex: 0,
    kind: "textarea",
    label: "项目职责及成果",
  };

  assert.equal(
    projectFill.resolveProjectDescriptionValue(
      profile,
      field,
      "projects.0.description",
      [field]
    ),
    "项目说明正文\n项目亮点正文"
  );
});

test("project responsibilities stay separate when a description field also exists", () => {
  const descriptionField = {
    fieldId: "f_1",
    sectionKey: "project",
    repeatIndex: 0,
    kind: "textarea",
    label: "项目描述",
  };
  const resultsField = {
    fieldId: "f_2",
    sectionKey: "project",
    repeatIndex: 0,
    kind: "textarea",
    label: "项目职责及成果",
  };

  assert.equal(
    projectFill.resolveProjectDescriptionValue(
      profile,
      resultsField,
      "projects.0.highlights",
      [descriptionField, resultsField]
    ),
    ""
  );
});
